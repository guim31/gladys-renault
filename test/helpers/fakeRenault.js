// -----------------------------------------------------------------------------
// A fake MY Renault cloud behind a fake `fetch`: Gigya (sign-in, JWT,
// two-factor e-mail codes) and Kamereon (person, vehicles, car data, actions),
// answering with the fixtures of test/fixtures/renault (from renault-api).
//
// Every request is recorded (`calls`), and the tests can change what a car
// answers (`data`), make an endpoint fail (`fail`), cut the network
// (`network`), or require a two-factor verification (`tfa`).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixturesDir = new URL('../fixtures/renault/', import.meta.url);
export const fixture = (path) =>
  JSON.parse(readFileSync(new URL(`${path}.json`, fixturesDir), 'utf8'));

export const USERNAME = 'driver@example.com';
export const PASSWORD = 'correct horse battery';
export const TFA_CODE = '123456';

export const VINS = {
  ZOE: 'VF1AAAAA555777999', // Zoe phase 2 (X102VE), charging
  R5: 'VF1AAAA0000000000', // Renault 5 (R5E1VE), KCM charge start
  SPRING: 'UU1AAAA555777999', // Dacia Spring (XBG1VE), pause-resume
  CAPTUR_PHEV: 'VF1AAAAA555777123', // Captur II plug-in hybrid (XJB1SU)
  ZOE_PH1: 'VF1AAAAA555777888', // Zoe phase 1 (X101VE), charge-mode endpoint
  AUSTRAL: 'VF1AAAAA555779876', // Austral full hybrid (XHN1SU): no battery
  CAPTUR_LPG: 'VF1AAAAA555777456', // Captur II LPG (XJB2SU): lock status
};

/** What each car answers, endpoint → fixture name (an object is sent as is). */
export function defaultCarData() {
  return {
    [VINS.ZOE]: {
      'battery-status': 'battery-status.2',
      cockpit: 'cockpit.zoe_50',
      'hvac-status': 'hvac-status.zoe',
      'charging-settings': 'charging-settings.single',
      location: 'location.1',
    },
    [VINS.R5]: {
      'battery-status': 'battery-status.renault_5',
      cockpit: 'cockpit.renault_5',
      'hvac-status': 'hvac-status.renault_5',
      location: 'location.renault_5_2',
      'ev/settings': 'ev-settings.single.active',
    },
    [VINS.SPRING]: {
      'battery-status': 'battery-status.1',
      cockpit: 'cockpit.spring',
      'hvac-status': 'hvac-status.spring',
      location: 'location.1',
    },
    [VINS.CAPTUR_PHEV]: {
      'battery-status': 'battery-status.1',
      cockpit: 'cockpit.captur_ii',
      'hvac-status': 'hvac-status.zoe',
      'charging-settings': 'charging-settings.always',
      location: 'location.1',
    },
    [VINS.ZOE_PH1]: {
      'battery-status': 'battery-status.1',
      cockpit: 'cockpit.zoe',
      'hvac-status': 'hvac-status.zoe_50',
      'charge-mode': 'charge-mode',
    },
    [VINS.AUSTRAL]: {
      cockpit: 'cockpit.austral_XHN1SU',
      location: 'location.austral_XHN1SU',
    },
    [VINS.CAPTUR_LPG]: {
      cockpit: 'cockpit.captur_ii',
      'lock-status': 'lock-status.2',
      location: 'location.1',
    },
  };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const ERROR_STATUS = {
  access_denied: 403,
  forbidden: 403,
  not_supported: 501,
  quota_limit: 429,
  resource_not_found: 404,
  unauthorized: 401,
  privacy_on: 403,
  charge_mode_inprogress: 409,
  invalid_upstream: 500,
  'hvac-status.403.403011': 403,
};

/**
 * @param {object} [options]
 * @param {() => number} [options.now] the clock of the JWT expiries
 * @param {boolean} [options.tfa] the account asks for an e-mailed code
 * @param {object} [options.vehicles] the vehicles answer of account-id-1
 */
export function createFakeRenault({ now = () => Date.now(), tfa = false, vehicles } = {}) {
  const fake = {
    calls: [],
    actions: [],
    data: defaultCarData(),
    vehicles: vehicles ?? fixture('kamereon/vehicles'),
    // `${vin}:${endpoint}` → error fixture name (kamereon/error/...)
    errors: new Map(),
    password: PASSWORD,
    tfa,
    network: true,
    codesSent: 0,
    revokedTokens: new Set(),
    trustedGmids: new Set(),
    loginCount: 0,
    jwtCount: 0,
    validJwts: new Map(), // token → expiry (ms)

    /** Make an endpoint of a car fail with a Kamereon error fixture. */
    fail(vin, endpoint, errorName) {
      fake.errors.set(`${vin}:${endpoint}`, errorName);
    },
    heal(vin, endpoint) {
      fake.errors.delete(`${vin}:${endpoint}`);
    },
    /** Kamereon calls of the cars (no sign-in, no listing). */
    carCalls(vin) {
      return fake.calls.filter((c) => c.vin && (!vin || c.vin === vin));
    },
  };

  function gigya(path, params, cookies) {
    const gigyaFixture = (name) => fixture(`gigya/${name}`);
    switch (path) {
      case '/accounts.login': {
        fake.loginCount += 1;
        if (params.get('loginID') !== USERNAME || params.get('password') !== fake.password) {
          return json(gigyaFixture('login.403042'));
        }
        if (fake.tfa && !fake.trustedGmids.has(cookies.gmid)) {
          return json(gigyaFixture('login.403101'));
        }
        const body = gigyaFixture('login');
        body.sessionInfo.cookieValue = `login-token-${fake.loginCount}`;
        return json(body);
      }
      case '/accounts.getAccountInfo':
        return json(gigyaFixture('get_account_info'));
      case '/accounts.getJWT': {
        const token = params.get('login_token');
        if (!token || fake.revokedTokens.has(token)) return json(gigyaFixture('get_jwt.403005'));
        fake.jwtCount += 1;
        const exp = Math.floor(now() / 1000) + Number(params.get('expiration') ?? 900);
        const payload = Buffer.from(JSON.stringify({ exp, n: fake.jwtCount })).toString(
          'base64url',
        );
        const jwt = `eyJhbGciOiJub25lIn0.${payload}.signature`;
        fake.validJwts.set(jwt, exp * 1000);
        return json({ ...gigyaFixture('get_jwt'), id_token: jwt });
      }
      case '/accounts.webSdkBootstrap': {
        const headers = new Headers({ 'Content-Type': 'application/json' });
        headers.append('Set-Cookie', 'gmid=gmid-1; Path=/; Secure');
        headers.append('Set-Cookie', 'ucid=ucid-1; Path=/; Secure');
        return new Response('{"errorCode":0}', { status: 200, headers });
      }
      case '/accounts.tfa.initTFA':
        return json(gigyaFixture('tfa_init'));
      case '/accounts.tfa.email.getEmails':
        return json(gigyaFixture('tfa_get_emails'));
      case '/accounts.tfa.email.sendVerificationCode':
        fake.codesSent += 1;
        return json(gigyaFixture('tfa_send_email_code'));
      case '/accounts.tfa.email.completeVerification':
        return json(
          params.get('code') === TFA_CODE
            ? gigyaFixture('tfa_complete_email_verification')
            : gigyaFixture('tfa_complete_email_verification.400006'),
        );
      case '/accounts.tfa.finalizeTFA':
        if (cookies.gmid) fake.trustedGmids.add(cookies.gmid);
        return json(gigyaFixture('tfa_finalize_tfa'));
      default:
        return json({ errorCode: 400002, errorDetails: `unknown ${path}` });
    }
  }

  const kamereonError = (name) =>
    json(fixture(`kamereon/error/${name}`), ERROR_STATUS[name] ?? 400);

  function kamereon(method, path, headers, body) {
    const token = headers['x-gigya-id_token'];
    const expiry = fake.validJwts.get(token);
    if (!expiry || expiry <= now()) return kamereonError('unauthorized');
    if (path === '/commerce/v1/persons/person-id-1') return json(fixture('kamereon/person'));
    if (path === '/commerce/v1/accounts/account-id-1/vehicles') return json(fake.vehicles);
    if (path === '/commerce/v1/accounts/account-id-2/vehicles') return kamereonError('forbidden');
    const car =
      /^\/commerce\/v1\/accounts\/account-id-1\/kamereon\/(?:kca\/car-adapter\/v\d+\/cars|kcm\/v1\/vehicles)\/([^/]+)\/(.+)$/.exec(
        path,
      );
    if (!car) return kamereonError('resource_not_found');
    const [, vin, endpoint] = car;
    const failure = fake.errors.get(`${vin}:${endpoint}`);
    if (failure) return kamereonError(failure);
    if (method === 'POST') {
      fake.actions.push({ vin, endpoint, body });
      if (endpoint === 'ev/settings') return json(body);
      return json({
        data: { type: body?.data?.type, id: 'guid', attributes: body?.data?.attributes },
      });
    }
    const answer = fake.data[vin]?.[endpoint];
    if (answer === undefined) return kamereonError('resource_not_found');
    return json(typeof answer === 'string' ? fixture(`kamereon/data/${answer}`) : answer);
  }

  fake.fetch = async (url, init = {}) => {
    const target = new URL(url);
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}));
    const cookies = Object.fromEntries(
      String(headers.Cookie ?? '')
        .split(';')
        .map((pair) => pair.trim().split('='))
        .filter(([name]) => name),
    );
    const body =
      typeof init.body === 'string' && headers['Content-Type']?.includes('json')
        ? JSON.parse(init.body)
        : init.body;
    const params =
      typeof init.body === 'string' &&
      headers['Content-Type'] === 'application/x-www-form-urlencoded'
        ? new URLSearchParams(init.body)
        : target.searchParams;
    const car = /\/(?:cars|vehicles)\/([^/]+)\/(.+)$/.exec(target.pathname);
    fake.calls.push({
      method: init.method ?? 'GET',
      host: target.host,
      path: target.pathname,
      vin: target.host.startsWith('api-wired') && car ? car[1] : undefined,
      endpoint: car?.[2],
    });
    if (!fake.network) throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    if (target.host === 'accounts.eu1.gigya.com') return gigya(target.pathname, params, cookies);
    if (target.host === 'api-wired-prod-1-euw1.wrd-aws.com') {
      if (target.searchParams.get('country') !== 'FR') return kamereonError('access_denied');
      return kamereon(init.method ?? 'GET', target.pathname, headers, body);
    }
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  };

  return fake;
}
