// apps/mobile/app.config.ts
import type { ExpoConfig } from "expo/config";
import * as dotenv from "dotenv";
dotenv.config();

const config: ExpoConfig = {
  name: "MBapp",
  slug: "mbapp",
  scheme: "mbapp",
  version: "1.0.0",
  orientation: "portrait",
  jsEngine: "hermes",
  platforms: ["ios", "android"],

  // ❌ No plugins here when using Expo Go
  // plugins: ["expo-barcode-scanner"],

  ios: {
    supportsTablet: true,
    // (Optional) You can still set a message; Expo Go ignores native plist edits
    infoPlist: {
      NSCameraUsageDescription:
        "MBapp uses the camera to scan EPC/QR codes for inventory operations.",
    },
  },

  android: {
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#FFFFFF" },
    softwareKeyboardLayoutMode: "resize",
    // ❌ No explicit CAMERA permission needed for Expo Go
  },

  extra: {
    EXPO_PUBLIC_API_BASE:
      process.env.EXPO_PUBLIC_API_BASE ??
      "https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com",
    EXPO_PUBLIC_TENANT_ID: process.env.EXPO_PUBLIC_TENANT_ID ?? "DemoTenant",
    EXPO_PUBLIC_ROLES:
      process.env.EXPO_PUBLIC_ROLES ??
      "admin,objects.view,products.view,tenants.view,events.view,inventory.view",
  },
};

export default config;
