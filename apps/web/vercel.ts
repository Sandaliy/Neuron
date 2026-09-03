import { apiOriginForDeployment } from './src/lib/deployment-api-origin';

import { routes, type VercelConfig } from '@vercel/config/v1';

const apiOrigin = apiOriginForDeployment(process.env.VERCEL_ENV, process.env.VERCEL_BRANCH_URL);

export const config: VercelConfig = {
  framework: 'vite',
  rewrites: [
    routes.rewrite('/api/:path*', `${apiOrigin}/api/:path*`),
    routes.rewrite('/(.*)', '/index.html'),
  ],
};
