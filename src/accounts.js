// -----------------------------------------------------------------------------
// Several MY Renault / MY Dacia accounts in one integration (up to three, see
// accountConfigs): one runtime (src/renault.js) per account, each with its own
// session, quota, errors and timer, behind the API of a single runtime.
//
// What Gladys holds once for the whole integration is merged here:
//   - the discovered devices: the union of the accounts' lists, account 1
//     first (Gladys replaces the whole list at each publication);
//   - the connection status: connected when every account is, otherwise the
//     first account in trouble, its message prefixed with "Account 2: ".
// A car shared by two accounts is read by the first account that lists it.
// Its device id comes from the VIN, so it does not depend on the account.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { accountConfigs } from './config.js';
import { ERROR_KINDS } from './renault/errors.js';
import { ActionFailure } from './messages.js';
import { createRenault } from './renault.js';

const ACCOUNT_WORD = { en: 'Account', fr: 'Compte', de: 'Konto', es: 'Cuenta' };
const COLON = { en: ': ', fr: ' : ', de: ': ', es: ': ' };

/** "Account 2: <text>" in each language (a plain string is English). */
export function prefixed(slot, text) {
  const texts = typeof text === 'string' ? { en: text, fr: text, de: text, es: text } : text;
  return Object.fromEntries(
    Object.entries(ACCOUNT_WORD).map(([lang, word]) => [
      lang,
      `${word} ${slot}${COLON[lang]}${texts?.[lang] ?? texts?.en ?? ''}`,
    ]),
  );
}

const textOf = (err) =>
  err?.message && typeof err.message === 'object' ? err.message : { en: String(err?.message) };

function prefixedLogger(logger, slot) {
  if (slot === 1) return logger;
  const tag = `Account ${slot}: `;
  const wrap =
    (level) =>
    (first, ...rest) =>
      logger[level](typeof first === 'string' ? `${tag}${first}` : first, ...rest);
  return {
    ...logger,
    debug: wrap('debug'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
  };
}

export function createAccounts({ gladys, store, logger, ...runtimeOptions }) {
  const baseLogger = runtimeOptions.logger ?? logger ?? createLogger({ name: 'renault' });
  // slot → { runtime, devices, status }
  const slots = new Map();
  let statusSent = null;

  const entries = () => [...slots.entries()].sort(([a], [b]) => a - b);
  const runtimes = () => entries().map(([, entry]) => entry.runtime);
  const several = () => slots.size > 1;

  async function publishUnion() {
    const seen = new Set();
    const devices = [];
    for (const [, entry] of entries()) {
      for (const device of entry.devices) {
        if (seen.has(device.external_id)) continue;
        seen.add(device.external_id);
        devices.push(device);
      }
    }
    await gladys.publishDiscoveredDevices(devices);
  }

  async function sendStatus() {
    const known = entries().filter(([, entry]) => entry.status);
    if (known.length === 0) return;
    const trouble = known.find(([, entry]) => !entry.status[0]);
    const [connected, message] = trouble
      ? [false, several() ? prefixed(trouble[0], trouble[1].status[1]) : trouble[1].status[1]]
      : [true, undefined];
    const key = JSON.stringify([connected, message ?? null]);
    if (key === statusSent) return;
    await gladys.setConnectionStatus(connected, message);
    statusSent = key;
  }

  /** What one account's runtime sees of Gladys: the shared calls go through here. */
  function gladysFor(slot) {
    return new Proxy(gladys, {
      get(target, prop) {
        if (prop === 'publishDiscoveredDevices') {
          return async (devices) => {
            const entry = slots.get(slot);
            if (entry) entry.devices = devices;
            await publishUnion();
          };
        }
        if (prop === 'setConnectionStatus') {
          return async (connected, message) => {
            const entry = slots.get(slot);
            if (entry) entry.status = [connected, message];
            await sendStatus();
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  function addSlot(slot) {
    const entry = { runtime: null, devices: [], status: null };
    slots.set(slot, entry);
    entry.runtime = createRenault({
      ...runtimeOptions,
      gladys: gladysFor(slot),
      store,
      logger: prefixedLogger(baseLogger, slot),
      slot,
      ownedElsewhere: (vin) =>
        entries().some(([other, e]) => other !== slot && e.runtime.hasVehicle(vin)),
    });
    return entry;
  }

  async function removeSlot(slot) {
    const entry = slots.get(slot);
    if (!entry) return;
    await entry.runtime.stop();
    for (const device of entry.devices) gladys.forgetPublishedStates(device.external_id);
    slots.delete(slot);
    await publishUnion();
    await sendStatus();
  }

  function warnSkipped(skipped) {
    for (const slot of skipped) {
      baseLogger.warn(
        `Account ${slot} ignored: it needs both an e-mail address and a password, different from the other accounts`,
      );
    }
  }

  /** The runtime of the account a device belongs to (account 1 if none). */
  function runtimeOf(deviceExternalId) {
    const owner = runtimes().find((runtime) => runtime.owns(deviceExternalId));
    return owner ?? slots.get(1).runtime;
  }

  /** Run an action on one account; with several accounts, say which one. */
  async function onAccount(slot, call) {
    const runtime = slots.get(slot).runtime;
    if (!several()) return call(runtime);
    try {
      return prefixed(slot, await call(runtime));
    } catch (err) {
      if (err instanceof ActionFailure) throw new ActionFailure(prefixed(slot, textOf(err)));
      throw err;
    }
  }

  // Account 1 exists from the start: it answers the actions before the
  // configuration is read ("starting") and when nothing is configured.
  addSlot(1);

  return {
    async start(config) {
      const { accounts, skipped } = accountConfigs(config);
      warnSkipped(skipped);
      for (const account of accounts) {
        const entry = slots.get(account.slot) ?? addSlot(account.slot);
        await entry.runtime.start(account);
      }
    },

    async stop() {
      for (const runtime of runtimes()) await runtime.stop();
    },

    async tick() {
      for (const runtime of runtimes()) await runtime.tick();
    },

    /** New configuration: accounts added, removed or changed. */
    async reconfigure(config) {
      const { accounts, skipped } = accountConfigs(config);
      warnSkipped(skipped);
      const wanted = new Set(accounts.map((account) => account.slot));
      const removed = [...slots.keys()].filter((slot) => !wanted.has(slot));
      for (const slot of removed) await removeSlot(slot);
      for (const account of accounts) {
        const existing = slots.get(account.slot);
        if (existing) await existing.runtime.reconfigure(account);
        else await addSlot(account.slot).runtime.start(account);
      }
      // A car shared with a removed account comes back with the remaining one.
      if (removed.length > 0) for (const runtime of runtimes()) await runtime.scan();
    },

    async reportStatus(connected, message) {
      await gladys.setConnectionStatus(connected, message);
      statusSent = null;
    },

    async resync() {
      statusSent = null;
      for (const runtime of runtimes()) await runtime.resync();
    },

    async scan() {
      for (const runtime of runtimes()) await runtime.scan();
    },

    deviceCreated: (device) => runtimeOf(device.external_id).deviceCreated(device),
    poll: (device) => runtimeOf(device.external_id).poll(device),
    setValue: (device, feature, value, options) =>
      runtimeOf(device.external_id).setValue(device, feature, value, options),
    order: (deviceExternalId, featureKey, value) =>
      runtimeOf(deviceExternalId).order(deviceExternalId, featureKey, value),
    startPreconditioning: (deviceExternalId, temperature) =>
      runtimeOf(deviceExternalId).startPreconditioning(deviceExternalId, temperature),
    refresh: (deviceExternalId) => runtimeOf(deviceExternalId).refresh(deviceExternalId),
    vehicleView: (deviceExternalId) => runtimeOf(deviceExternalId).vehicleView(deviceExternalId),

    /** Every account is tested; one failure makes the whole test red. */
    async testConnection() {
      if (!several()) return slots.get(1).runtime.testConnection();
      const parts = [];
      let failed = false;
      for (const [slot, entry] of entries()) {
        try {
          parts.push(prefixed(slot, await entry.runtime.testConnection()));
        } catch (err) {
          if (!(err instanceof ActionFailure)) throw err;
          failed = true;
          parts.push(prefixed(slot, textOf(err)));
        }
      }
      const joined = Object.fromEntries(
        Object.keys(ACCOUNT_WORD).map((lang) => [lang, parts.map((p) => p[lang]).join(' ')]),
      );
      if (failed) throw new ActionFailure(joined);
      return joined;
    },

    /**
     * The code goes to the first account waiting for one (account 1 if none):
     * with two accounts to verify, send and enter the codes one after the other.
     */
    sendVerificationCode() {
      const waiting = entries().find(
        ([, entry]) => entry.runtime.blocked === ERROR_KINDS.TFA_REQUIRED,
      );
      return onAccount(waiting?.[0] ?? 1, (runtime) => runtime.sendVerificationCode());
    },

    /** Checked by the account a code was sent for. */
    verifyCode(code) {
      const pending =
        entries().find(([, entry]) => entry.runtime.tfaPending) ??
        entries().find(([, entry]) => entry.runtime.blocked === ERROR_KINDS.TFA_REQUIRED);
      return onAccount(pending?.[0] ?? 1, (runtime) => runtime.verifyCode(code));
    },

    get blocked() {
      return slots.get(1).runtime.blocked;
    },
    /** The runtime of one account (tests). */
    account: (slot) => slots.get(slot)?.runtime ?? null,
    // Exposed for the tests: the cars of every account.
    get _vehicles() {
      return new Map(runtimes().flatMap((runtime) => [...runtime._vehicles]));
    },
  };
}
