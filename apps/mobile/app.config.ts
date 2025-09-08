import 'dotenv/config';
import type { ExpoConfig } from 'expo/config';

const HARDCODED_API = 'https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com';

export default ({ config }: { config: ExpoConfig }): ExpoConfig => ({
  ...config,

  // No barcode-scanner plugin needed; we use expo-camera.
  plugins: [
    ...(Array.isArray((config as any).plugins) ? (config as any).plugins : []),
     ...(Array.isArray((config as any).plugins) ? (config as any).plugins : []),
  ["expo-camera", { cameraPermission: "Camera access is required to scan QR codes." }],
  ],

  ios: {
    ...(config.ios ?? {}),
    infoPlist: {
      ...(config.ios?.infoPlist ?? {}),
      NSCameraUsageDescription: 'Camera access is required to scan QR codes.',
    },
  },

  android: {
    ...(config.android ?? {}),
    permissions: Array.from(new Set([...(config.android?.permissions ?? []), 'CAMERA'])),
  },
  
  extra: {
    ...(config.extra ?? {}),
    API_BASE: process.env.API_BASE ?? HARDCODED_API,
    TENANTS_BASE: process.env.TENANTS_BASE ?? `${process.env.API_BASE ?? HARDCODED_API}/tenants`,
    TENANT: process.env.TENANT ?? 'DemoTenant',
    ENV: process.env.APP_ENV ?? 'nonprod',
  },
});
