// apps/api/src/common/ddb.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
export const tableObjects = process.env.OBJECTS_TABLE || `${process.env.PROJECT_NAME ?? "mbapp"}_objects`;

const ddbClient = new DynamoDBClient({
  region: REGION,
  // If you ever run against DynamoDB Local, uncomment:
  // endpoint: process.env.DDB_ENDPOINT,
});

export const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    convertClassInstanceToMap: true,
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
  unmarshallOptions: { wrapNumbers: false },
});
