// -----------------------------------------------------------------------------
// The integration's runtime: the cars of the MY Renault / MY Dacia account,
// read from the cloud on the container's own timer and published to Gladys
// (only what changed, plus a heartbeat).
//
// Reads return the state each car last sent to the cloud: they never wake
// the car. A car sends its state when it is switched off, while it charges
// and after a command. The pace stays under the quota Home Assistant
// respects (60 calls an hour per account, see readPeriodMs).
//
// Commands (charge, preconditioning, charge mode) are accepted or refused by
// the cloud at once; the car carries them out later, and only the next reads
// tell whether it did. Until then the requested value is held on the
// commanded feature (ten minutes at most), and the widget says it is waiting.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured, readPeriodMs } from './config.js';
import { ERROR_KINDS } from './renault/errors.js';
import { createHttp } from './renault/http.js';
import { createRenaultClient } from './renault/client.js';
import { endpointFor } from './renault/endpoints.js';
import { ActionFailure, MESSAGES, UserError, failureText, userTextOf } from './messages.js';
import {
  DEFAULT_PRECONDITIONING_C,
  OPTIONAL_FIELDS,
  VEHICLE_FEATURES,
  buildVehicleDevice,
  logLabel,
  preconditioningTemperature,
  snapshotOf,
  vehicleCommand,
  vehicleIds,
  vehicleInfo,
  vehicleName,
  vehicleStates,
} from './devices/vehicle.js';

const MINUTE = 60 * 1000;
const TICK_MS = MINUTE;
const VEHICLE_LIST_REFRESH_MS = 6 * 60 * MINUTE;
const RETRY_MS = 15 * MINUTE;
const RATE_LIMIT_BACKOFF_MS = 15 * MINUTE;
// How long a commanded value is held, waiting for the car to report it.
const PENDING_MS = 10 * MINUTE;
// Reads of the commanded endpoint after a command.
const FOLLOW_UP_DELAYS_MS = [2 * MINUTE, 6 * MINUTE];
// A refresh asked by a scene or the widget within a minute of a read reuses it.
const MANUAL_REFRESH_MIN_GAP_MS = MINUTE;
// A value that does not change is sent again twice a day, so Gladys does not
// show it as stale ("no recent value" past 48 h).
const HEARTBEAT_MS = 12 * 60 * MINUTE;
// The end of a charge stopped from Gladys is no "charge finished" event.
const OWN_STOP_MS = 30 * MINUTE;
const WIDGET_NUDGE_MIN_INTERVAL_MS = 10 * 1000;

export const WIDGET_KEYS = { VEHICLE: 'vehicle' };
export const SCENE_TRIGGER_KEYS = { CHARGE_FINISHED: 'charge_finished' };

// Errors the user must act on: no sign-in attempt until the configuration
// changes (or the two-step verification is done). Insisting could lock the account.
const BLOCKING_KINDS = new Set([ERROR_KINDS.AUTH, ERROR_KINDS.TFA_REQUIRED, ERROR_KINDS.BLOCKED]);
// A refusal of the endpoint itself: the car does not offer it.
const REFUSALS = new Set([
  ERROR_KINDS.NOT_SUPPORTED,
  ERROR_KINDS.ACCESS_DENIED,
  ERROR_KINDS.NOT_FOUND,
]);

/**
 * The data endpoints read for a car, in order. `charging-settings` only gives
 * the charge mode of the cars without `charge-mode`.
 */
const READS = [
  { endpoint: 'battery-status', when: ({ info }) => info.electric },
  { endpoint: 'cockpit' },
  { endpoint: 'hvac-status' },
  {
    endpoint: 'charge-mode',
    when: ({ info, chargeModeSettable }) => info.electric && chargeModeSettable,
  },
  {
    endpoint: 'charging-settings',
    when: ({ info, chargeModeSettable, active }) =>
      info.electric && chargeModeSettable && !active.has('charge-mode'),
  },
  { endpoint: 'lock-status' },
  { endpoint: 'location', when: ({ gps }) => gps },
];

// The endpoint that reports the effect of each order.
const ORDER_ENDPOINTS = {
  chargeStart: ['battery-status'],
  chargeStop: ['battery-status'],
  hvacStart: ['hvac-status'],
  hvacStop: ['hvac-status'],
  setChargeMode: ['charge-mode', 'charging-settings'],
};
// The timestamp telling whether a read is newer than a command.
const EXPECT_TIMESTAMPS = { charging: 'batteryUpdatedAt', hvacOn: 'hvacUpdatedAt' };

/** The real cloud client of a configuration. */
export function defaultClientFactory(config, session) {
  return createRenaultClient({
    http: createHttp(),
    locale: config.locale,
    credentials: { username: config.username, password: config.password },
    session,
  });
}

export function createRenault({
  gladys,
  store,
  logger = createLogger({ name: 'renault' }),
  clientFactory = defaultClientFactory,
  now = Date.now,
  timers = true,
}) {
  let config = null;
  let client = null;
  let ticker = null;
  let blocked = null; // error kind that stops the sign-ins until the config changes
  let lastListAt = 0;
  let lastListAttemptAt = 0;
  let backoffUntil = 0;
  let publishedDevicesJson = null;
  let stopped = false;
  let accountMissing = false;
  const vehicles = new Map(); // vin → vehicle (see addVehicle)
  const nudges = new Map(); // widget key → { at, timer }
  // Failures already logged: a failure that repeats every read is logged once
  // at warn level, then at debug level until it recovers.
  const failing = new Set();
  let statusSent = null; // last connection status Gladys accepted (serialized)
  let statusWanted = null; // last connection status asked for: [connected, message]

  // --- Helpers ---------------------------------------------------------------

  const createdDevice = (externalId) =>
    (gladys.devices ?? []).find((device) => device.external_id === externalId);

  function findVehicle(deviceExternalId) {
    for (const vehicle of vehicles.values()) {
      if (vehicleIds(gladys, vehicle.info.vin).device === deviceExternalId) return vehicle;
    }
    return null;
  }

  function requireVehicle(deviceExternalId) {
    const vehicle = findVehicle(deviceExternalId);
    if (!vehicle) throw new UserError(MESSAGES.unknownVehicle);
    return vehicle;
  }

  function requireClient() {
    if (!client || blocked)
      throw new UserError(MESSAGES[blocked] ?? MESSAGES.notConfigured, blocked);
  }

  const supports = (vehicle, key) => endpointFor(vehicle.info.modelCode, key) !== null;

  /** The data endpoints to read for a car, now. */
  function activeReads(vehicle) {
    const context = {
      info: vehicle.info,
      gps: Boolean(config?.gps),
      chargeModeSettable: supports(vehicle, 'actions/charge-set-mode'),
      active: new Set(),
    };
    const reads = [];
    for (const read of READS) {
      if (read.when && !read.when(context)) continue;
      if (!supports(vehicle, read.endpoint) || vehicle.disabled.has(read.endpoint)) continue;
      reads.push(read.endpoint);
      context.active.add(read.endpoint);
    }
    return reads;
  }

  /** What a car offers: decides its features (src/devices/vehicle.js). */
  function capabilities(vehicle) {
    const active = new Set(activeReads(vehicle));
    const battery = vehicle.info.electric && active.has('battery-status');
    const hvac = active.has('hvac-status');
    return {
      battery,
      chargeStart: battery && supports(vehicle, 'actions/charge-start'),
      chargeStop: battery && supports(vehicle, 'actions/charge-stop'),
      chargeMode:
        battery &&
        supports(vehicle, 'actions/charge-set-mode') &&
        (active.has('charge-mode') || active.has('charging-settings')),
      hvac,
      hvacStart: hvac && supports(vehicle, 'actions/hvac-start'),
      hvacStop: hvac && supports(vehicle, 'actions/hvac-stop'),
      cockpit: active.has('cockpit'),
      lock: active.has('lock-status'),
      location: active.has('location'),
      seen: new Set(store.vehicle(vehicle.info.vin).seen ?? []),
    };
  }

  const vehicleDevice = (vehicle) =>
    buildVehicleDevice(gladys, vehicle.info, capabilities(vehicle), { language: config.language });

  // Every read reports the status: send it only when it changes. Reset when
  // Gladys reconnects (resync) or the runtime starts again.
  async function setStatus(connected, message) {
    statusWanted = [connected, message];
    const key = JSON.stringify([connected, message ?? null]);
    if (key === statusSent) return;
    try {
      await gladys.setConnectionStatus(connected, message);
      statusSent = key;
      logRecovery('status', 'Connection status reported again');
    } catch (err) {
      logFailure('status', `Could not report the connection status: ${err.message}`);
    }
  }

  /** Log a failure once (warn), then at debug level while it repeats. */
  function logFailure(key, line) {
    if (failing.has(key)) {
      logger.debug(line);
      return;
    }
    failing.add(key);
    logger.warn(`${line} (logged once until it recovers)`);
  }

  /** One info line when a logged failure is over. */
  function logRecovery(key, line) {
    if (failing.delete(key)) logger.info(line);
  }

  function nudgeWidget(key) {
    const entry = nudges.get(key) ?? { at: 0, timer: null };
    nudges.set(key, entry);
    if (entry.timer) return;
    const delay = entry.at + WIDGET_NUDGE_MIN_INTERVAL_MS - now();
    const fire = () => {
      entry.timer = null;
      entry.at = now();
      try {
        gladys.requestWidgetRefresh(key);
      } catch (err) {
        logger.debug(`Widget nudge skipped: ${err.message}`);
      }
    };
    if (delay <= 0 || !timers) fire();
    else {
      // Trailing nudge: the last change inside the core's 10 s window still lands.
      entry.timer = setTimeout(fire, delay);
      entry.timer.unref?.();
    }
  }

  // --- Publishing ------------------------------------------------------------

  async function publishDevices({ force = false } = {}) {
    const devices = config
      ? [...vehicles.values()]
          .filter((vehicle) => vehicle.readOnce)
          .map(vehicleDevice)
          .filter((device) => device.features.length > 0)
      : [];
    const json = JSON.stringify(devices);
    if (!force && json === publishedDevicesJson) return;
    await gladys.publishDiscoveredDevices(devices);
    publishedDevicesJson = json;
  }

  /** The states to publish: the real ones, a commanded value held while pending. */
  function statesOf(vehicle) {
    const held = [...vehicle.pending].map(([key, pending]) => ({ key, ...pending.state }));
    return [
      ...vehicleStates(vehicle.snapshot).filter((state) => !vehicle.pending.has(state.key)),
      ...held.filter((state) => state.value !== undefined || state.text !== undefined),
    ];
  }

  /**
   * Publish the states that changed (the SDK remembers what Gladys accepted).
   * A device the user has not created yet gets nothing: Gladys would drop it,
   * and onDeviceCreated sends everything once it exists.
   */
  async function publishVehicle(vehicle, { force = false } = {}) {
    const built = vehicleDevice(vehicle);
    const created = createdDevice(built.external_id);
    if (Array.isArray(gladys.devices) && !created) return;
    if (force) gladys.forgetPublishedStates(built.external_id);
    const present = new Set((created ?? built).features.map((f) => f.external_id));
    const states = statesOf(vehicle)
      .map(({ key, value, text }) => ({
        device_feature_external_id: `${built.external_id}:${key}`,
        ...(text !== undefined ? { text } : { state: value }),
      }))
      .filter((state) => present.has(state.device_feature_external_id));
    try {
      await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      logRecovery('publish', 'Publishing states to Gladys works again');
    } catch (err) {
      // Not remembered by the SDK: the next read sends it again.
      logFailure('publish', `Publishing states failed: ${err.message}`);
    }
  }

  async function publishAll(options) {
    for (const vehicle of vehicles.values()) await publishVehicle(vehicle, options);
  }

  // What the widget shows outside of its device-bound tiles.
  const widgetSignature = (vehicle) =>
    JSON.stringify([
      vehicle.snapshot,
      [...vehicle.pending.keys()],
      vehicle.lastCommand?.outcome ?? null,
      blocked,
    ]);

  // --- Snapshots -------------------------------------------------------------

  /** Settle the pending commands against what the car reports now. */
  function settlePending(vehicle) {
    const t = now();
    for (const [key, pending] of vehicle.pending) {
      const snapshot = vehicle.snapshot;
      const done = Object.entries(pending.expect).every(
        ([field, value]) => snapshot[field] === value,
      );
      const newer = Object.keys(pending.expect).some(
        (field) => snapshot[EXPECT_TIMESTAMPS[field]] > pending.at,
      );
      if (done) {
        vehicle.pending.delete(key);
        if (vehicle.lastCommand?.key === key) vehicle.lastCommand.outcome = 'confirmed';
        logger.debug(`${logLabel(vehicle.info)}: ${pending.order} confirmed by the car`);
      } else if (newer || t >= pending.until) {
        vehicle.pending.delete(key);
        if (vehicle.lastCommand?.key === key) vehicle.lastCommand.outcome = 'unconfirmed';
        logger.info(`${logLabel(vehicle.info)}: ${pending.order} not reported by the car`);
      }
    }
  }

  /** Fire "charge finished": the car stopped charging, still plugged in. */
  async function detectChargeFinished(vehicle, previous) {
    const next = vehicle.snapshot;
    if (previous.charging !== true || next.charging !== false || next.plugged !== true) return;
    if (vehicle.ownStopAt && now() - vehicle.ownStopAt < OWN_STOP_MS) return;
    const data = { device: vehicleIds(gladys, vehicle.info.vin).device };
    if (Number.isFinite(next.batteryLevel)) data.battery_level = Math.round(next.batteryLevel);
    if (Number.isFinite(next.rangeKm)) data.range_km = Math.round(next.rangeKm);
    try {
      await gladys.publishSceneEvent(SCENE_TRIGGER_KEYS.CHARGE_FINISHED, data);
      logger.debug(`${logLabel(vehicle.info)}: charge finished`);
    } catch (err) {
      logger.warn(`Scene event ${SCENE_TRIGGER_KEYS.CHARGE_FINISHED} refused: ${err.message}`);
    }
  }

  async function applySnapshot(vehicle, changes) {
    const before = widgetSignature(vehicle);
    const previous = vehicle.snapshot;
    vehicle.snapshot = { ...previous, ...changes };
    settlePending(vehicle);
    await detectChargeFinished(vehicle, previous);
    await publishVehicle(vehicle);
    if (widgetSignature(vehicle) !== before) nudgeWidget(WIDGET_KEYS.VEHICLE);
  }

  // --- Reads -----------------------------------------------------------------

  /**
   * Handle a read or command error.
   * `failureKey` marks a periodic call: its repeated failures are logged once.
   */
  async function handleError(err, context, failureKey = null) {
    if (BLOCKING_KINDS.has(err.kind)) {
      if (blocked !== err.kind) {
        const next =
          err.kind === ERROR_KINDS.TFA_REQUIRED
            ? 'waiting for the e-mailed code (actions of the configuration page)'
            : 'no new attempt until the configuration is saved again';
        logger.warn(`${context}: ${err.message}; ${next}`);
      }
      blocked = err.kind;
      await setStatus(false, MESSAGES[err.kind]);
      nudgeWidget(WIDGET_KEYS.VEHICLE);
      return;
    }
    if (err.kind === ERROR_KINDS.RATE_LIMIT) {
      backoffUntil = now() + RATE_LIMIT_BACKOFF_MS;
      logFailure('rate-limit', `${context}: request quota spent, reads pause for 15 minutes`);
      return;
    }
    const line = `${context}: ${err.message}`;
    if (failureKey) logFailure(failureKey, line);
    else logger.warn(line);
    if (err.kind === ERROR_KINDS.NETWORK || err.kind === ERROR_KINDS.SERVER) {
      await setStatus(false, MESSAGES.unreachable);
    }
  }

  /** A periodic call worked: end of its logged failure, if any. */
  function cloudAnswered(failureKey, label) {
    logRecovery('rate-limit', 'The request quota is available again');
    logRecovery(failureKey, `${label}: works again`);
  }

  /**
   * Read a car's endpoints (all, or `only` these). An endpoint the car refuses
   * the first time is dropped for good (until a restart), as Home Assistant
   * does; a refusal after it worked is a passing error.
   * @throws the first error that is not about one endpoint (network, quota, sign-in)
   */
  async function readVehicle(vehicle, { only = null } = {}) {
    const endpoints = activeReads(vehicle).filter((e) => !only || only.includes(e));
    const memory = store.vehicle(vehicle.info.vin);
    const seenBefore = JSON.stringify(memory.seen ?? []);
    const changes = {};
    let answered = 0;
    let dropped = false;
    let firstError = null;
    // A follow-up read of one endpoint does not delay the next full read.
    if (!only) vehicle.lastReadAt = now();
    for (const endpoint of endpoints) {
      let attributes;
      try {
        attributes = await client.read(vehicle.ref, endpoint);
      } catch (err) {
        if (
          err.kind === ERROR_KINDS.NOT_SUPPORTED ||
          (REFUSALS.has(err.kind) && !vehicle.worked.has(endpoint))
        ) {
          vehicle.disabled.add(endpoint);
          dropped = true;
          logger.debug(`${logLabel(vehicle.info)}: ${endpoint} not offered (${err.message})`);
          continue;
        }
        if (
          BLOCKING_KINDS.has(err.kind) ||
          err.kind === ERROR_KINDS.RATE_LIMIT ||
          err.kind === ERROR_KINDS.NETWORK
        ) {
          throw err;
        }
        // Privacy mode, an upstream hiccup on one endpoint: the others may answer.
        logger.debug(`${logLabel(vehicle.info)}: ${endpoint} failed (${err.message})`);
        firstError ??= err;
        continue;
      }
      answered += 1;
      vehicle.worked.add(endpoint);
      Object.assign(changes, snapshotOf(endpoint, attributes, vehicle.info));
    }
    if (answered === 0 && firstError) throw firstError;
    const seen = new Set(memory.seen ?? []);
    for (const field of OPTIONAL_FIELDS) if (changes[field] !== undefined) seen.add(field);
    memory.seen = [...seen].sort();
    if (JSON.stringify(memory.seen) !== seenBefore) store.touch();
    const first = !vehicle.readOnce;
    vehicle.readOnce = true;
    if (first || dropped || JSON.stringify(memory.seen) !== seenBefore) {
      await publishDevices().catch((err) =>
        logger.warn(`Publishing the devices failed: ${err.message}`),
      );
    }
    await applySnapshot(vehicle, changes);
    if (answered > 0) await setStatus(true);
  }

  async function safeRead(vehicle, options) {
    const label = `Reading ${logLabel(vehicle.info)}`;
    const failureKey = `read:${vehicle.info.vin}`;
    try {
      await readVehicle(vehicle, options);
    } catch (err) {
      // An outage is one failure, whatever the number of cars: one line.
      const outage = err.kind === ERROR_KINDS.NETWORK || err.kind === ERROR_KINDS.SERVER;
      await handleError(err, outage ? 'Reading the cars' : label, outage ? 'cloud' : failureKey);
      return;
    }
    logRecovery('cloud', 'The Renault cloud answers again');
    cloudAnswered(failureKey, label);
  }

  function addVehicle(info) {
    const memory = store.vehicle(info.vin);
    const vehicle = {
      info,
      ref: { accountId: info.accountId, vin: info.vin, modelCode: info.modelCode },
      snapshot: { targetTempC: memory.targetTempC ?? DEFAULT_PRECONDITIONING_C },
      disabled: new Set(),
      worked: new Set(),
      readOnce: false,
      lastReadAt: 0,
      followUps: [], // [{ at, endpoints }]
      pending: new Map(), // feature key → { order, state, expect, at, until }
      lastCommand: null, // { key, order, at, outcome: 'sent' | 'confirmed' | 'unconfirmed' }
      ownStopAt: 0,
    };
    vehicles.set(info.vin, vehicle);
    return vehicle;
  }

  /** The account's cars; new ones appear in the Discovery screen. */
  async function discover() {
    lastListAttemptAt = now();
    const found = [];
    try {
      const accounts = await client.accounts();
      const wanted = config.account_id
        ? accounts.filter((account) => account.accountId === config.account_id)
        : accounts;
      for (const account of wanted) {
        let links;
        try {
          links = await client.vehicles(account.accountId);
        } catch (err) {
          // Some accounts of a person (e.g. "SFDC") hold no car and refuse the call.
          if (BLOCKING_KINDS.has(err.kind) || err.kind === ERROR_KINDS.RATE_LIMIT) throw err;
          if (err.kind === ERROR_KINDS.NETWORK) throw err;
          logger.debug(`Vehicles of an account (${account.accountType}): ${err.message}`);
          continue;
        }
        for (const link of links) found.push(vehicleInfo(link, account.accountId));
      }
      lastListAt = now();
    } catch (err) {
      await handleError(err, 'Listing the vehicles', 'list');
      return false;
    }
    cloudAnswered('list', 'Listing the vehicles');
    accountMissing = Boolean(config.account_id) && found.length === 0;
    const seen = new Set();
    for (const info of found) {
      if (seen.has(info.vin)) continue;
      seen.add(info.vin);
      const existing = vehicles.get(info.vin);
      if (existing) {
        existing.info = info;
        existing.ref = { accountId: info.accountId, vin: info.vin, modelCode: info.modelCode };
        continue;
      }
      const vehicle = addVehicle(info);
      logger.info(
        `Vehicle found: ${logLabel(info)} (${info.modelCode ?? 'unknown model'}), reads ${
          activeReads(vehicle).join(', ') || 'nothing'
        }`,
      );
      await safeRead(vehicle);
      if (blocked) return false;
    }
    for (const vin of vehicles.keys()) if (!seen.has(vin)) vehicles.delete(vin);
    await publishDevices();
    if (accountMissing) await setStatus(false, MESSAGES.accountNotFound);
    else if (!failing.has('list')) await setStatus(true);
    return true;
  }

  async function connect() {
    try {
      await client.connect();
    } catch (err) {
      await handleError(err, 'Signing in', 'sign-in');
      return false;
    }
    cloudAnswered('sign-in', 'Signing in');
    return discover();
  }

  /** Calls of one read of every car: what the hourly budget is shared by. */
  const callsPerCycle = () =>
    [...vehicles.values()].reduce((sum, vehicle) => sum + activeReads(vehicle).length, 0);

  async function expirePending(vehicle) {
    if (![...vehicle.pending.values()].some((pending) => now() >= pending.until)) return;
    const before = widgetSignature(vehicle);
    settlePending(vehicle);
    await publishVehicle(vehicle);
    if (widgetSignature(vehicle) !== before) nudgeWidget(WIDGET_KEYS.VEHICLE);
  }

  async function tick() {
    if (!client || blocked || stopped) return;
    const t = now();
    if (t < backoffUntil) return;
    const listDue = vehicles.size === 0 || t - lastListAt >= VEHICLE_LIST_REFRESH_MS;
    // An account without a car (or an outage) is listed again every RETRY_MS.
    if (listDue && t - lastListAttemptAt >= RETRY_MS) {
      await discover();
      if (blocked) return;
    }
    const period = readPeriodMs(config, callsPerCycle());
    for (const vehicle of vehicles.values()) {
      if (blocked || stopped || now() < backoffUntil) return;
      await expirePending(vehicle);
      const due = vehicle.followUps.filter((followUp) => followUp.at <= t);
      if (t - vehicle.lastReadAt >= period) {
        vehicle.followUps = vehicle.followUps.filter((followUp) => followUp.at > t);
        await safeRead(vehicle);
      } else if (due.length > 0) {
        vehicle.followUps = vehicle.followUps.filter((followUp) => followUp.at > t);
        await safeRead(vehicle, { only: [...new Set(due.flatMap((f) => f.endpoints))] });
      }
    }
  }

  function startTicker() {
    stopTicker();
    if (!timers) return;
    ticker = setInterval(() => tick().catch((err) => logger.error('Refresh failed', err)), TICK_MS);
    ticker.unref?.();
  }

  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  // --- Commands --------------------------------------------------------------

  /**
   * Send a command. Resolves once the cloud accepted it: the car carries it
   * out later (the next reads tell).
   * @returns {Promise<'sent' | 'local'>}
   */
  async function send(vehicle, featureKey, value, { args } = {}) {
    requireClient();
    const order = vehicleCommand(featureKey, value, vehicle.snapshot);
    if (!order) throw new Error(`${featureKey} is read-only`);
    if (order.local) {
      store.vehicle(vehicle.info.vin).targetTempC = order.expect.targetTempC;
      store.touch();
      await applySnapshot(vehicle, order.expect);
      return 'local';
    }
    const caps = capabilities(vehicle);
    const offered = {
      chargeStart: caps.chargeStart,
      chargeStop: caps.chargeStop,
      hvacStart: caps.hvacStart,
      hvacStop: caps.hvacStop,
      setChargeMode: caps.chargeMode,
    }[order.order];
    const label = `${order.order} → ${logLabel(vehicle.info)}`;
    if (!offered) {
      // Gladys shows the value the user asked for: put the known one back.
      await publishVehicle(vehicle, { force: true });
      throw new UserError(
        order.order === 'chargeStop'
          ? MESSAGES.chargeStopUnsupported
          : MESSAGES[ERROR_KINDS.NOT_SUPPORTED],
        ERROR_KINDS.NOT_SUPPORTED,
      );
    }
    const orderArgs = args ?? order.args;
    logger.info(`Command ${label}${orderArgs !== undefined ? ` (${orderArgs})` : ''}`);
    try {
      await client[order.order](vehicle.ref, orderArgs);
    } catch (err) {
      await handleError(err, `Command ${label}`);
      await publishVehicle(vehicle, { force: true });
      throw userTextOf(err) ? new UserError(userTextOf(err), err.kind) : err;
    }
    const t = now();
    const [held] = vehicleStates({ ...vehicle.snapshot, ...order.expect }).filter(
      (state) => state.key === featureKey,
    );
    vehicle.pending.set(featureKey, {
      order: order.order,
      state: held ? (held.text !== undefined ? { text: held.text } : { value: held.value }) : {},
      expect: order.expect,
      at: t,
      until: t + PENDING_MS,
    });
    vehicle.lastCommand = { key: featureKey, order: order.order, at: t, outcome: 'sent' };
    if (order.order === 'chargeStop') vehicle.ownStopAt = t;
    vehicle.followUps.push(
      ...FOLLOW_UP_DELAYS_MS.map((delay) => ({
        at: t + delay,
        endpoints: ORDER_ENDPOINTS[order.order],
      })),
    );
    await publishVehicle(vehicle);
    nudgeWidget(WIDGET_KEYS.VEHICLE);
    return 'sent';
  }

  // --- Public API ------------------------------------------------------------

  async function stop() {
    stopped = true;
    stopTicker();
    for (const entry of nudges.values()) clearTimeout(entry.timer);
    nudges.clear();
    client = null;
    await store.flush();
  }

  async function start(newConfig) {
    config = newConfig;
    stopped = false;
    blocked = null;
    accountMissing = false;
    failing.clear();
    statusSent = null;
    backoffUntil = 0;
    lastListAt = 0;
    lastListAttemptAt = 0;
    if (!isConfigured(config)) {
      client = null;
      await publishDevices({ force: true });
      await setStatus(false, MESSAGES.notConfigured);
      return;
    }
    const fingerprint = store.fingerprint(config);
    client = clientFactory(config, store.sessionStore(fingerprint));
    const ok = await connect();
    startTicker();
    if (ok) logger.info(`Renault / Dacia: ${vehicles.size} vehicle(s)`);
  }

  async function restart(newConfig) {
    await stop();
    vehicles.clear();
    publishedDevicesJson = null;
    gladys.forgetPublishedStates();
    await start(newConfig);
    nudgeWidget(WIDGET_KEYS.VEHICLE);
  }

  const credentialsOf = (c) => JSON.stringify([c?.locale, c?.username, c?.password, c?.account_id]);

  return {
    start,
    stop,
    tick,

    /** New configuration: sign in again when the account changed, else rebuild. */
    async reconfigure(newConfig) {
      if (!config || credentialsOf(newConfig) !== credentialsOf(config) || blocked || !client) {
        await restart(newConfig);
        return;
      }
      const gpsOff = config.gps && !newConfig.gps;
      config = newConfig;
      for (const vehicle of vehicles.values()) {
        if (gpsOff) {
          // The position is not kept once the user turned it off.
          delete vehicle.snapshot.latitude;
          delete vehicle.snapshot.longitude;
        }
      }
      await publishDevices();
      await publishAll();
      if (newConfig.gps)
        for (const vehicle of vehicles.values()) await safeRead(vehicle, { only: ['location'] });
      nudgeWidget(WIDGET_KEYS.VEHICLE);
    },

    /** A status set from outside the runtime (index.js, failed start). */
    reportStatus(connected, message) {
      return setStatus(connected, message);
    },

    /** (Re)connected to Gladys: devices and every state again. */
    async resync() {
      statusSent = null;
      if (statusWanted) await setStatus(...statusWanted);
      await publishDevices({ force: true });
      await publishAll({ force: true });
      nudgeWidget(WIDGET_KEYS.VEHICLE);
    },

    async scan() {
      if (client && !blocked) await discover();
      else await publishDevices({ force: true });
    },

    /** Gladys created (or updated) a device: its states were dropped until now. */
    async deviceCreated(device) {
      const vehicle = findVehicle(device.external_id);
      if (vehicle) await publishVehicle(vehicle, { force: true });
      nudgeWidget(WIDGET_KEYS.VEHICLE);
    },

    /**
     * The core's poll: a fallback only, no device asks for it (the timer reads
     * the cloud). Never calls the cloud; publishes what changed.
     */
    async poll(device) {
      const vehicle = findVehicle(device.external_id);
      if (vehicle) await publishVehicle(vehicle);
    },

    /**
     * A user command from Gladys (dashboard, scene). Gladys acks a device
     * command within 5 s: past `deadlineMs` (a sign-in first), the command is
     * acknowledged and goes on in the background.
     */
    async setValue(device, feature, value, { deadlineMs } = {}) {
      const vehicle = findVehicle(device.external_id);
      if (!vehicle) throw new Error(`Unknown device ${device.external_id}`);
      const key = feature.external_id.slice(device.external_id.length + 1);
      const sending = send(vehicle, key, value);
      if (!deadlineMs) return sending.then(() => undefined);
      let timer;
      const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve('late'), deadlineMs);
      });
      const first = await Promise.race([sending.then(() => 'sent'), late]).finally(() =>
        clearTimeout(timer),
      );
      if (first === 'late') {
        logger.info('The cloud is slow to accept the command: still running');
        sending.catch((err) => logger.error(`Command failed: ${err.message}`));
      }
      return undefined;
    },

    /** A command of the widget: resolves 'sent' or 'local', throws a UserError. */
    order(deviceExternalId, featureKey, value) {
      return send(requireVehicle(deviceExternalId), featureKey, value);
    },

    /** Start the preconditioning at a given temperature (scene action). */
    async startPreconditioning(deviceExternalId, temperature) {
      const vehicle = requireVehicle(deviceExternalId);
      const celsius = preconditioningTemperature(
        temperature !== undefined && temperature !== null && String(temperature).trim() !== ''
          ? temperature
          : (vehicle.snapshot.targetTempC ?? DEFAULT_PRECONDITIONING_C),
      );
      await send(vehicle, VEHICLE_FEATURES.PRECONDITIONING, 1, { args: celsius });
      return celsius;
    },

    /** Read a car again now (scene action, widget button). Never wakes the car. */
    async refresh(deviceExternalId) {
      const vehicle = requireVehicle(deviceExternalId);
      requireClient();
      if (now() - vehicle.lastReadAt >= MANUAL_REFRESH_MIN_GAP_MS) {
        try {
          await readVehicle(vehicle);
        } catch (err) {
          await handleError(err, `Reading ${logLabel(vehicle.info)}`);
          throw userTextOf(err) ? new UserError(userTextOf(err), err.kind) : err;
        }
      }
      return vehicle.snapshot;
    },

    /**
     * Connection test (manifest action): resolves a short summary (green),
     * throws an ActionFailure for anything else (red). It tests the saved
     * configuration: the core sends no form with an action.
     */
    async testConnection() {
      if (!config) throw new ActionFailure(MESSAGES.starting);
      if (!isConfigured(config) || !client) throw new ActionFailure(MESSAGES.notSaved);
      if (blocked === ERROR_KINDS.TFA_REQUIRED) {
        throw new ActionFailure(MESSAGES[ERROR_KINDS.TFA_REQUIRED]);
      }
      const accounts = [];
      try {
        await client.connect();
        for (const account of await client.accounts()) {
          let links = [];
          try {
            links = await client.vehicles(account.accountId);
          } catch (err) {
            if (BLOCKING_KINDS.has(err.kind) || err.kind === ERROR_KINDS.NETWORK) throw err;
          }
          if (links.length > 0) {
            accounts.push({
              id: account.accountId,
              names: links.map((link) => vehicleName(vehicleInfo(link, account.accountId))),
            });
          }
        }
      } catch (err) {
        logger.warn(`Connection test: ${err.message}`);
        if (BLOCKING_KINDS.has(err.kind)) await handleError(err, 'Connection test');
        throw new ActionFailure(failureText(err));
      }
      if (blocked) await restart(config);
      const kept = config.account_id
        ? accounts.filter((account) => account.id === config.account_id)
        : accounts;
      const names = kept.flatMap((account) => account.names);
      const list = names.length > 0 ? ` (${names.join(', ')})` : '';
      let more = { en: '', fr: '', de: '', es: '' };
      if (config.account_id && kept.length === 0) {
        throw new ActionFailure(MESSAGES.accountNotFound);
      }
      if (!config.account_id && accounts.length > 1) {
        const ids = accounts
          .map((account) => `${account.id}: ${account.names.join(', ')}`)
          .join('; ');
        more = {
          en: ` Accounts — ${ids}. To keep one, enter its id in “Account”.`,
          fr: ` Comptes — ${ids}. Pour n’en garder qu’un, saisissez son identifiant dans « Compte ».`,
          de: ` Konten — ${ids}. Um nur eines zu nutzen, gib seine ID unter „Konto“ ein.`,
          es: ` Cuentas — ${ids}. Para quedarse con una, introduzca su identificador en «Cuenta».`,
        };
      }
      return {
        en: `Connected: ${names.length} vehicle(s)${list}.${more.en}`,
        fr: `Connecté : ${names.length} véhicule(s)${list}.${more.fr}`,
        de: `Verbunden: ${names.length} Fahrzeug(e)${list}.${more.de}`,
        es: `Conectado: ${names.length} vehículo(s)${list}.${more.es}`,
      };
    },

    /** Two-step verification, first step (manifest action): e-mail a code. */
    async sendVerificationCode() {
      if (!config) throw new ActionFailure(MESSAGES.starting);
      if (!isConfigured(config) || !client) throw new ActionFailure(MESSAGES.notSaved);
      let email;
      try {
        ({ email } = await client.requestTfaCode());
      } catch (err) {
        logger.warn(`Sending the verification code: ${err.message}`);
        if (err.kind !== ERROR_KINDS.TFA_REQUIRED && BLOCKING_KINDS.has(err.kind)) {
          await handleError(err, 'Sending the verification code');
        }
        throw new ActionFailure(failureText(err));
      }
      if (email === null) {
        // Signed in without a code (the account no longer asks for one).
        if (blocked) await restart(config);
        return MESSAGES.tfaNotNeeded;
      }
      logger.info('Verification code sent by e-mail');
      return {
        en: `Code sent to ${email}. Enter it within a few minutes with “Enter the code”.`,
        fr: `Code envoyé à ${email}. Saisissez-le dans les minutes qui viennent avec « Saisir le code ».`,
        de: `Code an ${email} gesendet. Gib ihn in den nächsten Minuten mit „Code eingeben“ ein.`,
        es: `Código enviado a ${email}. Introdúzcalo en los próximos minutos con «Introducir el código».`,
      };
    },

    /** Two-step verification, second step (manifest action): check the code, sign in. */
    async verifyCode(rawCode) {
      if (!config) throw new ActionFailure(MESSAGES.starting);
      if (!isConfigured(config) || !client) throw new ActionFailure(MESSAGES.notSaved);
      const code = String(rawCode ?? '').replace(/\s+/g, '');
      if (!/^\d{4,10}$/.test(code)) throw new ActionFailure(MESSAGES.tfaCodeFormat);
      if (!client.tfaPending) throw new ActionFailure(MESSAGES.tfaSendFirst);
      try {
        await client.verifyTfaCode(code);
      } catch (err) {
        logger.warn(`Verification code: ${err.message}`);
        if (err.kind === ERROR_KINDS.TFA_REQUIRED) throw new ActionFailure(MESSAGES.tfaSendFirst);
        throw new ActionFailure(failureText(err));
      }
      logger.info('Two-step verification done: signed in');
      blocked = null;
      failing.clear();
      await discover();
      if (blocked) throw new ActionFailure(MESSAGES[blocked]);
      startTicker();
      return {
        en: `Verified and connected: ${vehicles.size} vehicle(s).`,
        fr: `Vérifié et connecté : ${vehicles.size} véhicule(s).`,
        de: `Bestätigt und verbunden: ${vehicles.size} Fahrzeug(e).`,
        es: `Verificado y conectado: ${vehicles.size} vehículo(s).`,
      };
    },

    // Read access for the widget and the scene actions.
    vehicleView(deviceExternalId) {
      const vehicle = findVehicle(deviceExternalId);
      if (!vehicle) return null;
      const device = vehicleDevice(vehicle);
      return {
        device,
        created: createdDevice(device.external_id) ?? null,
        info: vehicle.info,
        caps: capabilities(vehicle),
        snapshot: vehicle.snapshot,
        pending: new Set(vehicle.pending.keys()),
        lastCommand: vehicle.lastCommand,
        issue: blocked,
      };
    },
    get blocked() {
      return blocked;
    },
    // Exposed for the tests.
    _vehicles: vehicles,
  };
}

export { VEHICLE_FEATURES };
