import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PublicCheckInPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!email.trim()) {
      setMessage({ kind: "error", text: "Please enter an email address." });
      return;
    }

    setSubmitting(true);

    // Placeholder for future implementation
    // When backend endpoint exists, call it here
    await new Promise((resolve) => setTimeout(resolve, 500));

    setMessage({
      kind: "info",
      text: "Public check-in is coming next. If you're event staff, please use the Operator Console.",
    });

    setSubmitting(false);
  };

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
