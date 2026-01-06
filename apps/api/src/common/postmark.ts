// apps/api/src/common/postmark.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";

export interface SendPostmarkEmailArgs {
  to: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  tag?: string;
  metadata?: Record<string, string>;
  messageStream?: string;
  event?: APIGatewayProxyEventV2;
}

export interface PostmarkSendResponse {
  messageId: string;
  submittedAt: string;
  to: string;
  errorCode: number;
  message: string;
}

/**
 * Send a single email via Postmark Email API
 * https://postmarkapp.com/developer/api/email-api
 */
export async function sendPostmarkEmail(args: SendPostmarkEmailArgs): Promise<PostmarkSendResponse> {
  const { to, subject, textBody, htmlBody, tag, metadata, messageStream, event } = args;

  // Validate required env vars
  const apiToken = process.env.POSTMARK_API_TOKEN;
  if (!apiToken) {
    throw new Error("POSTMARK_API_TOKEN environment variable not set");
  }

  const fromEmail = process.env.POSTMARK_FROM_EMAIL;
  if (!fromEmail) {
    throw new Error("POSTMARK_FROM_EMAIL environment variable not set");
  }

  // Require at least one body type
  if (!textBody && !htmlBody) {
    throw new Error("Either textBody or htmlBody must be provided");
  }

  // Build request body
  const requestBody: any = {
    From: fromEmail,
    To: to,
    Subject: subject,
    MessageStream: messageStream ?? process.env.POSTMARK_MESSAGE_STREAM ?? "outbound",
  };

  if (textBody) {
    requestBody.TextBody = textBody;
  }
  if (htmlBody) {
    requestBody.HtmlBody = htmlBody;
  }
  if (tag) {
    requestBody.Tag = tag;
  }
  if (metadata) {
    requestBody.Metadata = metadata;
  }

  // Send request
  const url = "https://api.postmarkapp.com/email";
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-Postmark-Server-Token": apiToken,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (err: any) {
    throw new Error(`Postmark API request failed: ${err.message}`);
  }

  // Parse response
  let responseBody: any;
  try {
    responseBody = await response.json();
  } catch {
    throw new Error(`Postmark API returned invalid JSON (status ${response.status})`);
  }

  // Handle non-2xx responses
  if (!response.ok) {
    const errorCode = responseBody.ErrorCode ?? response.status;
    const errorMessage = responseBody.Message ?? "Unknown error";
    throw new Error(
      `Postmark API error (${response.status}): [${errorCode}] ${errorMessage}`
    );
  }

  // Success response structure:
  // { "To": "...", "SubmittedAt": "...", "MessageID": "...", "ErrorCode": 0, "Message": "OK" }
  return {
    messageId: responseBody.MessageID || responseBody.messageId || "",
    submittedAt: responseBody.SubmittedAt || responseBody.submittedAt || new Date().toISOString(),
    to: responseBody.To || to,
    errorCode: responseBody.ErrorCode ?? 0,
    message: responseBody.Message || "OK",
  };
}
