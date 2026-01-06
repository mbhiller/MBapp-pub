/**
 * Template renderer for notifications (Sprint BA)
 * Minimal, deterministic template system for email/sms.
 */

export type TemplateKey =
  | "registration.confirmed.email"
  | "registration.confirmed.sms";

export interface RenderResult {
  channel: "email" | "sms";
  subject?: string;
  body: string;
}

/**
 * Validate that required vars are present for a template.
 * Throws a descriptive error if any required var is missing or falsy.
 */
function validateVars(
  templateKey: TemplateKey,
  vars: Record<string, unknown>,
  required: string[]
) {
  const missing = required.filter((key) => !vars[key]);
  if (missing.length > 0) {
    throw new Error(
      `[templates] Template "${templateKey}" missing required vars: ${missing.join(", ")}`
    );
  }
}

/**
 * Render a template with variables.
 * Returns channel type, subject (if email), and body.
 */
export function renderTemplate(
  templateKey: TemplateKey,
  vars: Record<string, unknown>
): RenderResult {
  switch (templateKey) {
    case "registration.confirmed.email": {
      validateVars(templateKey, vars, ["registrationId", "paymentIntentId"]);
      const registrationId = vars.registrationId as string;
      const paymentIntentId = vars.paymentIntentId as string;
      return {
        channel: "email",
        subject: "Registration Confirmed",
        body: `Your registration ${registrationId} is confirmed. PaymentIntent ${paymentIntentId}.`,
      };
    }

    case "registration.confirmed.sms": {
      validateVars(templateKey, vars, ["registrationId"]);
      const registrationId = vars.registrationId as string;
      return {
        channel: "sms",
        body: `Your registration ${registrationId} is confirmed.`,
      };
    }

    default:
      const _: never = templateKey;
      throw new Error(`[templates] Unknown template: ${templateKey}`);
  }
}
