"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ddb = exports.GSI1_NAME = exports.tableObjects = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
exports.tableObjects = process.env.OBJECTS_TABLE || `${process.env.PROJECT_NAME ?? "mbapp"}_objects`;
// name of the GSI with partition gsi1pk and sort gsi1sk
exports.GSI1_NAME = process.env.OBJECTS_GSI1_NAME || "gsi1";
const ddbClient = new client_dynamodb_1.DynamoDBClient({ region: REGION /* endpoint: process.env.DDB_ENDPOINT */ });
exports.ddb = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient, {
    marshallOptions: { convertClassInstanceToMap: true, removeUndefinedValues: true, convertEmptyValues: false },
    unmarshallOptions: { wrapNumbers: false },
});
