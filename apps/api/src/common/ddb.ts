import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
export const tableObjects = process.env.OBJECTS_TABLE || `${process.env.PROJECT_NAME ?? "mbapp"}_objects`;

// name of the GSI with partition gsi1pk and sort gsi1sk
export const GSI1_NAME = process.env.OBJECTS_GSI1_NAME || "gsi1";

const ddbClient = new DynamoDBClient({ region: REGION /* endpoint: process.env.DDB_ENDPOINT */ });

export const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { convertClassInstanceToMap: true, removeUndefinedValues: true, convertEmptyValues: false },
  unmarshallOptions: { wrapNumbers: false },
});

// --- Order workflow status model ---
export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'committed'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'cancelled'
  | 'closed';

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed: Record<OrderStatus, OrderStatus[]> = {
    draft: ['submitted', 'cancelled'],
    submitted: ['approved', 'cancelled'],
    approved: ['committed', 'cancelled'],
    committed: ['partially_fulfilled', 'fulfilled', 'cancelled'],
    partially_fulfilled: ['fulfilled', 'cancelled'],
    fulfilled: ['closed'],
    cancelled: [],
    closed: [],
  };
  return allowed[from]?.includes(to) ?? false;
}