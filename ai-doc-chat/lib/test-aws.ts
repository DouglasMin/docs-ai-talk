/**
 * Test AWS Configuration
 * Run this to verify AWS SDK is properly configured
 */

import { s3Client, bedrockAgentClient, config } from './aws-config';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { ListKnowledgeBasesCommand } from '@aws-sdk/client-bedrock-agent';

export async function testAWSConnection() {
  console.log('Testing AWS connection...');
  console.log('Region:', config.aws.region);
  // console.log('Profile:', config.aws.profile);

  try {
    // Test S3
    const s3Response = await s3Client.send(new ListBucketsCommand({}));
    console.log('✅ S3 connection successful');
    console.log(`Found ${s3Response.Buckets?.length || 0} buckets`);

    // Test Bedrock
    const bedrockResponse = await bedrockAgentClient.send(
      new ListKnowledgeBasesCommand({})
    );
    console.log('✅ Bedrock connection successful');
    console.log(`Found ${bedrockResponse.knowledgeBaseSummaries?.length || 0} knowledge bases`);

    return true;
  } catch (error) {
    console.error('❌ AWS connection failed:', error);
    return false;
  }
}

// Run test if executed directly
if (require.main === module) {
  testAWSConnection();
}
