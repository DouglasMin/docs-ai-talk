/**
 * AWS SDK Configuration
 * Centralized AWS client setup with retry and timeout policies
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SQSClient } from '@aws-sdk/client-sqs';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { fromIni } from '@aws-sdk/credential-providers';
import https from 'https';

const region = process.env.AWS_REGION || 'us-east-1';

// Credentials 우선순위:
// 1. 환경 변수 (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
// 2. AWS 프로필 (AWS_PROFILE)
// 3. 기본 credential chain (EC2 instance role 등)
const profile = process.env.AWS_PROFILE;
const credentials = profile ? fromIni({ profile }) : undefined;

// Shared HTTP handler configuration
// Increase connection pool size and set timeouts
const httpHandler = new NodeHttpHandler({
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 200, // default is 50
  }),
  connectionTimeout: 10_000, // 10 seconds
  requestTimeout: 60_000, // 60 seconds for most operations
});

// Long-running operations handler (for Upstage-like heavy operations)
const longRunningHttpHandler = new NodeHttpHandler({
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 100,
  }),
  connectionTimeout: 15_000, // 15 seconds
  requestTimeout: 180_000, // 3 minutes for parsing/heavy operations
});

// Shared retry configuration
const retryConfig = {
  maxAttempts: 3, // Total attempts (1 initial + 2 retries)
};

// S3 Client
export const s3Client = new S3Client({
  region,
  credentials,
  maxAttempts: 3,
  requestHandler: httpHandler,
});

// DynamoDB Client
export const dynamoDBClient = new DynamoDBClient({
  region,
  credentials,
  maxAttempts: 3,
  requestHandler: httpHandler,
});

// SQS Client
export const sqsClient = new SQSClient({
  region,
  credentials,
  maxAttempts: 3,
  requestHandler: httpHandler,
});

// Bedrock Agent Client (for KB management)
export const bedrockAgentClient = new BedrockAgentClient({
  region,
  credentials,
  maxAttempts: 3,
  requestHandler: longRunningHttpHandler, // Ingestion can take time
});

// Bedrock Agent Runtime Client (for queries)
export const bedrockRuntimeClient = new BedrockAgentRuntimeClient({
  region,
  credentials,
  maxAttempts: 3,
  requestHandler: httpHandler,
});

// Secrets Manager Client
export const secretsClient = new SecretsManagerClient({
  region,
  credentials,
  maxAttempts: 3,
  requestHandler: httpHandler,
});

// Environment variables
export const config = {
  aws: {
    region,
    profile,
    credentials,
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
