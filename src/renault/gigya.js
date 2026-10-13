// -----------------------------------------------------------------------------
// Gigya: the sign-in service of the MY Renault / MY Dacia apps, ported from
// hacf-fr/renault-api (MIT, gigya/__init__.py and renault_session.py).
//
//   accounts.login (e-mail, password)   → login token (the session cookie
//                                          value), kept in /data instead of
//                                          the password;
//   accounts.getAccountInfo (token)     → personId (Kamereon person);
//   accounts.getJWT (token)             → id_token, the 15-minute JWT every
//                                          Kamereon call carries.
//
// Two-factor authentication (Gigya 403101, enforced on some accounts since
// 2026, renault-api#2132): the login answers a `regToken`; a code is e-mailed
// (initTFA → email.getEmails → email.sendVerificationCode), the user types it
// (email.completeVerification → finalizeTFA), then the login is replayed. The
// device ids `gmid`/`ucid` (cookies of accounts.webSdkBootstrap) identify
// this "device": sent with the next logins, Gigya does not ask again for about
// 30 days.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, RenaultError, checkGigyaResponse } from './errors.js';
import { responseCookies } from './http.js';

const DEVICE_ID_COOKIES = ['gmid', 'ucid'];
// Lifetime asked for the JWT, in seconds (as the app and the library do).
export const JWT_EXPIRATION_S = 900;

/**
 * @param {object} http src/renault/http.js
 * @param {{ gigyaUrl: string, gigyaKey: string, locale: string }} settings
 */
export function createGigya(http, settings) {
  const url = (method) => `${settings.gigyaUrl}/${method}`;

  async function call(method, { form, query, cookies } = {}) {
    const response = await http.request(url(method), {
      method: form ? 'POST' : 'GET',
      form,
      query,
      cookies,
    });
    return checkGigyaResponse(response.json(), response.status);
  }

  return {
    /**
     * Sign in with the password.
     * @returns {Promise<string>} the login token
     * @throws RenaultError AUTH, TFA_REQUIRED (with `regToken`), BLOCKED...
     */
    async login(loginId, password, deviceIds) {
      const body = await call('accounts.login', {
        form: { ApiKey: settings.gigyaKey, loginID: loginId, password },
        cookies: deviceIds,
      });
      const token = body.sessionInfo?.cookieValue;
      if (!token) throw new RenaultError(ERROR_KINDS.API, 'Gigya login without session');
      return token;
    },

    /** @returns {Promise<string>} the Kamereon person id of the account */
    async personId(loginToken) {
      const body = await call('accounts.getAccountInfo', {
        form: { ApiKey: settings.gigyaKey, login_token: loginToken },
      });
      const id = body.data?.personId;
      if (!id) throw new RenaultError(ERROR_KINDS.API, 'Gigya account without personId');
      return id;
    },

    /** @returns {Promise<string>} a fresh JWT */
    async jwt(loginToken) {
      const body = await call('accounts.getJWT', {
        form: {
          ApiKey: settings.gigyaKey,
          login_token: loginToken,
          fields: 'data.personId,data.gigyaDataCenter',
          expiration: JWT_EXPIRATION_S,
        },
      });
      if (!body.id_token) throw new RenaultError(ERROR_KINDS.API, 'Gigya answer without JWT');
      return body.id_token;
    },

    /** New device ids (`gmid`, `ucid`), set as cookies by the bootstrap call. */
    async deviceIds() {
      const response = await http.request(url('accounts.webSdkBootstrap'), {
        query: { APIKey: settings.gigyaKey },
      });
      if (response.status >= 400) {
        throw new RenaultError(
          response.status >= 500 ? ERROR_KINDS.SERVER : ERROR_KINDS.API,
          `Gigya bootstrap HTTP ${response.status}`,
          { status: response.status },
        );
      }
      const cookies = responseCookies(response.headers);
      return Object.fromEntries(
        DEVICE_ID_COOKIES.filter((name) => cookies[name]).map((name) => [name, cookies[name]]),
      );
    },

    /** Start the e-mail challenge: its assertion. */
    async initTfa(regToken, deviceIds) {
      const body = await call('accounts.tfa.initTFA', {
        query: {
          APIKey: settings.gigyaKey,
          regToken,
          provider: 'gigyaEmail',
          mode: 'verify',
          ...deviceIds,
        },
        cookies: deviceIds,
      });
      if (!body.gigyaAssertion) throw new RenaultError(ERROR_KINDS.API, 'initTFA: no assertion');
      return body.gigyaAssertion;
    },

    /** The addresses a code can be sent to: `[{ id, obfuscated }]`. */
    async tfaEmails(assertion, deviceIds) {
      const body = await call('accounts.tfa.email.getEmails', {
        query: { APIKey: settings.gigyaKey, gigyaAssertion: assertion },
        cookies: deviceIds,
      });
      return (body.emails ?? []).filter((email) => email?.id);
    },

    /** E-mail the code: its `phvToken`. */
    async sendTfaCode(assertion, emailId, deviceIds) {
      const body = await call('accounts.tfa.email.sendVerificationCode', {
        query: {
          APIKey: settings.gigyaKey,
          gigyaAssertion: assertion,
          emailID: emailId,
          lang: settings.locale.split('_')[0],
        },
        cookies: deviceIds,
      });
      if (!body.phvToken) throw new RenaultError(ERROR_KINDS.API, 'sendVerificationCode: no token');
      return body.phvToken;
    },

    /** Check the typed code, then mark this device as trusted. */
    async completeTfa({ assertion, phvToken, regToken, code }, deviceIds) {
      const verified = await call('accounts.tfa.email.completeVerification', {
        query: {
          APIKey: settings.gigyaKey,
          gigyaAssertion: assertion,
          phvToken,
          code,
        },
        cookies: deviceIds,
      });
      if (!verified.providerAssertion) {
        throw new RenaultError(ERROR_KINDS.API, 'completeVerification: no assertion');
      }
      await call('accounts.tfa.finalizeTFA', {
        query: {
          APIKey: settings.gigyaKey,
          gigyaAssertion: assertion,
          providerAssertion: verified.providerAssertion,
          regToken,
          // Remember this device (the official web client's default).
          tempDevice: 'false',
        },
        cookies: deviceIds,
      });
    },
  };
}

/**
 * Expiry (epoch ms) of a JWT, read from its payload (not verified: only used
 * to know when to ask for a new one). `null` when it cannot be read.
 */
export function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
