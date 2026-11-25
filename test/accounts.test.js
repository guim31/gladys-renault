import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T0, createWorld } from './helpers/world.js';
import {
  PASSWORD,
  TFA_CODE,
  USERNAME,
  VINS,
  createFakeRenault,
  fixture,
} from './helpers/fakeRenault.js';
import { accountConfigs, normalizeConfig } from '../src/config.js';
import { prefixed } from '../src/accounts.js';
import { MESSAGES } from '../src/messages.js';
import { createMemoryStore } from '../src/store.js';

const OTHER = 'partner@example.com';

/** Account 1: Zoe + R5. Account 2: Austral + the same Zoe (a shared car). */
function twoAccounts({ tfa = false, password = PASSWORD } = {}) {
  const all = fixture('kamereon/vehicles');
  const only = (vins) => ({
    ...all,
    vehicleLinks: all.vehicleLinks.filter((link) => vins.includes(link.vin)),
  });
  const now = () => T0;
  const partner = createFakeRenault({
    now,
    tfa,
    username: OTHER,
    vehicles: only([VINS.AUSTRAL, VINS.ZOE]),
  });
  return {
    partner,
    options: {
      cars: [VINS.ZOE, VINS.R5],
      others: { [OTHER]: partner },
      config: { username_2: OTHER, password_2: password },
    },
  };
}

const deviceIds = (world) =>
  world.fake.discoveredDevices.map((device) => device.external_id).sort();

test('accountConfigs: account 1 always, accounts 2 and 3 when complete and distinct', () => {
  const config = normalizeConfig({
    username: USERNAME,
    password: PASSWORD,
    username_2: ` ${OTHER} `,
    password_2: 'p2\n',
    username_3: USERNAME.toUpperCase(),
    password_3: 'p3',
  });
  const { accounts, skipped } = accountConfigs(config);
  assert.deepEqual(
    accounts.map((a) => [a.slot, a.username, a.password]),
    [
      [1, USERNAME, PASSWORD],
      [2, OTHER, 'p2'],
    ],
  );
  assert.deepEqual(skipped, [3]);
  assert.deepEqual(accountConfigs(normalizeConfig({ username_2: OTHER })).skipped, [2]);
  assert.deepEqual(
    accountConfigs(normalizeConfig({})).accounts.map((a) => a.slot),
    [1],
  );
});

test('two accounts: every car once, ids from the VIN, a shared car read by account 1', async () => {
  const single = await createWorld({ cars: [VINS.ZOE, VINS.R5] });
  const { partner, options } = twoAccounts();
  const world = await createWorld(options);

  assert.deepEqual(
    deviceIds(world),
    [VINS.ZOE, VINS.R5, VINS.AUSTRAL].map((vin) => `ext:renault:vehicle:${vin}`).sort(),
  );
  // The cars of a single-account install keep their device ids.
  for (const id of deviceIds(single)) assert.ok(deviceIds(world).includes(id), id);
  assert.deepEqual(
    world.device(VINS.ZOE).features.map((f) => f.external_id),
    single.device(VINS.ZOE).features.map((f) => f.external_id),
  );

  assert.equal(partner.carCalls(VINS.ZOE).length, 0, 'the shared car is read once');
  assert.ok(partner.carCalls(VINS.AUSTRAL).length > 0);
  assert.equal(world.renault.carCalls(VINS.AUSTRAL).length, 0);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });

  // One session per account, account 1 where it always was.
  assert.ok(world.store.data.session.loginToken);
  assert.ok(world.store.data.sessions[2].loginToken);
  assert.notEqual(world.store.data.session.fingerprint, world.store.data.sessions[2].fingerprint);

  // The widget and the commands reach the car through its own account.
  await world.createAll();
  const view = world.runtime.vehicleView(`ext:renault:vehicle:${VINS.AUSTRAL}`);
  assert.equal(view.info.vin, VINS.AUSTRAL);
  const ack = await world.fake.sceneAction('refresh_vehicle', {
    device: `ext:renault:vehicle:${VINS.AUSTRAL}`,
  });
  assert.equal(ack.success, true);

  const tested = await world.fake.action('test_connection', {});
  assert.equal(tested.success, true);
  assert.match(tested.data.message.fr, /^Compte 1 : Connecté : 2 .* Compte 2 : Connecté : 2 /);
});

test('an account in trouble: its message, prefixed; the other cars still work', async () => {
  const { options } = twoAccounts({ password: 'wrong' });
  const world = await createWorld(options);
  assert.deepEqual(
    deviceIds(world),
    [VINS.ZOE, VINS.R5].map((vin) => `ext:renault:vehicle:${vin}`).sort(),
  );
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: prefixed(2, MESSAGES.auth),
  });
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /^Compte 1 : Connecté .* Compte 2 : /);

  // The address is never logged.
  assert.ok(!world.logger.all().some((line) => line.includes(OTHER)));
  assert.ok(world.logger.lines.warn.some((line) => line.startsWith('Account 2: ')));
});

test('removing account 2: its cars go, a car it shared comes back with account 1', async () => {
  const { options } = twoAccounts();
  const world = await createWorld({ ...options, cars: [VINS.R5] });
  // Account 1 lists the Zoe only later: account 2 brings it first.
  assert.ok(deviceIds(world).includes(`ext:renault:vehicle:${VINS.ZOE}`));
  world.renault.vehicles = fixture('kamereon/vehicles');
  world.renault.vehicles.vehicleLinks = world.renault.vehicles.vehicleLinks.filter((link) =>
    [VINS.ZOE, VINS.R5].includes(link.vin),
  );
  await world.fake.configUpdated({ username: USERNAME, password: PASSWORD, locale: 'fr_FR' });
  assert.deepEqual(
    deviceIds(world),
    [VINS.ZOE, VINS.R5].map((vin) => `ext:renault:vehicle:${vin}`).sort(),
  );
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('two-step verification of account 2: the code goes to the account waiting for it', async () => {
  const { partner, options } = twoAccounts({ tfa: true });
  const store = createMemoryStore();
  const world = await createWorld({ ...options, store });
  assert.equal(world.runtime.account(2).blocked, 'tfa-required');
  assert.deepEqual(world.fake.connectionStatus.message, prefixed(2, MESSAGES['tfa-required']));

  let ack = await world.fake.action('send_verification_code', {});
  assert.equal(ack.success, true);
  assert.equal(partner.codesSent, 1);
  assert.equal(world.renault.codesSent, 0);
  ack = await world.fake.action('verify_code', { code: TFA_CODE });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.ok(deviceIds(world).includes(`ext:renault:vehicle:${VINS.AUSTRAL}`));
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('an incomplete account 2 is ignored, with one warning', async () => {
  const world = await createWorld({ cars: [VINS.ZOE], config: { username_2: OTHER } });
  assert.equal(world.runtime.account(2), null);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(world.logger.lines.warn.filter((l) => l.includes('Account 2 ignored')).length, 1);
});

test('an empty account 1 next to a filled account 2: no red status from account 1', async () => {
  const { options } = twoAccounts();
  const world = await createWorld({
    ...options,
    config: { ...options.config, username: '', password: '' },
  });
  assert.ok(deviceIds(world).includes(`ext:renault:vehicle:${VINS.AUSTRAL}`));
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.match(ack.data.message.fr, /^Compte 2 : Connecté/);
});

test('a blocked account: a car it shared is read through the other account', async () => {
  const { partner, options } = twoAccounts();
  const world = await createWorld(options);
  assert.equal(partner.carCalls(VINS.ZOE).length, 0);
  // Account 1's password changes: its session is revoked, the sign-in refused.
  world.renault.password = 'changed';
  for (const token of [world.store.data.session.loginToken]) world.renault.revokedTokens.add(token);
  world.renault.validJwts.clear();
  await world.tick(16 * 60 * 1000);
  assert.equal(world.runtime.account(1).blocked, 'auth');
  await world.tick(16 * 60 * 1000);
  assert.ok(partner.carCalls(VINS.ZOE).length > 0, 'the shared car is read by account 2');
  await world.createAll();
  const ack = await world.fake.sceneAction('refresh_vehicle', {
    device: `ext:renault:vehicle:${VINS.ZOE}`,
  });
  assert.equal(ack.success, true, JSON.stringify(ack));
});
