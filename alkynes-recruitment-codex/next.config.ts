import type { NextConfig } from 'next';
import appInfo from './portable/version.json';
const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_ALKYNES_APP_VERSION: appInfo.version },
  ...(process.env.ALKYNES_STATIC_EXPORT === '1' ? { output: 'export' as const } : {}),
};
export default nextConfig;
