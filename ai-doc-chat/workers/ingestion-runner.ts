/**
 * Ingestion Worker
 * 
 * Processes document ingestion jobs from SQS queue:
 * 1. Receive message from queue
 * 2. Parse document with Upstage
 * 3. Upload parsed content to S3
 * 4. Start Bedrock KB ingestion
 * 5. Update document status in DynamoDB
 * 6. Delete message from queue
 * 
 * Status transitions:
 * uploading → parsing → parsed → ingesting → ready / failed
 */

// Load environment variables from .env file
import 'dotenv/config';

import { 
  receiveIngestionMessages, 
  deleteIngestionMessage, 
  parseIngestionMessage,
  type IngestionMessage 
} from '../lib/services/sqs-service';
import { updateDocumentStatus, getDocument } from '../lib/services/dynamodb-service';
import { parseDocumentWithUpstage, formatForBedrockKB } from '../lib/services/upstage-service';
import { uploadParsedContent } from '../lib/services/s3-service';
import { startIngestion } from '../lib/services/bedrock-service';

// Retry configuration
const RETRY_DELAYS = [1000, 2000, 5000]; // Exponential backoff: 1s, 2s, 5s
const MAX_RETRIES = 3;

/**
 * Process a single ingestion message
 */
async function processIngestionMessage(message: IngestionMessage): Promise<void> {
  const { docId, s3Url, fileName } = message;
  
  console.log(`[Worker] Processing document ${docId} (${fileName})`);

  try {
    // Step 1: Update status to parsing
    await updateDocumentStatus(docId, 'parsing');
    console.log(`[Worker] Status: parsing - ${docId}`);

    // Step 2: Parse with Upstage
    console.log(`[Worker] Starting Upstage parsing for ${docId}...`);
    const parseResult = await parseDocumentWithUpstage(s3Url);
    console.log(`[Worker] Parsed ${docId}: ${parseResult.metadata.pages} pages, ${parseResult.metadata.tables} tables`);

    // Step 3: Update status to parsed
    await updateDocumentStatus(docId, 'parsed');
    console.log(`[Worker] Status: parsed - ${docId}`);

    // Step 4: Format and upload parsed content
    const formattedContent = formatForBedrockKB(parseResult.content);
    console.log(`[Worker] Uploading parsed content for ${docId}...`);
    await uploadParsedContent(docId, formattedContent);

    // Step 5: Start Bedrock KB ingestion
    console.log(`[Worker] Starting KB ingestion for ${docId}...`);
    const ingestionJob = await startIngestion(docId);

    // Step 6: Update status to ingesting
    await updateDocumentStatus(docId, 'ingesting', undefined, ingestionJob.jobId);
    console.log(`[Worker] Status: ingesting - ${docId} (Job: ${ingestionJob.jobId})`);

    console.log(`[Worker] ✅ Successfully processed ${docId}`);

  } catch (error) {
    console.error(`[Worker] ❌ Failed to process ${docId}:`, error);
    
    // Update status to failed with error message
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await updateDocumentStatus(docId, 'failed', errorMessage);
    
    // Re-throw to let SQS handle retry/DLQ
    throw error;
  }
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < retries) {
        const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        console.log(`[Worker] Retry attempt ${attempt + 1}/${retries} after ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  
  throw lastError!;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main worker loop
 * Continuously polls SQS for messages
 */
export async function startWorker(options: {
  maxMessages?: number;
  pollInterval?: number;
} = {}): Promise<void> {
  const { maxMessages = 1, pollInterval = 0 } = options;
  
  console.log('[Worker] 🚀 Starting ingestion worker...');
  console.log(`[Worker] Config: maxMessages=${maxMessages}, pollInterval=${pollInterval}ms`);
  
  // Debug: Check environment variables
  console.log('[Worker] 🔍 Environment check:');
  console.log(`  - AWS_REGION: ${process.env.AWS_REGION || '❌ Not set'}`);
  console.log(`  - AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Set (starts with ' + process.env.AWS_ACCESS_KEY_ID.substring(0, 8) + '...)' : '❌ Not set'}`);
  console.log(`  - AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Not set'}`);
  console.log(`  - SQS_INGESTION_QUEUE_URL: ${process.env.SQS_INGESTION_QUEUE_URL || '❌ Not set'}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // Receive messages from SQS (long polling)
      const messages = await receiveIngestionMessages({ 
        maxMessages,
        waitTimeSeconds: 20 // Long polling to reduce empty receives
      });

      if (messages.length === 0) {
        // No messages - continue polling
        if (pollInterval > 0) {
          await sleep(pollInterval);
        }
        continue;
      }

      console.log(`[Worker] Received ${messages.length} message(s)`);

      // Process each message
      for (const sqsMessage of messages) {
        const message = parseIngestionMessage(sqsMessage);
        
        if (!message) {
          console.error('[Worker] Failed to parse message, deleting invalid message');
          if (sqsMessage.ReceiptHandle) {
            await deleteIngestionMessage(sqsMessage.ReceiptHandle);
          }
          continue;
        }

        try {
          // Process with retry
          await withRetry(() => processIngestionMessage(message));
          
          // Success - delete from queue
          if (sqsMessage.ReceiptHandle) {
            await deleteIngestionMessage(sqsMessage.ReceiptHandle);
            console.log(`[Worker] Deleted message from queue: ${message.docId}`);
          }
          
        } catch (error) {
          console.error(`[Worker] Failed to process message after retries:`, error);
          // SQS will automatically retry based on queue config
          // After maxReceiveCount (3), it will go to DLQ
        }
      }

      // Optional: Add delay between batches
      if (pollInterval > 0) {
        await sleep(pollInterval);
      }

    } catch (error) {
      console.error('[Worker] Error in main loop:', error);
      // Wait before retrying to avoid tight loop on persistent errors
      await sleep(5000);
    }
  }
}

// Run worker if executed directly
if (require.main === module) {
  startWorker().catch(error => {
    console.error('[Worker] Fatal error:', error);
    process.exit(1);
  });
}

