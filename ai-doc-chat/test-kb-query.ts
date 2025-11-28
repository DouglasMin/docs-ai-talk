/**
 * Test script to query Bedrock Knowledge Base
 * Run with: npx tsx test-kb-query.ts "your question here"
 */

import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { fromIni } from '@aws-sdk/credential-providers';

const KB_ID = 'E5TKZO2C1Z';
const REGION = 'us-east-1';
const PROFILE = 'dongik2';

async function queryKB(question: string) {
  const client = new BedrockAgentRuntimeClient({
    region: REGION,
    credentials: fromIni({ profile: PROFILE }),
  });

  const command = new RetrieveCommand({
    knowledgeBaseId: KB_ID,
    retrievalQuery: {
      text: question,
    },
  });

  try {
    console.log(`\n🔍 Querying KB: "${question}"\n`);
    const response = await client.send(command);
    
    console.log(`✅ Found ${response.retrievalResults?.length || 0} results\n`);
    
    response.retrievalResults?.forEach((result, idx) => {
      console.log(`--- Result ${idx + 1} ---`);
      console.log(`Score: ${result.score}`);
      console.log(`Content: ${result.content?.text?.substring(0, 200)}...`);
      console.log(`Location: ${result.location?.s3Location?.uri}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ Error querying KB:', error);
  }
}

const question = process.argv[2] || 'What is this document about?';
queryKB(question);
