// apps/api/src/registrations/lookup-public.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import crypto from "crypto";
import { ok, badRequest } from "../common/responses";
import { getObjectById, listObjects, updateObject, listRegistrationsByEventId } from "../objects/repo";
import { getTenantId } from "../common/env";
import { enqueueEmail } from "../common/notify";

// Simple in-memory rate limiter (10 requests/hour per IP)
// Note: This is stateless per Lambda instance; for production, use Redis/DynamoDB
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  
  if (!record || now > record.resetAt) {
    // Reset or create new window
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (record.count >= RATE_LIMIT_MAX) {
    return false; // Rate limit exceeded
  }
  
  record.count++;
  return true;
}

function getClientIp(event: APIGatewayProxyEventV2): string {
  return event.requestContext?.http?.sourceIp || "unknown";
}

/**
 * POST /registrations:lookup-public
 * Public endpoint: send magic link for "My Check-In" without leaking email existence
 * Security: Always returns success, rate-limited by IP, never reveals whether email exists
 */
export async function handle(event: APIGatewayProxyEventV2) {
  try {
    const tenantId = getTenantId(event);
    const body = JSON.parse(event.body || "{}");

    // Validate required fields
    if (!body.eventId || typeof body.eventId !== "string") {
      return badRequest("eventId is required and must be a string", { 
        code: "invalid_request",
        field: "eventId" 
      });
    }

    if (!body.email || typeof body.email !== "string") {
      return badRequest("email is required and must be a string", { 
        code: "invalid_request",
        field: "email" 
      });
    }

    // Normalize email
    const email = String(body.email).trim().toLowerCase();
    if (!email) {
      return badRequest("email must be a non-empty string", { 
        code: "invalid_request",
        field: "email" 
      });
    }

    const deliveryMethod = body.deliveryMethod || "email";
    if (!["email", "sms"].includes(deliveryMethod)) {
      return badRequest("deliveryMethod must be 'email' or 'sms'", { 
        code: "invalid_request",
        field: "deliveryMethod" 
      });
    }

    // Check rate limit
    const clientIp = getClientIp(event);
    const withinLimit = checkRateLimit(clientIp);

    // SECURITY: Always return success to prevent email enumeration
    const successResponse = ok({
      sent: true,
      message: "If we found a match, we sent a link.",
    });

    // If rate limited, return success but don't send
    if (!withinLimit) {
      return successResponse;
    }

    // Lookup registrations by eventId
    const registrationsPage = await listRegistrationsByEventId({
      tenantId,
      eventId: body.eventId,
      limit: 100, // Reasonable max for one email
    });

    // Filter registrations by email (match against party.email or partyId→email)
    const matchingRegistrations = [];
    
    for (const reg of registrationsPage.items) {
      const registration = reg as any;
      
      // Check party.email if present
      if (registration.party?.email?.toLowerCase() === email) {
        matchingRegistrations.push(registration);
        continue;
      }
      
      // Check partyId→email
      if (registration.partyId) {
        try {
          const party = await getObjectById({
            tenantId,
            type: "party",
            id: registration.partyId,
            fields: ["email"],
          });
          
          if ((party as any)?.email?.toLowerCase() === email) {
            matchingRegistrations.push(registration);
          }
        } catch {
          // Party not found or error: skip
        }
      }
    }

    // If no matches, return success without sending
    if (matchingRegistrations.length === 0) {
      return successResponse;
    }

    // Ensure each matching registration has a publicTokenHash
    const registrationsWithTokens = [];
    
    for (const registration of matchingRegistrations) {
      let publicToken: string;
      let publicTokenHash = registration.publicTokenHash;
      
      if (!publicTokenHash) {
        // Generate new token
        publicToken = crypto.randomBytes(32).toString("hex");
        publicTokenHash = crypto.createHash("sha256").update(publicToken).digest("hex");
        
        // Persist hash to registration
        await updateObject({
          tenantId,
          type: "registration",
          id: registration.id,
          body: { publicTokenHash },
        });
      } else {
        // Token already exists; we can't recover the raw token, so generate a new one
        // This is acceptable for magic link use case (user requests new link)
        publicToken = crypto.randomBytes(32).toString("hex");
        publicTokenHash = crypto.createHash("sha256").update(publicToken).digest("hex");
        
        // Update with new hash
        await updateObject({
          tenantId,
          type: "registration",
          id: registration.id,
          body: { publicTokenHash },
        });
      }
      
      registrationsWithTokens.push({
        registration,
        publicToken,
      });
    }

    // Get base URL from env (default to localhost for dev)
    const publicWebBaseUrl = process.env.MBAPP_PUBLIC_WEB_BASE_URL || "http://localhost:5173";

    // Send magic link(s)
    if (deliveryMethod === "email") {
      // Build email body with link(s)
      let emailBody = "Here is your registration check-in link:\n\n";
      let htmlBody = "<p>Here is your registration check-in link:</p><ul>";
      
      for (const { registration, publicToken } of registrationsWithTokens) {
        const magicLink = `${publicWebBaseUrl}/events/${registration.eventId}/my-checkin?regId=${registration.id}&token=${publicToken}`;
        emailBody += `${magicLink}\n\n`;
        htmlBody += `<li><a href="${magicLink}">Check-in for Registration ${registration.id}</a></li>`;
      }
      
      htmlBody += "</ul>";

      // Enqueue email (simulate mode will mark sent and persist message)
      await enqueueEmail({
        tenantId: tenantId!,
        to: email,
        subject: "Your Check-In Link",
        body: htmlBody,
        metadata: {
          eventId: String(body.eventId),
          registrationCount: String(registrationsWithTokens.length),
        },
        event,
      });
    } else {
      // SMS not implemented this sprint
      // Future: use sendTwilioSms similar to email flow
    }

    return successResponse;
  } catch (err: any) {
    console.error(JSON.stringify({
      event: "registrations:lookup-public:error",
      error: err.message,
      stack: err.stack,
    }));
    
    // SECURITY: Never leak internal errors
    return ok({
      sent: true,
      message: "If we found a match, we sent a link.",
    });
  }
}
