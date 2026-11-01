import { neonConfig } from '@neondatabase/serverless';

/**
 * Lets the database tests reach a plain PostgreSQL through Neon's WebSocket
 * proxy, as CI runs them. Without the variable the driver talks to Neon as
 * usual, so nothing changes for a Neon branch.
 */
const webSocketProxy = process.env['DATABASE_URL_TEST_WS_PROXY'];

if (webSocketProxy) {
  neonConfig.wsProxy = webSocketProxy;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
}
