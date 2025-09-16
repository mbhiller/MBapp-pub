// apps/mobile/app.config.ts
import type { ExpoConfig } from "expo/config";
import * as dotenv from "dotenv";

// Load .env at config time (dev + EAS)
dotenv.config();

const config: ExpoConfig = {
  name: "MBapp",
  slug: "mbapp",
  scheme: "mbapp",
  version: "1.0.0",
  orientation: "portrait",
  jsEngine: "hermes",
  platforms: ["ios", "android"],
  ios: { supportsTablet: true },
  android: { adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#FFFFFF" } },
  extra: {
    // These are readable via process.env.* at runtime in your code
    EXPO_PUBLIC_API_BASE:
      process.env.EXPO_PUBLIC_API_BASE ??
      "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
    EXPO_PUBLIC_TENANT_ID:
      process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant",
    EXPO_PUBLIC_ROLES:
      process.env.EXPO_PUBLIC_ROLES ??
      "admin,objects.view,products.view,tenants.view,events.view,inventory.view",
  },
};

export default config;
