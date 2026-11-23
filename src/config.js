// -----------------------------------------------------------------------------
// Integration configuration: defaults (they MUST match the `default` values of
// the manifest `config_schema`, see test/manifest.test.js) and normalization,
// so the rest of the code never deals with `undefined` or form strings.
// -----------------------------------------------------------------------------

import { DEFAULT_LOCALE, LOCALE_CODES } from './renault/locales.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Minutes between two reads of the cloud. A read never wakes the car, but each
// one is several calls: Home Assistant stays under 60 calls an hour per
// account (about one read every 7 minutes for one car); ten minutes is the
// shortest choice offered here, and more cars stretch it (see readPeriodMs).
export const REFRESH_CHOICES = ['10', '15', '30', '60'];

export const DEFAULT_CONFIG = {
  locale: DEFAULT_LOCALE,
  username: '',
  password: '',
  account_id: '',
  language: 'fr',
  refresh_minutes: '15',
  gps: false,
  username_2: '',
  password_2: '',
  username_3: '',
  password_3: '',
};

// Accounts 2 and 3 (optional): an e-mail address and a password each; they
// share the country, the language, the refresh and the GPS choice of account 1.
export const EXTRA_SLOTS = [2, 3];

const choice = (value, choices, fallback) =>
  choices.includes(String(value)) ? String(value) : fallback;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  return {
    locale: choice(config.locale, LOCALE_CODES, DEFAULT_CONFIG.locale),
    username: String(config.username ?? '').trim(),
    // Never trimmed inside: a password may contain spaces (a pasted one often
    // ends with a newline, though).
    password: String(config.password ?? '').replace(/[\r\n]+$/, ''),
    account_id: String(config.account_id ?? '').trim(),
    language: choice(config.language, LANGUAGES, DEFAULT_CONFIG.language),
    refresh_minutes: choice(
      config.refresh_minutes,
      REFRESH_CHOICES,
      DEFAULT_CONFIG.refresh_minutes,
    ),
    gps: config.gps === true || config.gps === 'true',
    ...Object.fromEntries(
      EXTRA_SLOTS.flatMap((slot) => [
        [`username_${slot}`, String(config[`username_${slot}`] ?? '').trim()],
        [`password_${slot}`, String(config[`password_${slot}`] ?? '').replace(/[\r\n]+$/, '')],
      ]),
    ),
  };
}

/**
 * The configuration of each account, account 1 first: the shared settings
 * with that account's credentials. Account 1 is always there (it says "not
 * configured" when empty); accounts 2 and 3 only when both their fields are
 * filled, and not twice the same address. `skipped` lists the slots ignored.
 * @param {object} config normalized config
 */
export function accountConfigs(config) {
  const accounts = [{ ...config, slot: 1 }];
  const skipped = [];
  const used = new Set(config.username ? [config.username.toLowerCase()] : []);
  for (const slot of EXTRA_SLOTS) {
    const username = config[`username_${slot}`] ?? '';
    const password = config[`password_${slot}`] ?? '';
    if (!username && !password) continue;
    if (!username || !password || used.has(username.toLowerCase())) {
      skipped.push(slot);
      continue;
    }
    used.add(username.toLowerCase());
    // Only account 1 can be narrowed to one of the person's accounts.
    accounts.push({ ...config, slot, username, password, account_id: '' });
  }
  return { accounts, skipped };
}

export const isConfigured = (config) => Boolean(config.username && config.password);

// The cloud quota Home Assistant respects: 60 calls an hour per account.
export const MAX_CALLS_PER_HOUR = 60;

/**
 * Period of the reads, in milliseconds: the configured one, stretched when the
 * cars of the account need more calls than the hourly budget allows.
 * @param {object} config normalized config
 * @param {number} callsPerCycle calls of one read of every car
 */
export function readPeriodMs(config, callsPerCycle = 0) {
  const configured = Number(config.refresh_minutes) * 60 * 1000;
  const budget = Math.ceil((callsPerCycle * 60) / MAX_CALLS_PER_HOUR) * 60 * 1000;
  return Math.max(configured, budget);
}
