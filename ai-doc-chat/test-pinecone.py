#!/usr/bin/env python3
"""
Test script to check Pinecone index status
Install: pip install pinecone-client
Run: python test-pinecone.py
"""

import os
from pinecone import Pinecone

# Pinecone configuration
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY', 'YOUR_API_KEY_HERE')
INDEX_NAME = 'bedrock-kb-index'  # Your index name

def check_pinecone():
    print("🔍 Checking Pinecone Index...\n")
    
    # Initialize Pinecone
    pc = Pinecone(api_key=PINECONE_API_KEY)
    
    # Get index
    index = pc.Index(INDEX_NAME)
    
    # Get index stats
    stats = index.describe_index_stats()
    
    print("📊 Index Statistics:")
    print(f"  - Total Vectors: {stats.total_vector_count:,}")
    print(f"  - Dimension: {stats.dimension}")
    print(f"  - Index Fullness: {stats.index_fullness:.2%}")
    
    if stats.namespaces:
        print(f"\n📁 Namespaces:")
        for namespace, info in stats.namespaces.items():
            ns_name = namespace if namespace else "(default)"
            print(f"  - {ns_name}: {info.vector_count:,} vectors")
    
    # Test query
    print("\n🔎 Testing Query...")
    try:
        # Create a dummy vector for testing
        test_vector = [0.1] * stats.dimension
        results = index.query(
            vector=test_vector,
            top_k=3,
            include_metadata=True
        )
        
        print(f"  ✅ Query successful! Found {len(results.matches)} results")
        
        if results.matches:
            print("\n📄 Sample Results:")
            for i, match in enumerate(results.matches[:3], 1):
                print(f"\n  Result {i}:")
                print(f"    - ID: {match.id}")
                print(f"    - Score: {match.score:.4f}")
                if match.metadata:
                    print(f"    - Metadata: {match.metadata}")
    except Exception as e:
        print(f"  ❌ Query failed: {e}")
    
    print("\n✅ Pinecone check complete!")

if __name__ == "__main__":
    try:
        check_pinecone()
    except Exception as e:
        print(f"❌ Error: {e}")
        print("\nMake sure to:")
        print("1. Set PINECONE_API_KEY environment variable")
        print("2. Update INDEX_NAME if different")
        print("3. Install pinecone-client: pip install pinecone-client")
