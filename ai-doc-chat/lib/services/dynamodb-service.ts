/**
 * DynamoDB Service
 * Handles document metadata storage
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoDBClient } from '../aws-config';
import { Document, DocumentStatus } from '@/types';

const docClient = DynamoDBDocumentClient.from(dynamoDBClient);
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'ai-doc-chat-documents';

/**
 * Create document metadata
 */
export async function createDocument(doc: Omit<Document, 'uploadedAt'>): Promise<Document> {
  const now = new Date();
  const document: Document = {
    ...doc,
    uploadedAt: now,
  };

  // Convert Date to ISO string for DynamoDB
  const dbItem = {
    ...document,
    uploadedAt: now.toISOString(),
    processedAt: document.processedAt?.toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: dbItem,
    })
  );

  return document;
}

/**
 * Get document by ID
 */
export async function getDocument(id: string): Promise<Document | null> {
  const response = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { id },
    })
  );

  if (!response.Item) return null;

  // Convert ISO strings back to Date objects
  const item = response.Item as any;
  return {
    ...item,
    uploadedAt: new Date(item.uploadedAt),
    processedAt: item.processedAt ? new Date(item.processedAt) : undefined,
  } as Document;
}

/**
 * Update document status
 */
export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
  error?: string,
  ingestionJobId?: string,
  upstageJobId?: string
): Promise<void> {
  let updateExpression = 'SET #status = :status, processedAt = :processedAt';
  const expressionAttributeNames: any = { '#status': 'status' };
  const expressionAttributeValues: any = {
    ':status': status,
    ':processedAt': new Date().toISOString(),
  };

  if (error) {
    updateExpression += ', #error = :error';
    expressionAttributeNames['#error'] = 'error';
    expressionAttributeValues[':error'] = error;
  }

  if (ingestionJobId) {
    updateExpression += ', ingestionJobId = :ingestionJobId';
    expressionAttributeValues[':ingestionJobId'] = ingestionJobId;
  }

  if (upstageJobId) {
    updateExpression += ', upstageJobId = :upstageJobId';
    expressionAttributeValues[':upstageJobId'] = upstageJobId;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );
}

/**
 * List all documents
 */
export async function listDocuments(): Promise<Document[]> {
  const response = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
    })
  );

  // Convert ISO strings back to Date objects
  const items = response.Items || [];
  return items.map((item: any) => ({
    ...item,
    uploadedAt: new Date(item.uploadedAt),
    processedAt: item.processedAt ? new Date(item.processedAt) : undefined,
  })) as Document[];
}

/**
 * Delete document
 */
export async function deleteDocument(id: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { id },
    })
  );
}
