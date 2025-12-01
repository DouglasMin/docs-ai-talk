/**
 * AWS SDK Configuration
 * Centralized AWS client setup with profile support
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { fromIni } from '@aws-sdk/credential-providers';

const region = process.env.AWS_REGION || 'us-east-1';
// const profile = process.env.AWS_PROFILE || 'dongik2';

// Shared credentials configuration
// Use default provider chain which supports env vars, profile, etc.
// const credentials = fromIni({ profile });

// S3 Client
export const s3Client = new S3Client({
  region,
  // credentials,
});

// DynamoDB Client
export const dynamoDBClient = new DynamoDBClient({
  region,
  // credentials,
});

// Bedrock Agent Client (for KB management)
export const bedrockAgentClient = new BedrockAgentClient({
  region,
  // credentials,
});

// Bedrock Agent Runtime Client (for queries)
export const bedrockRuntimeClient = new BedrockAgentRuntimeClient({
  region,
  // credentials,
});

// Secrets Manager Client
export const secretsClient = new SecretsManagerClient({
  region,
  // credentials,
});

// Environment variables
export const config = {
  aws: {
    region,
    // profile,
    // credentials,
  },
  s3: {
    bucket: process.env.S3_BUCKET!,
  },
  bedrock: {
    knowledgeBaseId: process.env.BEDROCK_KB_ID!,
    dataSourceId: process.env.BEDROCK_DATA_SOURCE_ID!,
  },
  upstage: {
    apiKey: process.env.UPSTAGE_API_KEY!,
  },
} as const;
