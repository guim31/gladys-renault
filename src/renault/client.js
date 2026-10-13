// -----------------------------------------------------------------------------
// The MY Renault / MY Dacia cloud client: a Gigya session and the Kamereon
// calls, ported from hacf-fr/renault-api (MIT: renault_session.py,
// renault_vehicle.py, kamereon/__init__.py).
//
// The password is used to sign in only: the login token it gives is kept in
// /data (through `session`) and mints the 15-minute JWTs of the Kamereon calls,
// as Home Assistant does. A refused token (Gigya 403005/403013) is dropped
// and the password used again, once.
//
// Kamereon reads return the state the car last sent to the cloud: they never
// wake the car. Commands are accepted (or refused) by the cloud at once; the
// car carries them out later, and the next reads tell whether it did.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, RenaultError, checkKamereonResponse } from './errors.js';
import { createGigya, jwtExpiry } from './gigya.js';
import { endpointFor } from './endpoints.js';
import { localeSettings } from './locales.js';

const JWT_MARGIN_MS = 60 * 1000;
const JWT_FALLBACK_LIFETIME_MS = 10 * 60 * 1000;
const KAMEREON_CONTENT_TYPE = 'application/vnd.api+json';

// Charge mode: the values the action takes (renault-api docs, vehicle_action.charge-mode).
export const CHARGE_MODE_ACTIONS = { always: 'always_charging', scheduled: 'schedule_mode' };

/**
 * @param {object} options
 * @param {object} options.http src/renault/http.js
 * @param {string} options.locale e.g. "fr_FR"
 * @param {{ username: string, password: string }} options.credentials
 * @param {{ get: () => object, set: (partial: object) => void }} options.session
 *   persistence of { loginToken, personId, deviceIds } (src/store.js)
 * @param {() => number} [options.now]
 */
export function createRenaultClient({ http, locale, credentials, session, now = Date.now }) {
  const settings = localeSettings(locale);
  const gigya = createGigya(http, settings);
  let jwt = null; // { token, expiresAt }
  let jwtPromise = null;
  // Two-factor challenge in progress (memory only: it holds a token).
  let tfa = null; // { regToken, assertion?, phvToken? }

  const stored = () => session.get() ?? {};

  async function passwordLogin() {
    if (!credentials.username || !credentials.password) {
      throw new RenaultError(ERROR_KINDS.AUTH, 'No e-mail address or password');
    }
    try {
      const loginToken = await gigya.login(
        credentials.username,
        credentials.password,
        stored().deviceIds,
      );
      tfa = null;
      session.set({ loginToken, personId: null });
      return loginToken;
    } catch (err) {
      if (err.kind === ERROR_KINDS.TFA_REQUIRED) tfa = { regToken: err.regToken };
      throw err;
    }
  }

  /** The saved login token, or a new one from the password. */
  async function loginToken() {
    return stored().loginToken || passwordLogin();
  }

  async function fetchJwt() {
    let token = await loginToken();
    let value;
    try {
      value = await gigya.jwt(token);
    } catch (err) {
      if (err.kind !== ERROR_KINDS.SESSION_EXPIRED) throw err;
      // The saved session was revoked (password changed, signed out...).
      session.set({ loginToken: null, personId: null });
      token = await passwordLogin();
      value = await gigya.jwt(token);
    }
    const expiry = jwtExpiry(value) ?? now() + JWT_FALLBACK_LIFETIME_MS;
    jwt = { token: value, expiresAt: expiry - JWT_MARGIN_MS };
    return value;
  }

  async function currentJwt() {
    if (jwt && now() < jwt.expiresAt) return jwt.token;
    // One request at a time: parallel reads share it.
    jwtPromise ??= fetchJwt().finally(() => {
      jwtPromise = null;
    });
    return jwtPromise;
  }

  async function kamereon(method, path, { json, query } = {}) {
    const send = async () => {
      const token = await currentJwt();
      const response = await http.request(`${settings.kamereonUrl}${path}`, {
        method,
        query: { country: settings.country, ...query },
        headers: { apikey: settings.kamereonKey, 'x-gigya-id_token': token },
        json,
        contentType: KAMEREON_CONTENT_TYPE,
      });
      return checkKamereonResponse(response.json(), response.status);
    };
    try {
      return await send();
    } catch (err) {
      if (err.kind !== ERROR_KINDS.TOKEN_EXPIRED) throw err;
      jwt = null;
      return send();
    }
  }

  async function personId() {
    const saved = stored().personId;
    if (saved) return saved;
    const id = await gigya.personId(await loginToken());
    session.set({ personId: id });
    return id;
  }

  const carPath = (vehicle, endpoint) =>
    `/commerce/v1/accounts/${encodeURIComponent(vehicle.accountId)}/kamereon${endpoint.path.replace(
      '{vin}',
      encodeURIComponent(vehicle.vin),
    )}`;

  function endpoint(vehicle, key) {
    const found = endpointFor(vehicle.modelCode, key);
    if (!found) {
      throw new RenaultError(
        ERROR_KINDS.NOT_SUPPORTED,
        `${key} is not available on model ${vehicle.modelCode ?? 'unknown'}`,
      );
    }
    return found;
  }

  async function post(vehicle, key, json) {
    return kamereon('POST', carPath(vehicle, endpoint(vehicle, key)), { json });
  }

  const actionBody = (type, attributes) => ({ data: { type, attributes } });

  return {
    locale: settings.locale,

    /** Sign in now (the saved session, else the password). */
    async connect() {
      await currentJwt();
    },

    /** The accounts of the person: `[{ accountId, accountType, accountStatus }]`. */
    async accounts() {
      const id = await personId();
      const body = await kamereon('GET', `/commerce/v1/persons/${encodeURIComponent(id)}`);
      return (body.accounts ?? []).filter((account) => account?.accountId);
    },

    /** The vehicle links of an account (each with `vin` and `vehicleDetails`). */
    async vehicles(accountId) {
      const body = await kamereon(
        'GET',
        `/commerce/v1/accounts/${encodeURIComponent(accountId)}/vehicles`,
      );
      return (body.vehicleLinks ?? []).filter((link) => link?.vin && link.vehicleDetails);
    },

    /**
     * One data endpoint of a car: its attributes.
     * @param {{ accountId: string, vin: string, modelCode?: string }} vehicle
     * @param {string} key e.g. "battery-status"
     */
    async read(vehicle, key) {
      const body = await kamereon('GET', carPath(vehicle, endpoint(vehicle, key)));
      return body.data?.attributes ?? {};
    },

    /** Whether the model offers an endpoint (data or action). */
    supports(vehicle, key) {
      return endpointFor(vehicle.modelCode, key) !== null;
    },

    /** Start the preconditioning (heats or cools the cabin) at `temperature` °C. */
    async hvacStart(vehicle, temperature) {
      await post(
        vehicle,
        'actions/hvac-start',
        actionBody('HvacStart', { action: 'start', targetTemperature: temperature }),
      );
    },

    async hvacStop(vehicle) {
      const found = endpoint(vehicle, 'actions/hvac-stop');
      const action = found.mode === 'kca-stop' ? 'stop' : 'cancel';
      await kamereon('POST', carPath(vehicle, found), {
        json: actionBody('HvacStart', { action }),
      });
    },

    async chargeStart(vehicle) {
      const found = endpoint(vehicle, 'actions/charge-start');
      const path = carPath(vehicle, found);
      if (found.mode === 'kcm-settings') {
        // Renault 5, Scenic, Megane (KCM): the app starts the charge by turning
        // the charge programs off (renault-api#1348). They stay off.
        const settingsNow = await kamereon('GET', path);
        for (const program of settingsNow.programs ?? []) program.programActivationStatus = false;
        await kamereon('POST', path, { json: settingsNow });
        return;
      }
      const json =
        found.mode === 'kcm-pause-resume'
          ? actionBody('ChargePauseResume', { action: 'resume' })
          : actionBody('ChargingStart', { action: 'start' });
      await kamereon('POST', path, { json });
    },

    async chargeStop(vehicle) {
      const found = endpoint(vehicle, 'actions/charge-stop');
      const json =
        found.mode === 'kcm-pause-resume'
          ? actionBody('ChargePauseResume', { action: 'pause' })
          : actionBody('ChargingStart', { action: 'stop' });
      await kamereon('POST', carPath(vehicle, found), { json });
    },

    /** @param {'always' | 'scheduled'} mode */
    async setChargeMode(vehicle, mode) {
      await post(
        vehicle,
        'actions/charge-set-mode',
        actionBody('ChargeMode', { action: CHARGE_MODE_ACTIONS[mode] }),
      );
    },

    // --- Two-factor authentication ------------------------------------------

    /** Whether a sign-in is waiting for an e-mailed code. */
    get tfaPending() {
      return tfa !== null;
    },

    /**
     * E-mail a verification code (signs in with the password first, which
     * starts the challenge).
     * @returns {Promise<{ email: string }>} the obfuscated address
     */
    async requestTfaCode() {
      // A fresh challenge each time: one only lives a few minutes on Gigya's side.
      try {
        await passwordLogin();
        // No code needed after all: signed in.
        return { email: null };
      } catch (err) {
        if (err.kind !== ERROR_KINDS.TFA_REQUIRED) throw err;
      }
      let deviceIds = stored().deviceIds;
      if (!deviceIds?.gmid) {
        deviceIds = await gigya.deviceIds();
        session.set({ deviceIds });
      }
      const assertion = await gigya.initTfa(tfa.regToken, deviceIds);
      const emails = await gigya.tfaEmails(assertion, deviceIds);
      if (emails.length === 0) {
        throw new RenaultError(ERROR_KINDS.API, 'No e-mail address registered for the code');
      }
      // The first address: the one of the account in nearly every case.
      const phvToken = await gigya.sendTfaCode(assertion, emails[0].id, deviceIds);
      tfa = { ...tfa, assertion, phvToken };
      return { email: String(emails[0].obfuscated ?? '') };
    },

    /** Check the e-mailed code, then sign in (this device is then remembered). */
    async verifyTfaCode(code) {
      if (!tfa?.phvToken) {
        throw new RenaultError(ERROR_KINDS.TFA_REQUIRED, 'No code was requested');
      }
      const deviceIds = stored().deviceIds;
      await gigya.completeTfa({ ...tfa, code }, deviceIds);
      tfa = null;
      jwt = null;
      await passwordLogin();
      await currentJwt();
    },
  };
}
