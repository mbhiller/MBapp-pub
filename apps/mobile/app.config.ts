// apps/mobile/app.config.ts
import 'dotenv/config';
import type { ExpoConfig, ConfigContext } from 'expo/config';

const HARDCODED_API = 'https://ki8kgivz1f.execute-api.us-east-1.amazonaws.com';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,

  // Defaults (safe if not already set in app.json)
  name: config.name ?? 'MBapp',
  slug: config.slug ?? 'mbapp',
  version: config.version ?? '1.0.0',
  orientation: config.orientation ?? 'portrait',
  platforms: config.platforms ?? ['ios', 'android', 'web'],

  // Plugins
  plugins: [
    ...(Array.isArray((config as any).plugins) ? (config as any).plugins : []),
    ['expo-camera', { cameraPermission: 'Camera access is required to scan QR codes.' }],
  ],

  ios: {
    ...(config.ios ?? {}),
    supportsTablet: config.ios?.supportsTablet ?? true,
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
    TENANTS_BASE:
      process.env.TENANTS_BASE ?? `${process.env.API_BASE ?? HARDCODED_API}/tenants`,
    TENANT: process.env.TENANT ?? 'DemoTenant',
    ENV: process.env.APP_ENV ?? 'nonprod',
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
