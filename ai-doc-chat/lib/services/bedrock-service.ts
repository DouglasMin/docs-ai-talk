/**
 * Bedrock Knowledge Base Service
 * Handles KB ingestion and querying
 */

import { 
  BedrockAgentClient, 
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  type IngestionJobStatus
} from '@aws-sdk/client-bedrock-agent';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  type KnowledgeBaseVectorSearchConfiguration,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type SystemContentBlock
} from '@aws-sdk/client-bedrock-runtime';
import { config } from '../aws-config';

/**
 * Start ingestion job for a document
 * Returns the job ID for status polling
 */
export async function startIngestion(docId: string): Promise<{ jobId: string }> {
  const client = new BedrockAgentClient({
    region: config.aws.region,
    // credentials: config.aws.credentials,
  });

  const command = new StartIngestionJobCommand({
    knowledgeBaseId: config.bedrock.knowledgeBaseId,
    dataSourceId: config.bedrock.dataSourceId,
    description: `Ingestion for document ${docId}`,
  });

  const response = await client.send(command);

  if (!response.ingestionJob?.ingestionJobId) {
    throw new Error('Failed to start ingestion job - no job ID returned');
  }

  return {
    jobId: response.ingestionJob.ingestionJobId,
  };
}

/**
 * Check ingestion job status
 */
export async function checkIngestionStatus(jobId: string): Promise<{
  status: IngestionJobStatus;
  failureReasons?: string[];
}> {
  const client = new BedrockAgentClient({
    region: config.aws.region,
    // credentials: config.aws.credentials,
  });

  const command = new GetIngestionJobCommand({
    knowledgeBaseId: config.bedrock.knowledgeBaseId,
    dataSourceId: config.bedrock.dataSourceId,
    ingestionJobId: jobId,
  });

  const response = await client.send(command);

  if (!response.ingestionJob) {
    throw new Error('Ingestion job not found');
  }

  return {
    status: response.ingestionJob.status!,
    failureReasons: response.ingestionJob.failureReasons,
  };
}

/**
 * Query Knowledge Base for relevant documents
 */
export async function queryKnowledgeBase(
  query: string, 
  options: {
    maxResults?: number;
    docId?: string;
  } = {}
) {
  const { maxResults = 5, docId } = options;
  
  const client = new BedrockAgentRuntimeClient({
    region: config.aws.region,
    // credentials: config.aws.credentials,
  });

  const vectorSearchConfig: KnowledgeBaseVectorSearchConfiguration = {
    numberOfResults: maxResults,
  };

  // Add document filter if docId is provided
  if (docId) {
    vectorSearchConfig.filter = {
      equals: {
        key: 'docId',
        value: docId,
      },
    };
  }

  const command = new RetrieveCommand({
    knowledgeBaseId: config.bedrock.knowledgeBaseId,
    retrievalQuery: {
      text: query,
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: vectorSearchConfig,
    },
  });

  const response = await client.send(command);
  
  return response.retrievalResults || [];
}

/**
 * Chat with Nova Pro using RAG context
 */
export async function chatWithRAG({
  message,
  conversationHistory = [],
  maxResults = 5,
  docId
}: {
  message: string;
  conversationHistory?: Message[];
  maxResults?: number;
  docId?: string;
}) {
  // 1. Query KB for relevant context
  console.log('[chatWithRAG] Querying KB with:', { message, maxResults, docId });
  const retrievalResults = await queryKnowledgeBase(message, { maxResults, docId });
  console.log('[chatWithRAG] Retrieved results:', retrievalResults.length);
  
  // 2. Handle no-results case
  if (retrievalResults.length === 0) {
    const noResultsPrompt: SystemContentBlock[] = [
      {
        text: `You are a helpful AI assistant. The user asked a question but no relevant information was found in the uploaded documents.

Politely inform the user that you couldn't find relevant information in their documents to answer their question. Suggest they:
1. Try rephrasing their question
2. Check if the relevant document has been uploaded
3. Verify the document has finished processing (status: ready)`
      }
    ];

    const messages: Message[] = [
      ...conversationHistory,
      {
        role: 'user',
        content: [{ text: message }]
      }
    ];

    const client = new BedrockRuntimeClient({
      region: config.aws.region,
      // credentials: config.aws.credentials,
    });

    const command = new ConverseStreamCommand({
      modelId: 'amazon.nova-pro-v1:0',
      messages,
      system: noResultsPrompt,
      inferenceConfig: {
        maxTokens: 500,
        temperature: 0.3,
        topP: 0.9,
      },
    });

    return client.send(command);
  }

  // 3. Build context from retrieved documents
  const context = retrievalResults
    .map((result, index) => {
      const content = result.content?.text || '';
      const source = result.location?.s3Location?.uri || 'Unknown source';
      return `[Document ${index + 1}] (Source: ${source})\n${content}`;
    })
    .join('\n\n');

  // 4. Build system prompt with context
  const systemPrompt: SystemContentBlock[] = [
    {
      text: `You are a helpful AI assistant that answers questions based on the provided documents. 

Use the following context to answer the user's question. If the information is not available in the context, say so clearly.

Context:
${context}`
    }
  ];

  // 5. Prepare messages
  const messages: Message[] = [
    ...conversationHistory,
    {
      role: 'user',
      content: [{ text: message }]
    }
  ];

  // 6. Call Nova Pro with Converse Stream API
  const client = new BedrockRuntimeClient({
    region: config.aws.region,
    // credentials: config.aws.credentials,
  });

  const command = new ConverseStreamCommand({
    modelId: 'amazon.nova-pro-v1:0',
    messages,
    system: systemPrompt,
    inferenceConfig: {
      maxTokens: 2000,
      temperature: 0.1,
      topP: 0.9,
    },
  });

  return client.send(command);
}
