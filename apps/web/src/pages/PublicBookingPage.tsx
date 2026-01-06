import { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, useElements, useStripe, CardElement } from "@stripe/react-stripe-js";

type EventSummary = {
  id: string;
  name?: string;
  description?: string;
  status?: string;
  startsAt?: string;
  endsAt?: string;
  capacity?: number | null;
  reservedCount?: number | null;
};

type RegistrationResponse = {
  registration: any;
  publicToken: string;
};

type PaymentIntentResponse = {
  paymentIntentId: string;
  clientSecret: string;
};

type ApiOptions = {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
};

async function publicFetch<T>(apiBase: string, publicTenant: string, path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, headers } = opts;
  const url = `${apiBase.replace(/\/$/, "")}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      "x-tenant-id": publicTenant,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(url, init);
  if (!res.ok) {
    const payload = await res.json().catch(() => undefined);
    const message = payload?.message || payload?.error || res.statusText;
    const err: any = new Error(message);
    err.status = res.status;
    err.code = payload?.code;
    err.details = payload;
    throw err;
  }
  return res.json();
}

function randomKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function BookingForm({ apiBase, publicTenant }: { apiBase: string; publicTenant: string }) {
  const stripe = useStripe();
  const elements = useElements();

  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [registration, setRegistration] = useState<any>(null);
  const [publicToken, setPublicToken] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [holdExpired, setHoldExpired] = useState(false);
  const [localRegStatus, setLocalRegStatus] = useState<string>("");

  function resetAll() {
    setSelectedEventId((prev) => prev);
    setRegistration(null);
    setPublicToken(null);
    setClientSecret(null);
    setPaymentIntentId(null);
    setStatusMessage("");
    setErrorMessage("");
    setIsSubmitting(false);
    setHoldExpired(false);
    setLocalRegStatus("");
  }

  useEffect(() => {
    (async () => {
      try {
        setLoadingEvents(true);
        const res = await publicFetch<{ items: EventSummary[] }>(apiBase, publicTenant, "/events:public", { method: "GET" });
        setEvents(res.items || []);
        if (res.items?.length) setSelectedEventId(res.items[0].id);
      } catch (err: any) {
        setErrorMessage(err?.message || "Failed to load events");
      } finally {
        setLoadingEvents(false);
      }
    })();
  }, []);

  async function createRegistration() {
    if (!selectedEventId) return;
    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("Creating reservation...");
    try {
      const res = await publicFetch<RegistrationResponse>(apiBase, publicTenant, "/registrations:public", {
        method: "POST",
        body: { eventId: selectedEventId },
      });
      setRegistration(res.registration);
      setPublicToken(res.publicToken);
      return res;
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to create registration");
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function checkout(regRes: RegistrationResponse | null = null) {
    const reg = regRes?.registration || registration;
    const token = regRes?.publicToken || publicToken;
    if (!reg || !token) return;
    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("Starting checkout...");
    try {
      const idem = randomKey();
      const res = await publicFetch<PaymentIntentResponse>(apiBase, publicTenant, `/events/registration/${reg.id}:checkout`, {
        method: "POST",
        headers: {
          "X-MBapp-Public-Token": token,
          "Idempotency-Key": idem,
        },
      });
      setClientSecret(res.clientSecret);
      setPaymentIntentId(res.paymentIntentId);
      setStatusMessage("Payment intent created. Please enter card details.");
    } catch (err: any) {
      if (err?.status === 409 && err?.code === "hold_expired") {
        setHoldExpired(true);
        setErrorMessage("Your hold expired. Please restart to try again.");
        setStatusMessage("");
      } else {
        setErrorMessage(err?.message || "Checkout failed");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmPayment() {
    if (!stripe || !elements || !clientSecret) return;
    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("Confirming payment...");
    const card = elements.getElement(CardElement);
    if (!card) {
      setErrorMessage("Card element missing");
      setIsSubmitting(false);
      return;
    }
    const result = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card },
    });
    if (result.error) {
      setErrorMessage(result.error.message || "Payment failed");
      setIsSubmitting(false);
      return;
    }
    setStatusMessage("Payment submitted. Waiting for confirmation...");
    setIsSubmitting(false);

    // Bounded polling for confirmation via Stripe PI status (minimal)
    try {
      let tries = 0;
      let confirmed = false;
      while (tries < 10 && !confirmed) {
        tries += 1;
        const r = await stripe.retrievePaymentIntent(clientSecret);
        const pi = r.paymentIntent;
        if (pi && pi.status === "succeeded") {
          confirmed = true;
          setLocalRegStatus("confirmed");
          setStatusMessage("Payment confirmed. Your booking is confirmed.");
          break;
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
      if (!confirmed) {
        setStatusMessage("Still processing... please wait or refresh later.");
      }
    } catch (e: any) {
      // Non-fatal: leave in processing state
    }
  }

  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId), [events, selectedEventId]);

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", display: "grid", gap: 12 }}>
      <h1>Public Event Booking (AU)</h1>
      {loadingEvents && <div>Loading events...</div>}
      {events.length === 0 && !loadingEvents && <div>No open events found.</div>}
      {events.length > 0 && (
        <label style={{ display: "grid", gap: 4 }}>
          <span>Choose event</span>
          <select
            value={selectedEventId ?? ""}
            onChange={(e) => setSelectedEventId(e.target.value || null)}
            disabled={isSubmitting}
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name || ev.id} {ev.capacity != null ? `(Cap ${ev.capacity}, Reserved ${ev.reservedCount ?? 0})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        onClick={async () => {
          const res = await createRegistration();
          await checkout(res || null);
        }}
        disabled={!selectedEventId || isSubmitting}
      >
        Reserve 1 spot
      </button>

      {registration && (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <div><strong>Registration:</strong> {registration.id}</div>
          <div><strong>Status:</strong> {localRegStatus || registration.status}</div>
        </div>
      )}

      {clientSecret && (
        <div style={{ display: "grid", gap: 8 }}>
          <CardElement options={{ hidePostalCode: true }} />
          <button onClick={handleConfirmPayment} disabled={!stripe || isSubmitting}>
            Pay now
          </button>
        </div>
      )}

      {paymentIntentId && <div>Payment Intent: {paymentIntentId}</div>}
      {statusMessage && <div>{statusMessage}</div>}
      {errorMessage && <div style={{ color: "red" }}>{errorMessage}</div>}
      {holdExpired && (
        <div style={{ display: "grid", gap: 8 }}>
          <div>Your reservation hold expired. Please restart.</div>
          <button onClick={resetAll} disabled={isSubmitting}>Restart</button>
        </div>
      )}
    </div>
  );
}

export default function PublicBookingPage() {
  const apiBase = import.meta.env.VITE_API_BASE;
  const publicTenant = import.meta.env.VITE_PUBLIC_TENANT_ID || "DemoTenant";
  const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

  const stripePromise = useMemo(() => (stripePk ? loadStripe(stripePk) : null), [stripePk]);

  if (!apiBase) {
    return <div style={{ padding: 16 }}>Public booking is unavailable: missing VITE_API_BASE.</div>;
  }

  if (!stripePk || !stripePromise) {
    return <div style={{ padding: 16 }}>Public booking is unavailable: missing VITE_STRIPE_PUBLISHABLE_KEY.</div>;
  }

  return (
    <Elements stripe={stripePromise}>
      <BookingForm apiBase={apiBase} publicTenant={publicTenant} />
    </Elements>
  );
}
