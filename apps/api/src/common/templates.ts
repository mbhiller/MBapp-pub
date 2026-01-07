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
      const rvQty = Number(vars.rvQty ?? 0);
      const rvUnitAmount = typeof vars.rvUnitAmount === "number" ? (vars.rvUnitAmount as number) : undefined;
      const rvAmount = typeof vars.rvAmount === "number" ? (vars.rvAmount as number) : undefined;
      const hasRv = rvQty > 0 && typeof rvUnitAmount === "number" && typeof rvAmount === "number";

      const lines: string[] = [
        `Your registration ${registrationId} is confirmed. PaymentIntent ${paymentIntentId}.`,
      ];
      if (hasRv) {
        const unit = (rvUnitAmount! / 100).toFixed(2);
        const amt = (rvAmount! / 100).toFixed(2);
        lines.push(`RV Spots: ${rvQty} x $${unit} = $${amt}`);
      }
      return {
        channel: "email",
        subject: "Registration Confirmed",
        body: lines.join("\n"),
      };
    }

    case "registration.confirmed.sms": {
      validateVars(templateKey, vars, ["registrationId"]);
      const registrationId = vars.registrationId as string;
      const rvQty = Number(vars.rvQty ?? 0);
      const rvUnitAmount = typeof vars.rvUnitAmount === "number" ? (vars.rvUnitAmount as number) : undefined;
      const rvAmount = typeof vars.rvAmount === "number" ? (vars.rvAmount as number) : undefined;
      const hasRv = rvQty > 0 && typeof rvUnitAmount === "number" && typeof rvAmount === "number";

      let body = `Your registration ${registrationId} is confirmed.`;
      if (hasRv) {
        const unit = (rvUnitAmount! / 100).toFixed(2);
        const amt = (rvAmount! / 100).toFixed(2);
        body += ` RV: ${rvQty} x $${unit} = $${amt}`;
      }
      return {
        channel: "sms",
        body,
      };
    }

    default:
      const _: never = templateKey;
      throw new Error(`[templates] Unknown template: ${templateKey}`);
  }
}
