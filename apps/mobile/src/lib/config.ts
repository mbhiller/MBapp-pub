import Constants from "expo-constants";

type Extra = {
  API_BASE?: string;
  TENANTS_BASE?: string;
  ENV?: string;
};

export function getExtra(): Extra {
  const fromExpoConfig = (Constants?.expoConfig as any)?.extra as Extra | undefined;
  const fromManifest = (Constants as any)?.manifest?.extra as Extra | undefined;
  return fromExpoConfig ?? fromManifest ?? {};
}

export function requireApiBase(): string {
  const { API_BASE } = getExtra();
  if (!API_BASE) {
    throw new Error("Missing API_BASE in Expo extra. Set it in app.config.ts");
  }
  return API_BASE;
}

export function getTenantsBase(): string {
  const { TENANTS_BASE } = getExtra();
  return TENANTS_BASE ?? `${requireApiBase()}/tenants`;
}
