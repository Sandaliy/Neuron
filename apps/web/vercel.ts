import { apiOriginForDeployment } from './src/lib/deployment-api-origin';

import type { VercelConfig } from '@vercel/config/v1';

const apiOrigin = apiOriginForDeployment(process.env.VERCEL_ENV, process.env.VERCEL_BRANCH_URL);

export const config: VercelConfig = {
  framework: 'vite',
  rewrites: [
    {
      source: '/api/:path*',
      destination: `${apiOrigin}/api/:path*`,
    },
    { source: '/(.*)', destination: '/index.html' },
  ],
};
