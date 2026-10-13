// -----------------------------------------------------------------------------
// The cloud client on its own: Gigya sign-in and JWT, Kamereon errors, the
// bodies of the commands per model, and error messages free of tokens.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp } from '../src/renault/http.js';
import { createRenaultClient } from '../src/renault/client.js';
import { ERROR_KINDS, checkGigyaResponse, checkKamereonResponse } from '../src/renault/errors.js';
import { endpointFor, isKnownModel } from '../src/renault/endpoints.js';
import { jwtExpiry } from '../src/renault/gigya.js';
import { localeSettings } from '../src/renault/locales.js';
import { PASSWORD, USERNAME, VINS, createFakeRenault, fixture } from './helpers/fakeRenault.js';

const T0 = Date.UTC(2026, 9, 13, 10, 0, 0);

function setup({ tfa = false, password = PASSWORD, session = {} } = {}) {
  let clock = T0;
  const now = () => clock;
  const cloud = createFakeRenault({ now, tfa });
  const saved = { ...session };
  const client = createRenaultClient({
    http: createHttp({ fetchImpl: cloud.fetch }),
    locale: 'fr_FR',
    credentials: { username: USERNAME, password },
    session: { get: () => saved, set: (partial) => Object.assign(saved, partial) },
    now,
  });
  return { client, cloud, saved, advance: (ms) => (clock += ms) };
}

const car = (vin, modelCode) => ({ accountId: 'account-id-1', vin, modelCode });

test('one sign-in, then the JWT is reused until it expires', async () => {
  const { client, cloud, saved, advance } = setup();
  await client.connect();
  await client.accounts();
  await client.read(car(VINS.ZOE, 'X102VE'), 'cockpit');
  assert.equal(cloud.loginCount, 1);
  assert.equal(cloud.jwtCount, 1);
  assert.equal(saved.loginToken, 'login-token-1');
  assert.equal(saved.personId, 'person-id-1');
  advance(15 * 60 * 1000);
  await client.read(car(VINS.ZOE, 'X102VE'), 'cockpit');
  assert.equal(cloud.jwtCount, 2, 'a new JWT once the first expired');
  assert.equal(cloud.loginCount, 1, 'without the password');
});

test('the accounts, then the vehicles of an account', async () => {
  const { client } = setup();
  const accounts = await client.accounts();
  assert.deepEqual(
    accounts.map((a) => [a.accountId, a.accountType]),
    [
      ['account-id-1', 'MYRENAULT'],
      ['account-id-2', 'SFDC'],
    ],
  );
  const links = await client.vehicles('account-id-1');
  assert.equal(links.length, 7);
  await assert.rejects(client.vehicles('account-id-2'), { kind: ERROR_KINDS.ACCESS_DENIED });
});

test('a wrong password and a two-step account are told apart', async () => {
  await assert.rejects(setup({ password: 'nope' }).client.connect(), { kind: ERROR_KINDS.AUTH });
  const { client } = setup({ tfa: true });
  await assert.rejects(client.connect(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.TFA_REQUIRED);
    // The token is on the error, but never in its text.
    assert.equal(err.regToken, 'sample-reg-token');
    assert.ok(!String(err.message).includes('sample-reg-token'));
    assert.ok(!JSON.stringify(err).includes('sample-reg-token'));
    return true;
  });
  assert.equal(client.tfaPending, true);
});

test('the two-step verification: code requested, checked, device remembered', async () => {
  const { client, cloud, saved } = setup({ tfa: true });
  await assert.rejects(client.verifyTfaCode('123456'), { kind: ERROR_KINDS.TFA_REQUIRED });
  assert.deepEqual(await client.requestTfaCode(), { email: 'e***@example.com' });
  await assert.rejects(client.verifyTfaCode('654321'), { kind: ERROR_KINDS.TFA_CODE });
  await client.verifyTfaCode('123456');
  assert.equal(client.tfaPending, false);
  assert.deepEqual(saved.deviceIds, { gmid: 'gmid-1', ucid: 'ucid-1' });
  assert.ok(cloud.trustedGmids.has('gmid-1'));
  assert.ok(saved.loginToken);
});

test('a revoked session: the password is used again, once', async () => {
  const { client, cloud } = setup({ session: { loginToken: 'old-token' } });
  cloud.revokedTokens.add('old-token');
  await client.connect();
  assert.equal(cloud.loginCount, 1);
});

test('an expired JWT on Kamereon: a new one, the call made again', async () => {
  const { client, cloud } = setup();
  await client.connect();
  cloud.validJwts.clear();
  const cockpit = await client.read(car(VINS.ZOE, 'X102VE'), 'cockpit');
  assert.equal(cockpit.totalMileage, 5785.75);
  assert.equal(cloud.jwtCount, 2);
});

test('the command bodies follow the model', async () => {
  const { client, cloud } = setup();
  await client.hvacStart(car(VINS.ZOE, 'X102VE'), 20.5);
  await client.hvacStop(car(VINS.ZOE, 'X102VE'));
  await client.hvacStop(car(VINS.SPRING, 'XBG1VE'));
  await client.chargeStart(car(VINS.ZOE, 'X102VE'));
  await client.chargeStop(car(VINS.SPRING, 'XBG1VE'));
  await client.setChargeMode(car(VINS.ZOE_PH1, 'X101VE'), 'always');
  assert.deepEqual(
    cloud.actions.map((a) => [a.endpoint, a.body.data.attributes]),
    [
      ['actions/hvac-start', { action: 'start', targetTemperature: 20.5 }],
      ['actions/hvac-start', { action: 'cancel' }],
      // The Spring stops its climate with "stop" (renault-api kca-stop).
      ['actions/hvac-start', { action: 'stop' }],
      ['actions/charging-start', { action: 'start' }],
      ['charge/pause-resume', { action: 'pause' }],
      ['actions/charge-mode', { action: 'always_charging' }],
    ],
  );
  await assert.rejects(client.chargeStop(car(VINS.R5, 'R5E1VE')), {
    kind: ERROR_KINDS.NOT_SUPPORTED,
  });
});

test('Kamereon errors map to what the runtime does about them', () => {
  const kind = (name, status) => {
    try {
      checkKamereonResponse(fixture(`kamereon/error/${name}`), status);
    } catch (err) {
      return err.kind;
    }
    return null;
  };
  assert.equal(kind('quota_limit', 429), ERROR_KINDS.RATE_LIMIT);
  assert.equal(kind('not_supported', 501), ERROR_KINDS.NOT_SUPPORTED);
  assert.equal(kind('hvac-status.403.403011', 403), ERROR_KINDS.NOT_SUPPORTED);
  assert.equal(kind('access_denied', 403), ERROR_KINDS.ACCESS_DENIED);
  assert.equal(kind('forbidden', 403), ERROR_KINDS.ACCESS_DENIED);
  assert.equal(kind('resource_not_found', 404), ERROR_KINDS.NOT_FOUND);
  assert.equal(kind('privacy_on', 403), ERROR_KINDS.PRIVACY);
  assert.equal(kind('charge_mode_inprogress', 409), ERROR_KINDS.IN_PROGRESS);
  assert.equal(kind('invalid_upstream', 500), ERROR_KINDS.SERVER);
  assert.equal(kind('unauthorized', 401), ERROR_KINDS.TOKEN_EXPIRED);
  assert.throws(() => checkKamereonResponse(null, 502), { kind: ERROR_KINDS.SERVER });
  assert.deepEqual(checkKamereonResponse({ data: {} }, 200), { data: {} });
});

test('Gigya errors map to what the runtime does about them', () => {
  const kind = (name) => {
    try {
      checkGigyaResponse(fixture(`gigya/${name}`), 200);
    } catch (err) {
      return err.kind;
    }
    return null;
  };
  assert.equal(kind('login.403042'), ERROR_KINDS.AUTH);
  assert.equal(kind('login.403101'), ERROR_KINDS.TFA_REQUIRED);
  assert.equal(kind('get_jwt.403005'), ERROR_KINDS.SESSION_EXPIRED);
  assert.equal(kind('get_jwt.403013'), ERROR_KINDS.SESSION_EXPIRED);
  assert.equal(kind('tfa_complete_email_verification.400006'), ERROR_KINDS.TFA_CODE);
  assert.equal(kind('login'), null);
  assert.throws(() => checkGigyaResponse({ errorCode: 403120 }, 200), {
    kind: ERROR_KINDS.BLOCKED,
  });
});

test('a network failure names the host, never the URL and its tokens', async () => {
  const { client, cloud } = setup();
  cloud.network = false;
  await assert.rejects(client.connect(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.NETWORK);
    assert.equal(err.message, 'accounts.eu1.gigya.com unreachable (ECONNREFUSED)');
    return true;
  });
});

test('the endpoint table: model entries, defaults, unknown models', () => {
  assert.equal(endpointFor('R5E1VE', 'actions/charge-stop'), null);
  assert.equal(endpointFor('R5E1VE', 'actions/charge-start').mode, 'kcm-settings');
  assert.equal(endpointFor('XBG1VE', 'actions/charge-stop').mode, 'kcm-pause-resume');
  assert.equal(endpointFor('X101VE', 'location'), null);
  assert.equal(
    endpointFor('XZZZZZ', 'battery-status').path,
    '/kca/car-adapter/v2/cars/{vin}/battery-status',
  );
  assert.equal(isKnownModel('X102VE'), true);
  assert.equal(isKnownModel('XZZZZZ'), false);
});

test('locales: the country of the Kamereon calls, other servers outside Europe', () => {
  assert.equal(localeSettings('de_AT').country, 'AT');
  assert.equal(localeSettings('en_AU').gigyaUrl, 'https://gigya-prod-au1.renaultgroup.com');
  assert.equal(localeSettings('xx_XX').locale, 'fr_FR');
});

test('the expiry of a JWT is read from its payload', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1800000000 })).toString('base64url');
  assert.equal(jwtExpiry(`h.${payload}.s`), 1800000000 * 1000);
  assert.equal(jwtExpiry('not a token'), null);
});
