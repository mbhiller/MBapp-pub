// apps/api/src/common/stripe.ts
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import crypto from "crypto";

const IS_PROD = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "dev").toLowerCase() === "prod";

/** Check if Stripe simulate mode is enabled (dev header override allowed in non-prod) */
function isSimulateMode(event?: APIGatewayProxyEventV2): boolean {
  const envSimulate = process.env.FEATURE_STRIPE_SIMULATE?.toLowerCase() === "true";
  if (IS_PROD) return envSimulate;
  
  // In dev, allow header override
  const headerSimulate = event?.headers?.["x-feature-stripe-simulate"] 
    ?? event?.headers?.["X-Feature-Stripe-Simulate"];
  if (headerSimulate) {
    return headerSimulate.toLowerCase() === "true";
  }
  return envSimulate;
}

/** Stripe PaymentIntent response */
export interface StripePaymentIntent {
  id: string;
  clientSecret: string;
}

/** Stripe webhook event */
export interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      status: string;
      metadata?: Record<string, string>;
      [key: string]: any;
    };
  };
}

/** Create a PaymentIntent (real or simulated) */
export async function createPaymentIntent(params: {
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  event?: APIGatewayProxyEventV2;
}): Promise<StripePaymentIntent> {
  const { amount, currency, metadata, idempotencyKey, event } = params;

  // Simulate mode: return deterministic fake PaymentIntent
  if (isSimulateMode(event)) {
    const fakeId = `pi_sim_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
    const fakeSecret = `${fakeId}_secret_${crypto.randomBytes(16).toString("hex")}`;
    
    return {
      id: fakeId,
      clientSecret: fakeSecret,
    };
  }

  // Real Stripe integration
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY environment variable not set");
  }

  // Dynamically import Stripe SDK (lazy load to avoid cold start penalty if simulate mode)
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-12-15.clover" });

  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount,
      currency,
      metadata: metadata ?? {},
      automatic_payment_methods: { enabled: true },
    },
    idempotencyKey ? { idempotencyKey } : undefined
  );

  return {
    id: paymentIntent.id,
    clientSecret: paymentIntent.client_secret!,
  };
}

/** Verify Stripe webhook signature and parse event (real or simulated) */
export async function verifyWebhook(params: {
  rawBody: string;
  signatureHeader: string;
  event?: APIGatewayProxyEventV2;
}): Promise<StripeEvent> {
  const { rawBody, signatureHeader, event } = params;

  // Simulate mode: simple HMAC verification or known pattern
  if (isSimulateMode(event)) {
    const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_sim_default";
    
    // For smoke tests: accept a known signature pattern "sim_valid_signature"
    if (signatureHeader === "sim_valid_signature") {
      try {
        return JSON.parse(rawBody) as StripeEvent;
      } catch {
        throw new Error("Invalid webhook body in simulate mode");
      }
    }

    // Otherwise verify HMAC signature (simple simulation)
    // Stripe signature format: t=timestamp,v1=signature
    const parts = signatureHeader.split(",").reduce((acc, part) => {
      const [key, value] = part.split("=");
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    const timestamp = parts.t;
    const signature = parts.v1;

    if (!timestamp || !signature) {
      throw new Error("Invalid signature format (simulate mode)");
    }

    // Verify HMAC: sha256(timestamp.rawBody)
    const expectedSignature = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    if (signature !== expectedSignature) {
      throw new Error("Invalid signature (simulate mode)");
    }

    try {
      return JSON.parse(rawBody) as StripeEvent;
    } catch {
      throw new Error("Invalid webhook body in simulate mode");
    }
  }

  // Real Stripe webhook verification
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET environment variable not set");
  }

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-12-15.clover" });

  try {
    const stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      WEBHOOK_SECRET
    );
    return stripeEvent as unknown as StripeEvent;
  } catch (err: any) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }
}
