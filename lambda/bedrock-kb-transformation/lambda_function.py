"""
Bedrock Knowledge Base Custom Transformation Lambda
Preserves tables and charts as complete chunks while chunking regular text
"""

import json
import boto3
import re
from typing import List, Dict, Any

s3_client = boto3.client('s3')

def lambda_handler(event, context):
    """
    Main handler for Bedrock KB transformation
    
    Event structure from Bedrock:
    {
        "version": "1.0",
        "knowledgeBaseId": "string",
        "dataSourceId": "string",
        "ingestionJobId": "string",
        "bucketName": "string",
        "inputFiles": [...]
    }
    """
    print(f"Processing ingestion job: {event.get('ingestionJobId')}")
    
    bucket_name = event['bucketName']
    output_files = []
    
    try:
        for input_file in event['inputFiles']:
            processed_file = process_file(input_file, bucket_name)
            output_files.append(processed_file)
        
        return {
            'outputFiles': output_files
        }
    
    except Exception as e:
        print(f"Error processing files: {str(e)}")
        raise


def process_file(input_file: Dict[str, Any], bucket_name: str) -> Dict[str, Any]:
    """Process a single file and return chunked output"""
    
    print(f"Processing file: {input_file['originalFileLocation']}")
    
    # Read content from S3
    content_batches = input_file['contentBatches']
    all_content = ""
    
    for batch in content_batches:
        s3_key = batch['key']
        file_content = read_s3_json(bucket_name, s3_key)
        
        # Extract text from fileContents
        for content_item in file_content.get('fileContents', []):
            all_content += content_item.get('contentBody', '') + "\n\n"
    
    # Perform table-aware chunking
    chunks = chunk_with_table_preservation(all_content)
    
    # Write chunks back to S3
    output_batches = write_chunks_to_s3(chunks, bucket_name, input_file)
    
    return {
        'originalFileLocation': input_file['originalFileLocation'],
        'fileMetadata': input_file.get('fileMetadata', {}),
        'contentBatches': output_batches
    }


def chunk_with_table_preservation(content: str) -> List[Dict[str, Any]]:
    """
    Split content into chunks while preserving tables and charts
    
    Strategy:
    1. Identify tables/charts by markers (from Upstage pre-processing)
    2. Keep them as complete chunks
    3. Chunk regular text normally
    
    Note: Content is pre-parsed by Upstage Document Parse API
    """
    
    chunks = []
    
    # Split content by visual element markers
    # Pattern matches: **[TABLE]**, **[CHART]**, **[DIAGRAM]**, **[IMAGE]**
    pattern = r'(\*\*\[(?:TABLE|CHART|DIAGRAM|IMAGE)\]\*\*.*?)(?=\*\*\[(?:TABLE|CHART|DIAGRAM|IMAGE)\]\*\*|\Z)'
    
    parts = re.split(pattern, content, flags=re.DOTALL)
    
    for part in parts:
        part = part.strip()
        if not part:
            continue
        
        # Check if this part is a visual element
        if re.match(r'\*\*\[(TABLE|CHART|DIAGRAM|IMAGE)\]\*\*', part):
            # Extract element type
            element_type = re.search(r'\*\*\[(\w+)\]\*\*', part).group(1).lower()
            
            # Keep entire visual element as one chunk
            chunks.append({
                'contentBody': part,
                'contentType': 'TEXT',
                'contentMetadata': {
                    'content_type': element_type,
                    f'has_{element_type}': True,
                    'is_visual_element': True,
                    'parser': 'upstage'
                }
            })
        else:
            # Regular text - chunk it normally
            text_chunks = chunk_text(part, max_tokens=500, overlap=50)
            for text_chunk in text_chunks:
                chunks.append({
                    'contentBody': text_chunk,
                    'contentType': 'TEXT',
                    'contentMetadata': {
                        'content_type': 'text',
                        'is_visual_element': False,
                        'parser': 'upstage'
                    }
                })
    
    print(f"Created {len(chunks)} chunks from Upstage-parsed content")
    return chunks


def chunk_text(text: str, max_tokens: int = 500, overlap: int = 50) -> List[str]:
    """
    Chunk regular text by approximate token count
    Preserves sentence boundaries
    """
    
    # Approximate: 1 token ≈ 4 characters
    max_chars = max_tokens * 4
    overlap_chars = overlap * 4
    
    # Split by sentences
    sentences = re.split(r'(?<=[.!?])\s+', text)
    
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        # If adding this sentence exceeds max, start new chunk
        if len(current_chunk) + len(sentence) > max_chars and current_chunk:
            chunks.append(current_chunk.strip())
            
            # Add overlap from end of previous chunk
            if overlap > 0:
                words = current_chunk.split()
                overlap_text = ' '.join(words[-overlap:])
                current_chunk = overlap_text + " " + sentence
            else:
                current_chunk = sentence
        else:
            current_chunk += " " + sentence if current_chunk else sentence
    
    # Add final chunk
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    return chunks


def read_s3_json(bucket: str, key: str) -> Dict[str, Any]:
    """Read JSON file from S3"""
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read().decode('utf-8')
        return json.loads(content)
    except Exception as e:
        print(f"Error reading S3 object {bucket}/{key}: {str(e)}")
        raise


def write_chunks_to_s3(chunks: List[Dict[str, Any]], bucket: str, input_file: Dict[str, Any]) -> List[Dict[str, str]]:
    """Write chunks to S3 and return batch references"""
    
    # Generate unique key for this file's chunks
    original_uri = input_file['originalFileLocation']['s3_location']['uri']
    file_id = original_uri.split('/')[-1].replace('.', '_')
    
    output_key = f"transformed/{file_id}_chunks.json"
    
    # Create fileContents structure
    file_contents = {
        'fileContents': chunks
    }
    
    # Write to S3
    s3_client.put_object(
        Bucket=bucket,
        Key=output_key,
        Body=json.dumps(file_contents),
        ContentType='application/json'
    )
    
    print(f"Wrote chunks to s3://{bucket}/{output_key}")
    
    return [{
        'key': output_key
    }]
