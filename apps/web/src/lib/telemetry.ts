// apps/web/src/lib/telemetry.ts
import posthog from "posthog-js";

/**
 * PostHog-backed telemetry helper for web.
 * 
 * Safe no-op if PostHog not initialized (missing VITE_POSTHOG_API_KEY).
 * Automatically includes envelope fields: ts, source, route, tenantId, actorId (when available).
 * 
 * Usage:
 *   track("button_clicked", { buttonName: "ignore_backorder", backorderId: "bo_123" });
 *   track("screen_viewed", { screenName: "BackorderDetail" });
 */

/** Check if PostHog is initialized (has instance ID) */
function isPostHogReady(): boolean {
	try {
		return posthog.__loaded === true;
	} catch {
		return false;
	}
}

/** Attempt to read tenantId from localStorage (set by AuthProvider) */
function getTenantId(): string | undefined {
	try {
		return localStorage.getItem("mbapp_tenant") || undefined;
	} catch {
		return undefined;
	}
}

/** Attempt to extract actorId (userId) from stored JWT token */
function getActorId(): string | undefined {
	try {
		const token = localStorage.getItem("mbapp_bearer");
		if (!token) return undefined;

		const parts = token.split(".");
		if (parts.length !== 3) return undefined;

		const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
		return payload?.sub || payload?.userId || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Track a telemetry event.
 * 
 * @param eventName - Event name (e.g., "button_clicked", "screen_viewed")
 * @param properties - Optional event-specific properties (no PII)
 */
export function track(eventName: string, properties?: Record<string, any>): void {
	if (!isPostHogReady()) {
		// Safe no-op if PostHog not initialized
		return;
	}

	const envelope = {
		ts: new Date().toISOString(),
		source: "web",
		route: window.location.pathname,
		tenantId: getTenantId(),
		actorId: getActorId(),
		...properties,
	};

	// Remove undefined fields to keep payload clean
	Object.keys(envelope).forEach((key) => {
		if (envelope[key as keyof typeof envelope] === undefined) {
			delete envelope[key as keyof typeof envelope];
		}
	});

	posthog.capture(eventName, envelope);
}

/**
 * Convenience helper for button clicks.
 * 
 * @param buttonName - Button identifier (e.g., "ignore_backorder", "submit_po")
 * @param context - Optional context (e.g., { backorderId: "bo_123" })
 */
export function trackButtonClick(buttonName: string, context?: Record<string, any>): void {
	track("button_clicked", { buttonName, ...context });
}

/**
 * Convenience helper for screen views.
 * 
 * @param screenName - Screen identifier (e.g., "BackorderDetail", "PurchaseOrderList")
 * @param context - Optional context (e.g., { backorderId: "bo_123" })
 */
export function trackScreenView(screenName: string, context?: Record<string, any>): void {
	track("screen_viewed", { screenName, ...context });
}
