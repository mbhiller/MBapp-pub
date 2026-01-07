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
  rvEnabled?: boolean | null;
  rvCapacity?: number | null;
  rvUnitAmount?: number | null;
  rvReserved?: number | null;
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
  const [rvQty, setRvQty] = useState<number>(0);
  const [serverTotalAmount, setServerTotalAmount] = useState<number | null>(null);
  const [serverCurrency, setServerCurrency] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [holdExpired, setHoldExpired] = useState(false);
  const [localRegStatus, setLocalRegStatus] = useState<string>("");
  const [serverStatus, setServerStatus] = useState<any>(null);
  const [holdTimeRemaining, setHoldTimeRemaining] = useState<string>("");
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string>("");

  function resetAll() {
    setSelectedEventId((prev) => prev);
    setRegistration(null);
    setPublicToken(null);
    setClientSecret(null);
    setPaymentIntentId(null);
    setServerTotalAmount(null);
    setServerCurrency(null);
    setStatusMessage("");
    setErrorMessage("");
    setIsSubmitting(false);
    setHoldExpired(false);
    setLocalRegStatus("");
    setResendMessage("");
    setRvQty(0);
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

  useEffect(() => {
    if (!serverStatus?.holdExpiresAt) return;
    const interval = setInterval(() => {
      const expiresAt = new Date(serverStatus.holdExpiresAt).getTime();
      const now = Date.now();
      if (now >= expiresAt && serverStatus.status !== "confirmed") {
        setHoldTimeRemaining("Hold expired");
        setHoldExpired(true);
        clearInterval(interval);
        return;
      }
      const diffMs = expiresAt - now;
      const mins = Math.floor(diffMs / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      setHoldTimeRemaining(`${mins}m ${secs}s`);
    }, 1000);
    return () => clearInterval(interval);
  }, [serverStatus]);

  useEffect(() => {
    // Reset RV qty when switching events
    setRvQty(0);
  }, [selectedEventId]);

  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId), [events, selectedEventId]);

  const rvUnit = useMemo(() => {
    const amt = selectedEvent?.rvUnitAmount ?? null;
    return typeof amt === "number" && amt >= 0 ? amt : null;
  }, [selectedEvent]);

  const rvCapacityRemaining = useMemo(() => {
    if (!selectedEvent) return null;
    if (selectedEvent.rvCapacity == null) return null; // unknown/unlimited
    const reserved = selectedEvent.rvReserved ?? 0;
    const rem = Math.max(0, (selectedEvent.rvCapacity || 0) - reserved);
    return rem;
  }, [selectedEvent]);

  const rvMaxSelectable = useMemo(() => {
    const cap = rvCapacityRemaining;
    const hardCap = 10;
    if (cap == null) return hardCap;
    return Math.max(0, Math.min(hardCap, cap));
  }, [rvCapacityRemaining]);

  const rvSubtotal = useMemo(() => {
    if (!rvUnit) return 0;
    return (rvQty || 0) * rvUnit;
  }, [rvUnit, rvQty]);

  async function createRegistration() {
    if (!selectedEventId) return;
    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("Creating reservation...");
    try {
      const res = await publicFetch<RegistrationResponse>(apiBase, publicTenant, "/registrations:public", {
        method: "POST",
        body: { eventId: selectedEventId, ...(rvQty > 0 ? { rvQty } : {}) },
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

  async function pollServerStatus(regId: string, token: string) {
    let tries = 0;
    const maxTries = 30;
    let delayMs = 1000; // start at 1s
    const maxDelayMs = 10000; // cap at 10s
    let lastError: any = null;

    while (tries < maxTries) {
      tries += 1;
      try {
        const status = await publicFetch<any>(apiBase, publicTenant, `/registrations/${regId}:public`, {
          method: "GET",
          headers: { "X-MBapp-Public-Token": token },
        });
        setServerStatus(status);
        setLocalRegStatus(status.status);
        lastError = null;
        setErrorMessage(""); // clear any transient errors

        // Check hold expiration before processing status
        if (status.holdExpiresAt) {
          const holdExpiresMs = new Date(status.holdExpiresAt).getTime();
          if (Date.now() >= holdExpiresMs && status.status !== "confirmed") {
            setStatusMessage("Hold expired. Please try again.");
            setHoldExpired(true);
            return;
          }
        }

        // Success: confirmed
        if (status.status === "confirmed") {
          setStatusMessage("Booking confirmed!");
          return;
        }

        // Terminal failure: cancelled or payment failed
        if (status.status === "cancelled" || status.paymentStatus === "failed") {
          setStatusMessage("Booking could not be completed. Please contact support.");
          return;
        }

        // Still waiting; update progress message
        if (tries === 1) {
          setStatusMessage("Payment submitted. Checking status…");
        }
      } catch (err: any) {
        lastError = err;
        // Show transient error message but continue polling
        if (tries > 5) {
          setStatusMessage("Having trouble checking status… retrying");
        }
      }

      if (tries < maxTries) {
        // Exponential backoff with jitter to avoid thundering herd
        const jitterMs = Math.random() * 500; // 0-500ms random jitter
        const actualDelay = Math.min(delayMs + jitterMs, maxDelayMs);
        await new Promise((res) => setTimeout(res, actualDelay));
        delayMs = Math.min(delayMs * 2, maxDelayMs); // double delay, capped at 10s
      }
    }

    // Exhausted all retries
    if (lastError) {
      setStatusMessage("Unable to reach the server. Please refresh to check status.");
    } else {
      setStatusMessage("Still processing… please refresh later.");
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
      const res = await publicFetch<PaymentIntentResponse & { totalAmount?: number; currency?: string }>(apiBase, publicTenant, `/events/registration/${reg.id}:checkout`, {
        method: "POST",
        headers: {
          "X-MBapp-Public-Token": token,
          "Idempotency-Key": idem,
        },
      });
      setClientSecret(res.clientSecret);
      setPaymentIntentId(res.paymentIntentId);
      if (typeof (res as any).totalAmount === "number") setServerTotalAmount((res as any).totalAmount);
      if (typeof (res as any).currency === "string") setServerCurrency((res as any).currency || null);
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

  async function handleResendConfirmation() {
    if (!registration?.id || !publicToken) return;
    setIsResending(true);
    setResendMessage("");
    try {
      const result = await publicFetch<any>(apiBase, publicTenant, `/registrations/${registration.id}:public-resend`, {
        method: "POST",
        headers: { "X-MBapp-Public-Token": publicToken },
      });
      if (result.rateLimited) {
        setResendMessage("Please wait a bit and try again.");
      } else {
        setResendMessage("Resend requested. Refreshing status…");
        // Trigger immediate refresh of status
        await new Promise((res) => setTimeout(res, 1000));
        const status = await publicFetch<any>(apiBase, publicTenant, `/registrations/${registration.id}:public`, {
          method: "GET",
          headers: { "X-MBapp-Public-Token": publicToken },
        });
        setServerStatus(status);
        setResendMessage("Resend complete.");
      }
    } catch (err: any) {
      setResendMessage(err?.message || "Failed to resend. Please try again.");
    } finally {
      setIsResending(false);
    }
  }

  async function handleConfirmPayment() {
    if (!stripe || !elements || !clientSecret) return;
    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("Payment submitted. Waiting for confirmation…");
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
    setIsSubmitting(false);

    // Poll server status for confirmation
    if (registration?.id && publicToken) {
      pollServerStatus(registration.id, publicToken);
    }
  }

  

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

      {/* RV Add-on */}
      {selectedEvent?.rvEnabled && (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>RV Add-on</div>
          <div>Unit: {rvUnit != null ? `$${(rvUnit / 100).toFixed(2)}` : "N/A"}</div>
          {rvCapacityRemaining != null && (
            <div>RV Remaining: {rvCapacityRemaining}</div>
          )}
          <label style={{ display: "grid", gap: 4 }}>
            <span>RV Quantity</span>
            <select value={rvQty} onChange={(e) => setRvQty(parseInt(e.target.value, 10) || 0)} disabled={isSubmitting}>
              {Array.from({ length: rvMaxSelectable + 1 }).map((_, i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </label>
          <div>RV Subtotal: ${((rvSubtotal || 0) / 100).toFixed(2)}</div>
        </div>
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
          {serverStatus?.confirmedAt && <div><strong>Confirmed:</strong> {new Date(serverStatus.confirmedAt).toLocaleString()}</div>}
          {holdTimeRemaining && <div><strong>Hold:</strong> {holdTimeRemaining}</div>}
          
          {/* Email delivery status */}
          {serverStatus?.emailStatus && (
            <div style={{ marginTop: 8, padding: 8, backgroundColor: "#f5f5f5", borderRadius: 4 }}>
              <strong>Email:</strong> {serverStatus.emailStatus.status}
              {serverStatus.emailStatus.sentAt && (
                <span> at {new Date(serverStatus.emailStatus.sentAt).toLocaleTimeString()}</span>
              )}
              {serverStatus.emailStatus.provider && (
                <span> ({serverStatus.emailStatus.provider})</span>
              )}
              {serverStatus.emailStatus.status === "failed" && serverStatus.emailStatus.errorMessage && (
                <div style={{ fontSize: 12, color: "#d32f2f", marginTop: 4 }}>
                  Issue: {serverStatus.emailStatus.errorMessage.substring(0, 80)}
                  {serverStatus.emailStatus.errorMessage.length > 80 ? "…" : ""}
                </div>
              )}
            </div>
          )}

          {/* SMS delivery status */}
          {serverStatus?.smsStatus && (
            <div style={{ marginTop: 8, padding: 8, backgroundColor: "#f5f5f5", borderRadius: 4 }}>
              <strong>SMS:</strong> {serverStatus.smsStatus.status}
              {serverStatus.smsStatus.sentAt && (
                <span> at {new Date(serverStatus.smsStatus.sentAt).toLocaleTimeString()}</span>
              )}
              {serverStatus.smsStatus.provider && (
                <span> ({serverStatus.smsStatus.provider})</span>
              )}
              {serverStatus.smsStatus.status === "failed" && serverStatus.smsStatus.errorMessage && (
                <div style={{ fontSize: 12, color: "#d32f2f", marginTop: 4 }}>
                  Issue: {serverStatus.smsStatus.errorMessage.substring(0, 80)}
                  {serverStatus.smsStatus.errorMessage.length > 80 ? "…" : ""}
                </div>
              )}
            </div>
          )}

          {/* Resend button: show when confirmed and delivery failed */}
          {localRegStatus === "confirmed" &&
            (serverStatus?.emailStatus?.status === "failed" || serverStatus?.smsStatus?.status === "failed") && (
            <button
              onClick={handleResendConfirmation}
              disabled={isResending}
              style={{ marginTop: 8, backgroundColor: "#ff9800", color: "white", padding: "8px 12px", border: "none", borderRadius: 4, cursor: isResending ? "not-allowed" : "pointer" }}
            >
              {isResending ? "Resending…" : "Resend Confirmation"}
            </button>
          )}
          {resendMessage && <div style={{ marginTop: 8, fontSize: 13, color: resendMessage.includes("complete") ? "#4caf50" : "#d32f2f" }}>{resendMessage}</div>}
        </div>
      )}

      {clientSecret && (
        <div style={{ display: "grid", gap: 8 }}>
          <CardElement options={{ hidePostalCode: true }} />
          <button onClick={handleConfirmPayment} disabled={!stripe || isSubmitting}>
            Pay now
          </button>
          {(serverTotalAmount != null) && (
            <div>Total: ${((serverTotalAmount || 0) / 100).toFixed(2)}{serverCurrency ? ` ${serverCurrency.toUpperCase()}` : ""}</div>
          )}
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
