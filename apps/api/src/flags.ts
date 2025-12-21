import type { APIGatewayProxyEventV2 } from "aws-lambda";

const APP_ENV = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "dev").toLowerCase();
export const IS_PROD = APP_ENV === "prod" || APP_ENV === "production";

function hdr(e: APIGatewayProxyEventV2, name: string) {
  return e.headers?.[name] ?? e.headers?.[name.toLowerCase()];
}
function asBool(v: any, dflt: boolean) {
  if (v == null) return dflt;
  const s = String(v).toLowerCase();
  if (["1","true","yes","on"].includes(s)) return true;
  if (["0","false","no","off"].includes(s)) return false;
  return dflt;
}
function fromEnv(name: string, dflt: boolean) {
  return asBool(process.env[name], dflt);
}

// In PROD: ignore headers (env-only). In DEV/CI: header overrides env.
function withFlag(envName: string, headerName: string, dflt: boolean) {
  return (event: APIGatewayProxyEventV2) => {
    const base = fromEnv(envName, dflt);
    if (IS_PROD) return base;
    return asBool(hdr(event, headerName), base);
  };
}

export const featureVendorGuardEnabled = withFlag(
  "FEATURE_ENFORCE_VENDOR_ROLE", "X-Feature-Enforce-Vendor", true
);
export const featureViewsEnabled = withFlag(
  "FEATURE_VIEWS_ENABLED", "X-Feature-Views-Enabled", false
);
export const featureRegistrationsEnabled = withFlag(
  "FEATURE_REGISTRATIONS_ENABLED", "X-Feature-Registrations-Enabled", false
);
export const featureEventsEnabled = withFlag(
  "FEATURE_EVENT_DISPATCH_ENABLED", "X-Feature-Events-Enabled", false
);
export const featureEventsSimulate = withFlag(
  "FEATURE_EVENT_DISPATCH_SIMULATE", "X-Feature-Events-Simulate", false
);
