// mobile/app.config.ts
import 'dotenv/config';
import type { ExpoConfig } from 'expo/config';

export default ({ config }: { config: ExpoConfig }): ExpoConfig => ({
  ...config,
  extra: {
    ...(config.extra ?? {}),
    API_BASE: process.env.API_BASE ?? 'https://u0cuyphbv6.execute-api.us-east-1.amazonaws.com',
    TENANTS_BASE: process.env.TENANTS_BASE ?? `${process.env.API_BASE ?? 'https://u0cuyphbv6.execute-api.us-east-1.amazonaws.com'}/tenants`,
    TENANT: process.env.TENANT ?? 'DemoTenant',
    ENV: process.env.APP_ENV ?? 'nonprod',
  },
});
