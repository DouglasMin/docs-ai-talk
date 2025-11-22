# Bedrock Knowledge Base Transformation Lambda

This Lambda function provides custom chunking logic for AWS Bedrock Knowledge Base that preserves tables, charts, and diagrams as complete chunks.

## Features

- **Table Preservation**: Keeps entire tables as single chunks
- **Chart/Diagram Preservation**: Keeps visual elements intact
- **Smart Text Chunking**: Chunks regular text with sentence boundary preservation
- **Metadata Enrichment**: Adds content type metadata for filtering

## How It Works

1. Receives parsed content from Bedrock KB
2. Identifies visual elements by markers (`[TABLE]`, `[CHART]`, etc.)
3. Keeps visual elements as complete chunks
4. Chunks regular text (500 tokens with 50 token overlap)
5. Adds metadata to each chunk
6. Returns processed chunks to Bedrock KB

## Deployment

### 1. Create Lambda Function

```bash
cd lambda/bedrock-kb-transformation
zip -r function.zip lambda_function.py
```

### 2. Create Lambda via AWS CLI

```bash
aws lambda create-function \
  --function-name bedrock-kb-transformation \
  --runtime python3.12 \
  --role arn:aws:iam::YOUR_ACCOUNT:role/lambda-bedrock-kb-role \
  --handler lambda_function.lambda_handler \
  --zip-file fileb://function.zip \
  --timeout 300 \
  --memory-size 512
```

### 3. Create IAM Role

The Lambda needs permissions to:
- Read from S3 (intermediate bucket)
- Write to S3 (intermediate bucket)
- CloudWatch Logs

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::YOUR-INTERMEDIATE-BUCKET/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### 4. Configure in Bedrock KB

1. Go to Bedrock Console → Knowledge Bases
2. Select your KB → Data Source
3. Under "Transformation function", select your Lambda
4. Specify S3 intermediate bucket
5. Set chunking strategy to "No chunking"

## Configuration

### Chunking Parameters

Edit in `lambda_function.py`:

```python
# Regular text chunking
max_tokens=500      # Maximum tokens per text chunk
overlap=50          # Overlap between chunks

# Visual elements
# Always kept as complete chunks (no splitting)
```

### Supported Visual Element Markers

The function detects these markers from Nova Lite parser:
- `**[TABLE]**` - Tables
- `**[CHART]**` - Charts and graphs
- `**[DIAGRAM]**` - Diagrams and flowcharts
- `**[IMAGE]**` - Images and figures

## Metadata Added

Each chunk gets metadata:

```python
{
    'content_type': 'table' | 'chart' | 'diagram' | 'image' | 'text',
    'has_table': True/False,
    'has_chart': True/False,
    'is_visual_element': True/False
}
```

## Querying with Metadata

Filter queries by content type:

```python
response = bedrock.retrieve({
    'knowledgeBaseId': 'kb-xxx',
    'retrievalQuery': {'text': 'revenue data'},
    'retrievalConfiguration': {
        'vectorSearchConfiguration': {
            'filter': {
                'equals': {
                    'key': 'content_type',
                    'value': 'table'
                }
            }
        }
    }
})
```

## Testing

Test the Lambda with sample event:

```json
{
  "version": "1.0",
  "knowledgeBaseId": "test-kb",
  "dataSourceId": "test-ds",
  "ingestionJobId": "test-job",
  "bucketName": "your-intermediate-bucket",
  "inputFiles": [{
    "originalFileLocation": {
      "type": "S3",
      "s3_location": {
        "uri": "s3://bucket/test.json"
      }
    },
    "fileMetadata": {},
    "contentBatches": [{
      "key": "parsed/test.json"
    }]
  }]
}
```

## Monitoring

View logs in CloudWatch:
```bash
aws logs tail /aws/lambda/bedrock-kb-transformation --follow
```

## Cost

- Lambda: ~$0.20 per 1M requests
- S3: ~$0.023/GB for intermediate storage
- **Estimated**: ~$0.50/month for 10-20 users

## Troubleshooting

### Chunks not appearing
- Check CloudWatch logs for errors
- Verify S3 permissions
- Ensure intermediate bucket is correct

### Tables still split
- Check parser instructions include `[TABLE]` markers
- Verify regex pattern matches your markers
- Test with sample content

### Timeout errors
- Increase Lambda timeout (default: 300s)
- Increase memory (more memory = faster CPU)

## Customization

### Change chunk size
```python
text_chunks = chunk_text(part, max_tokens=300, overlap=30)
```

### Add custom metadata
```python
chunks.append({
    'contentBody': part,
    'contentMetadata': {
        'content_type': element_type,
        'custom_field': 'your_value',
        'priority': 'high'
    }
})
```

### Different visual element detection
```python
# Detect by markdown table syntax
if '|' in part and '---' in part:
    # It's a table
```

## References

- [AWS Bedrock KB Custom Transformation](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-custom-transformation.html)
- [Lambda Python Runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-python.html)
