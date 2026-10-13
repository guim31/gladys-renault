// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Everything Renault / Dacia lives in
// src/renault.js (runtime) and src/renault/ (cloud client).
//
// The Gladys supervisor injects GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN
// and GLADYS_INTEGRATION_SELECTOR; `new GladysIntegration()` reads them.
// Every handler is registered BEFORE connect().
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';
import { createStore } from './src/store.js';

const gladys = new GladysIntegration();
const store = createStore({ logger });
registerHandlers({ gladys, store, logger });

logger.info('Starting the Renault / Dacia integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
