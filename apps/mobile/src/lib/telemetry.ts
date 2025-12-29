// apps/mobile/src/lib/telemetry.ts
/**
 * PostHog-backed telemetry helper for mobile (Expo/React Native).
 * Safe no-op if not initialized or API key missing.
 * Envelope includes: ts, source="mobile", screen (if available), tenantId, actorId (optional).
 * No PII: only IDs allowed in properties.
 */

type PostHogClient = { capture: (eventName: string, props?: Record<string, any>) => void } | null;
let client: PostHogClient = null;
let context: { tenantId?: string; actorId?: string; screen?: string } = {};

export function setPostHogClient(c: PostHogClient) { client = c; }

export function setTelemetryContext(partial: { tenantId?: string; actorId?: string; screen?: string }) {
	context = { ...context, ...partial };
}

export function setScreen(screenName?: string) {
	if (screenName) context.screen = screenName;
}

export function track(eventName: string, properties?: Record<string, any>): void {
	if (!client) return; // safe no-op
	const envelope: Record<string, any> = {
		ts: new Date().toISOString(),
		source: "mobile",
		...(context.screen ? { screen: context.screen } : {}),
		...(context.tenantId ? { tenantId: context.tenantId } : {}),
		...(context.actorId ? { actorId: context.actorId } : {}),
		...(properties || {}),
	};
	client.capture(eventName, envelope);
}

export function trackButtonClick(buttonName: string, ctx?: Record<string, any>) {
	track("button_clicked", { buttonName, ...(ctx || {}) });
}

export function trackScreenView(screenName: string, ctx?: Record<string, any>) {
	setScreen(screenName);
	track("screen_viewed", { screenName, ...(ctx || {}) });
}
