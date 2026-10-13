// -----------------------------------------------------------------------------
// The integration wired like index.js, against the SDK's fake Gladys and the
// fake Renault cloud, with a clock the tests move by hand and no timer: the
// tests call `tick()` where the container's timer would.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { createMemoryStore } from '../../src/store.js';
import { createHttp } from '../../src/renault/http.js';
import { createRenaultClient } from '../../src/renault/client.js';
import { PASSWORD, USERNAME, createFakeRenault } from './fakeRenault.js';

export const MINUTE = 60 * 1000;
export const SELECTOR = 'renault';
// 13/10/2026 10:00 UTC.
export const T0 = Date.UTC(2026, 9, 13, 10, 0, 0);

/** A logger that records every line, by level. */
export function recordingLogger() {
  const lines = { debug: [], info: [], warn: [], error: [] };
  const format = (args) =>
    args
      .map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg)))
      .join(' ');
  const logger = {
    lines,
    debug: (...args) => lines.debug.push(format(args)),
    info: (...args) => lines.info.push(format(args)),
    warn: (...args) => lines.warn.push(format(args)),
    error: (...args) => lines.error.push(format(args)),
    child: () => logger,
    all: () => [...lines.debug, ...lines.info, ...lines.warn, ...lines.error],
  };
  return logger;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] configuration overrides
 * @param {boolean} [options.tfa] the account asks for an e-mailed code
 * @param {object} [options.store] a memory store (to restart with the same /data)
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect] connect now (default true)
 * @param {object} [options.cloud] an existing fake cloud
 * @param {string[]} [options.cars] keep only these VINs in the account
 */
export async function createWorld({
  config = {},
  tfa = false,
  store = createMemoryStore(),
  devices = [],
  connect = true,
  cloud,
  cars,
  logger = recordingLogger(),
} = {}) {
  let clock = T0;
  const now = () => clock;
  const renault = cloud ?? createFakeRenault({ now, tfa });
  if (cars) {
    renault.vehicles = {
      ...renault.vehicles,
      vehicleLinks: renault.vehicles.vehicleLinks.filter((link) => cars.includes(link.vin)),
    };
  }
  const gladys = createFakeGladys({
    selector: SELECTOR,
    devices,
    config: { username: USERNAME, password: PASSWORD, locale: 'fr_FR', ...config },
  });
  const http = createHttp({ fetchImpl: renault.fetch });
  const runtime = registerHandlers({
    gladys,
    store,
    logger,
    timeZone: 'Europe/Paris',
    runtimeOptions: {
      logger,
      now,
      timers: false,
      clientFactory: (cfg, session) =>
        createRenaultClient({
          http,
          locale: cfg.locale,
          credentials: { username: cfg.username, password: cfg.password },
          session,
          now,
        }),
    },
  });
  const world = {
    gladys,
    fake: gladys.fake,
    renault,
    runtime,
    store,
    logger,
    now,
    advance(ms) {
      clock += ms;
    },
    /** Move the clock and run the container's timer once. */
    async tick(ms = MINUTE) {
      clock += ms;
      await runtime.tick();
    },
    device: (vin) => gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(`:${vin}`)),
    feature: (vin, key) => `ext:${SELECTOR}:vehicle:${vin}:${key}`,
    /** The user adds every discovered car to Gladys. */
    async createAll() {
      for (const device of gladys.fake.discoveredDevices) await gladys.fake.deviceCreated(device);
    },
    async create(vin) {
      await gladys.fake.deviceCreated(world.device(vin));
    },
    async stop() {
      await runtime.stop();
    },
  };
  if (connect) await gladys.connect();
  return world;
}
