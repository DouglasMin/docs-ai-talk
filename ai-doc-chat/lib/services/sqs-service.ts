/**
 * SQS Service
 * Handles message queue operations for async document processing
 */

import { 
  SQSClient, 
  SendMessageCommand, 
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message 
} from '@aws-sdk/client-sqs';
import { config } from '../aws-config';

const sqsClient = new SQSClient({
  region: config.aws.region,
});

// Queue URLs - set via environment variables
const INGESTION_QUEUE_URL = process.env.SQS_INGESTION_QUEUE_URL || 
  'https://sqs.us-east-1.amazonaws.com/863518440691/ai-doc-chat-ingestion-queue';

export interface IngestionMessage {
  docId: string;
  s3Url: string;
  fileName: string;
  timestamp: string;
}

/**
 * Send document ingestion message to SQS
 */
export async function sendIngestionMessage(message: IngestionMessage): Promise<string> {
  const command = new SendMessageCommand({
    QueueUrl: INGESTION_QUEUE_URL,
    MessageBody: JSON.stringify(message),
    MessageAttributes: {
      docId: {
        DataType: 'String',
        StringValue: message.docId,
      },
      timestamp: {
        DataType: 'String',
        StringValue: message.timestamp,
      },
    },
  });

  const response = await sqsClient.send(command);
  
  if (!response.MessageId) {
    throw new Error('Failed to send message to SQS - no MessageId returned');
  }

  return response.MessageId;
}

/**
 * Receive messages from ingestion queue
 * Used by worker processes
 */
export async function receiveIngestionMessages(options: {
  maxMessages?: number;
  waitTimeSeconds?: number;
} = {}): Promise<Message[]> {
  const { maxMessages = 1, waitTimeSeconds = 20 } = options;

  const command = new ReceiveMessageCommand({
    QueueUrl: INGESTION_QUEUE_URL,
    MaxNumberOfMessages: maxMessages,
    WaitTimeSeconds: waitTimeSeconds,
    MessageAttributeNames: ['All'],
  });

  const response = await sqsClient.send(command);
  return response.Messages || [];
}

/**
 * Delete message from queue after successful processing
 */
export async function deleteIngestionMessage(receiptHandle: string): Promise<void> {
  const command = new DeleteMessageCommand({
    QueueUrl: INGESTION_QUEUE_URL,
    ReceiptHandle: receiptHandle,
  });

  await sqsClient.send(command);
}

/**
 * Parse message body into IngestionMessage type
 */
export function parseIngestionMessage(message: Message): IngestionMessage | null {
  try {
    if (!message.Body) {
      return null;
    }
    return JSON.parse(message.Body) as IngestionMessage;
  } catch (error) {
    console.error('Failed to parse SQS message:', error);
    return null;
  }
}

