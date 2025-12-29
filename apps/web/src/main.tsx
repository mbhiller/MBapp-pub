import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./providers/AuthProvider";
import posthog from "posthog-js";
import * as Sentry from "@sentry/browser";

// Initialize PostHog if API key is present (safe no-op otherwise)
const posthogApiKey = import.meta.env.VITE_POSTHOG_API_KEY as string | undefined;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST as string | undefined;
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (posthogApiKey) {
	posthog.init(posthogApiKey, {
		api_host: posthogHost || "https://app.posthog.com",
		capture_pageview: false, // Manual tracking via telemetry helper
		capture_pageleave: true,
		persistence: "localStorage",
	});
}

// Initialize Sentry if DSN is present (safe no-op otherwise)
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    // Keep minimal config; breadcrumbs come from default integrations
  });
}

const root = createRoot(document.getElementById("root")!);

root.render(
	<React.StrictMode>
		<AuthProvider>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</AuthProvider>
	</React.StrictMode>
);
