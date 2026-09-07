import { neonConfig } from '@neondatabase/serverless';

const webSocketProxy = process.env['DATABASE_URL_TEST_WS_PROXY'];

if (webSocketProxy) {
  neonConfig.wsProxy = webSocketProxy;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
}
