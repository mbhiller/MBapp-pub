import { useState, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/http";

type PublicRegistrationStatus = {
  id: string;
  eventId: string;
  status: string;
  paymentStatus?: string | null;
  submittedAt?: string | null;
  confirmedAt?: string | null;
  cancelledAt?: string | null;
  refundedAt?: string | null;
  holdExpiresAt?: string | null;
  checkInStatus?: {
    ready: boolean;
    blockers: Array<{
      code: string;
      message: string;
      action?: {
        type: string;
        label: string;
        target: string;
      };
    }>;
    lastEvaluatedAt: string;
    version?: number | null;
  } | null;
  emailStatus?: any;
  smsStatus?: any;
};

export default function PublicCheckInPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  // Session mode state
  const [registrationStatus, setRegistrationStatus] = useState<PublicRegistrationStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Extract token params
  const regId = searchParams.get("regId");
  const token = searchParams.get("token");
  const isSessionMode = !!(regId && token);

  // Load registration status on mount if in session mode
  useEffect(() => {
    if (!isSessionMode) return;

    const loadStatus = async () => {
      setLoadingStatus(true);
      setStatusError(null);

      try {
        const status = await apiFetch<PublicRegistrationStatus>(
          `/registrations/${regId}:public`,
          {
            headers: {
              "X-MBapp-Public-Token": token || "",
            },
          }
        );

        setRegistrationStatus(status);
      } catch (err: any) {
        console.error("Failed to load registration status:", err);
        setStatusError(err.message || "Failed to load check-in status");
      } finally {
        setLoadingStatus(false);
      }
    };

    loadStatus();
  }, [isSessionMode, regId, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!email.trim()) {
      setMessage({ kind: "error", text: "Please enter an email address." });
      return;
    }

    if (!eventId) {
      setMessage({ kind: "error", text: "Event ID is missing." });
      return;
    }

    setSubmitting(true);

    try {
      await apiFetch("/registrations:lookup-public", {
        method: "POST",
        body: {
          eventId,
          email: email.trim().toLowerCase(),
          deliveryMethod: "email",
        },
      });

      setMessage({
        kind: "info",
        text: "If we found a match, we sent a link to your email.",
      });
      setEmail(""); // Clear form
    } catch (err: any) {
      console.error("Failed to request check-in link:", err);
      // Always show success message for security (no email enumeration)
      setMessage({
        kind: "info",
        text: "If we found a match, we sent a link to your email.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Session mode: Display registration status
  if (isSessionMode) {
    if (loadingStatus) {
      return (
        <div className="container mx-auto max-w-2xl p-6">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">Loading your check-in status...</p>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (statusError) {
      return (
        <div className="container mx-auto max-w-2xl p-6">
          <Card>
            <CardHeader>
              <CardTitle>Error</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {statusError}
              </div>
              <div className="mt-4">
                <Link
                  to={`/events/${eventId}/my-checkin`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  ← Request a new link
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (!registrationStatus) {
      return null;
    }

    const { checkInStatus, status, paymentStatus } = registrationStatus;

    return (
      <div className="container mx-auto max-w-2xl p-6">
        <div className="mb-4">
          <Link to={`/events/${eventId}`} className="text-sm text-blue-600 hover:underline">
            ← Back to Event
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Check-In Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Registration Status</p>
              <p className="text-lg font-semibold capitalize">{status}</p>
            </div>

            {paymentStatus && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Payment Status</p>
                <p className="text-lg font-semibold capitalize">{paymentStatus}</p>
              </div>
            )}

            {checkInStatus && (
              <div className="mt-6 border-t pt-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Check-In Ready</p>
                  <p
                    className={`text-lg font-semibold ${
                      checkInStatus.ready ? "text-green-600" : "text-orange-600"
                    }`}
                  >
                    {checkInStatus.ready ? "Yes" : "No"}
                  </p>
                </div>

                {checkInStatus.blockers && checkInStatus.blockers.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-sm font-medium text-muted-foreground">Blockers</p>
                    <ul className="space-y-2">
                      {checkInStatus.blockers.map((blocker, idx) => (
                        <li key={idx} className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
                          <p className="text-sm font-medium text-orange-900">{blocker.message}</p>
                          <p className="text-xs text-orange-700">Code: {blocker.code}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {checkInStatus.ready && (
                  <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                    ✓ You're all set! Please proceed to the check-in desk.
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 border-t pt-6">
              <Link
                to={`/events/${eventId}/my-checkin`}
                className="text-sm text-blue-600 hover:underline"
              >
                Request a new link
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Request mode: Email form
  return (
    <div className="container mx-auto max-w-md p-6">
      <div className="mb-4">
        <Link to={`/events/${eventId}`} className="text-sm text-blue-600 hover:underline">
          ← Back to Event
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Check In</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the email address you used when registering for this event.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>

            {message && (
              <div
                className={
                  message.kind === "info"
                    ? "rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
                    : "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                }
              >
                {message.text}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Processing..." : "Continue"}
            </Button>
          </form>

          <div className="mt-6 border-t pt-6">
            <p className="text-sm text-muted-foreground">
              Event staff should use the{" "}
              <Link
                to={`/events/${eventId}/checkin`}
                className="font-medium text-blue-600 hover:underline"
              >
                Operator Console
              </Link>
              .
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
