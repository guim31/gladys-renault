// -----------------------------------------------------------------------------
// Handlers of the Gladys client, in one place so the tests can wire the SDK's
// fake Gladys exactly like index.js wires the real one.
// -----------------------------------------------------------------------------

import { normalizeConfig } from './config.js';
import { createRenault } from './renault.js';
import { createWidgets } from './widgets.js';
import { createSceneActions } from './scenes.js';
import { MESSAGES } from './messages.js';

// Manifest actions → runtime method (fields are those of the manifest).
export const ACTION_KEYS = {
  TEST_CONNECTION: 'test_connection',
  SEND_CODE: 'send_verification_code',
  VERIFY_CODE: 'verify_code',
};

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {object} options.store src/store.js
 * @param {object} options.logger
 * @param {object} [options.runtimeOptions] passed to createRenault (tests: clientFactory, now, timers)
 * @param {string} [options.timeZone] of the widget dates
 * @returns {object} the runtime
 */
export function registerHandlers({ gladys, store, logger, runtimeOptions = {}, timeZone }) {
  const runtime = createRenault({ gladys, store, ...runtimeOptions });
  let started = false;

  gladys.onScanRequest(() => runtime.scan());

  // Gladys acks a device command within 5 s: past 4 s (a sign-in first), the
  // command is acknowledged and goes on in the background.
  gladys.onSetValue((device, feature, value) =>
    runtime.setValue(device, feature, value, { deadlineMs: 4000 }),
  );

  // No device is published with `should_poll`: the runtime reads the cloud on
  // its own timer (Gladys 5.2 does not poll reliably, GladysAssistant/Gladys#3198).
  // Kept as a fallback: publishes what changed, never calls the cloud.
  gladys.onPoll((device) => runtime.poll(device));

  // Gladys drops the states of a feature that does not exist yet: send them
  // again now that it does, and let the widget bind to it.
  gladys.onDeviceCreated((device) => runtime.deviceCreated(device));
  gladys.onDeviceUpdated((device) => runtime.deviceCreated(device));

  gladys.onAction(ACTION_KEYS.TEST_CONNECTION, () => runtime.testConnection());
  gladys.onAction(ACTION_KEYS.SEND_CODE, () => runtime.sendVerificationCode());
  gladys.onAction(ACTION_KEYS.VERIFY_CODE, (fields) => runtime.verifyCode(fields?.code));

  for (const [key, handler] of Object.entries(createSceneActions(runtime))) {
    gladys.onSceneAction(key, (fields) => handler({ fields }));
  }

  for (const [key, widget] of Object.entries(createWidgets(runtime, { timeZone }))) {
    gladys.onWidgetGet(key, (request) => widget.get(request));
    gladys.onWidgetAction(key, (actionKey, params, { settings }) =>
      widget.action({ actionKey, params, settings }),
    );
  }

  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    await runtime.reconfigure(normalizeConfig(newConfig));
  });

  gladys.on('connected', async () => {
    try {
      if (!started) {
        started = true;
        await store.load();
        await runtime.start(normalizeConfig(await gladys.getConfig()));
      } else {
        // Reconnected to Gladys: what was published while disconnected was lost.
        await runtime.resync();
      }
    } catch (err) {
      logger.error('Initialization failed', err);
      await runtime.reportStatus(false, MESSAGES.initFailed);
    }
  });

  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal}, stopping`);
    await runtime.stop();
  });

  return runtime;
}
