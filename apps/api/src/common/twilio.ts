import { APIGatewayProxyEvent } from 'aws-lambda';

export interface SendTwilioSmsArgs {
  to: string;
  body: string;
  event: APIGatewayProxyEvent;
}

export interface TwilioSmsResponse {
  sid: string;
  status?: string;
}

/**
 * Send SMS via Twilio API.
 * Requires env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 */
export async function sendTwilioSms(args: SendTwilioSmsArgs): Promise<TwilioSmsResponse> {
  const { to, body, event } = args;

  // Validate required env vars
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid) {
    throw new Error('Missing required env var: TWILIO_ACCOUNT_SID');
  }
  if (!authToken) {
    throw new Error('Missing required env var: TWILIO_AUTH_TOKEN');
  }
  if (!fromNumber) {
    throw new Error('Missing required env var: TWILIO_FROM_NUMBER');
  }

  // Build Twilio API URL
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  // Build form-encoded body
  const params = new URLSearchParams();
  params.append('From', fromNumber);
  params.append('To', to);
  params.append('Body', body);

  // Build Basic Auth header
  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '(unable to read response body)';
      }
      throw new Error(
        `Twilio API returned ${response.status}: ${errorBody}`
      );
    }

    // Parse and return response
    const data = await response.json() as Record<string, unknown>;
    return {
      sid: (data.sid as string) || '',
      status: data.status as string | undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Twilio API')) {
      throw error;
    }
    throw new Error(`Failed to send SMS via Twilio: ${error instanceof Error ? error.message : String(error)}`);
  }
}
