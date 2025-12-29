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

/**
 * Sanitize telemetry properties to prevent PII leakage.
 * 
 * Rules:
 * - Drop PII-ish keys: name, email, phone, address, firstName, lastName (case-insensitive)
 * - Drop nested objects/arrays (keep primitives only)
 * - Keep primitives: string, number, boolean, null, undefined
 * - Keep keys ending in "Id" (e.g., soId, objectId, tenantId)
 */
function sanitizeTelemetryProps(props?: Record<string, any>): Record<string, any> {
	if (!props) return {};

	const PII_KEYS = /^(name|email|phone|address|firstname|lastname|displayname)$/i;
	const sanitized: Record<string, any> = {};

	for (const [key, value] of Object.entries(props)) {
		// Drop PII keys
		if (PII_KEYS.test(key)) continue;

		// Keep primitives only (drop objects/arrays)
		const type = typeof value;
		if (value === null || value === undefined) {
			sanitized[key] = value;
		} else if (type === "string" || type === "number" || type === "boolean") {
			sanitized[key] = value;
		}
		// Drop objects, arrays, functions, etc.
	}

	return sanitized;
}

export function track(eventName: string, properties?: Record<string, any>): void {
	if (!client) return; // safe no-op

	// Sanitize user-provided properties
	const sanitized = sanitizeTelemetryProps(properties);

	const envelope: Record<string, any> = {
		ts: new Date().toISOString(),
		source: "mobile",
		...(context.screen ? { screen: context.screen } : {}),
		...(context.tenantId ? { tenantId: context.tenantId } : {}),
		...(context.actorId ? { actorId: context.actorId } : {}),
		...sanitized,
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
