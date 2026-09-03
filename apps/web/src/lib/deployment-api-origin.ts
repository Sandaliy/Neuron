const PRODUCTION_API_ORIGIN = 'https://neuron-api-parkour-clan.vercel.app';
const LOCAL_API_ORIGIN = 'http://localhost:8787';
const WEB_BRANCH_PREFIX = 'neuron-web-git-';
const API_BRANCH_PREFIX = 'neuron-api-git-';
const VERCEL_SUFFIX = '.vercel.app';

/**
 * Selects the api that belongs to a web deployment.
 *
 * A preview must never fall back to production. Both Vercel projects deploy
 * the same Git branch, and their stable branch urls differ only by the project
 * name. An absent or unexpected branch url therefore stops the deployment
 * instead of quietly sending preview traffic to production data.
 */
export function apiOriginForDeployment(
  environment: string | undefined,
  branchUrl: string | undefined,
): string {
  if (environment === 'production') {
    return PRODUCTION_API_ORIGIN;
  }

  if (environment !== 'preview') {
    return LOCAL_API_ORIGIN;
  }

  if (
    branchUrl === undefined ||
    !branchUrl.startsWith(WEB_BRANCH_PREFIX) ||
    !branchUrl.endsWith(VERCEL_SUFFIX)
  ) {
    throw new Error('A preview deployment needs the generated neuron-web branch URL.');
  }

  return `https://${API_BRANCH_PREFIX}${branchUrl.slice(WEB_BRANCH_PREFIX.length)}`;
}
