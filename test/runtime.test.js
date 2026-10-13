// -----------------------------------------------------------------------------
// The runtime against the SDK's fake Gladys and the fake Renault cloud: reads
// on the container's own timer, publication, commands and their honest
// outcome, the "charge finished" trigger, quotas, outages, the sign-in and its
// two-step verification, and calm logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, T0, createWorld } from './helpers/world.js';
import { PASSWORD, TFA_CODE, USERNAME, VINS, fixture } from './helpers/fakeRenault.js';
import { MESSAGES } from '../src/messages.js';
import { createMemoryStore } from '../src/store.js';

const HOUR = 60 * MINUTE;
const ZOE_ONLY = { cars: [VINS.ZOE] };

/** The created device and one of its features, as Gladys passes them to onSetValue. */
function target(world, vin, key) {
  const device = world.gladys.devices.find((d) => d.external_id.endsWith(`:${vin}`));
  const feature = device.features.find((f) => f.external_id.endsWith(`:${key}`));
  return [device, feature];
}

const statesOf = (world, vin, key) =>
  world.fake.states.filter((s) => s.device_feature_external_id === world.feature(vin, key));

const batteryStatus = (attributes) => ({ data: { type: 'Car', id: 'x', attributes } });

test('without credentials: nothing discovered, the status says what to enter', async () => {
  const world = await createWorld({ config: { username: '', password: '' } });
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.notConfigured,
  });
  assert.equal(world.renault.calls.length, 0);
  await world.stop();
});

test('start: one sign-in, every car discovered, no state before the car is added', async () => {
  const world = await createWorld();
  assert.equal(world.renault.loginCount, 1);
  assert.equal(world.renault.jwtCount, 1, 'one JWT for every call of the start');
  assert.equal(world.fake.discoveredDevices.length, 7);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  // Gladys drops the states of a device it does not know.
  assert.equal(world.fake.states.length, 0);
  await world.createAll();
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'battery-level')), 60);
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'charging')), 1);
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'charge-mode')), 'scheduled');
  assert.equal(world.fake.lastState(world.feature(VINS.SPRING, 'charging-state')), 4);
  assert.equal(world.fake.lastState(world.feature(VINS.CAPTUR_LPG, 'locked')), 0);
  // The session is kept, never the password.
  assert.equal(world.store.data.session.loginToken, 'login-token-1');
  assert.ok(!JSON.stringify(world.store.data).includes(PASSWORD));
  await world.stop();
});

test('the timer reads the cloud by itself: states reach Gladys without any core poll', async () => {
  const world = await createWorld(ZOE_ONLY);
  await world.createAll();
  const calls = world.renault.carCalls().length;
  world.renault.data[VINS.ZOE]['battery-status'] = 'battery-status.1';

  await world.tick(14 * MINUTE);
  assert.equal(world.renault.carCalls().length, calls, 'nothing before the 15 minutes');
  await world.tick(MINUTE);
  assert.equal(world.renault.carCalls().length, calls + 4, 'one read of the four endpoints');
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'battery-level')), 50);
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'charging')), 0);
  // No poll ever came from the core.
  assert.equal(world.fake.wsMessages.filter((m) => m.type?.includes('poll')).length, 0);
  await world.stop();
});

test("the core's poll is a fallback: no cloud call, only what changed", async () => {
  const world = await createWorld(ZOE_ONLY);
  await world.createAll();
  const calls = world.renault.calls.length;
  const states = world.fake.states.length;
  const [device] = target(world, VINS.ZOE, 'battery-level');
  assert.deepEqual(await world.fake.poll(device), { success: true });
  assert.equal(world.renault.calls.length, calls);
  assert.equal(world.fake.states.length, states);
  await world.stop();
});

test('only the changes are published, and a stable value again twice a day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const world = await createWorld(ZOE_ONLY);
  await world.createAll();
  const published = world.fake.states.length;
  await world.tick(15 * MINUTE);
  assert.equal(world.fake.states.length, published, 'nothing changed, nothing sent');

  t.mock.timers.tick(12 * HOUR);
  await world.tick(12 * HOUR);
  const odometer = statesOf(world, VINS.ZOE, 'odometer');
  assert.equal(odometer.length, 2, 'the unchanged mileage sent again after 12 h');
  await world.stop();
});

test('many cars stretch the reads to stay under 60 calls an hour', async () => {
  const world = await createWorld();
  await world.createAll();
  // 21 calls a cycle for the seven cars: one read every 21 minutes.
  const calls = world.renault.carCalls().length;
  await world.tick(20 * MINUTE);
  assert.equal(world.renault.carCalls().length, calls);
  await world.tick(MINUTE);
  const cycle = world.renault.carCalls().length - calls;
  assert.equal(cycle, 21);
  await world.stop();
});

test('an endpoint the car refuses at first is dropped, a later refusal is not', async () => {
  const cloudWorld = await createWorld({ cars: [VINS.SPRING], connect: false });
  cloudWorld.renault.fail(VINS.SPRING, 'hvac-status', 'forbidden');
  await cloudWorld.gladys.connect();
  const spring = cloudWorld.device(VINS.SPRING);
  assert.ok(!spring.features.some((f) => f.external_id.endsWith(':preconditioning')));
  await cloudWorld.tick(15 * MINUTE);
  assert.equal(
    cloudWorld.renault.carCalls().filter((c) => c.endpoint === 'hvac-status').length,
    1,
    'never asked again',
  );
  await cloudWorld.stop();

  const world = await createWorld({ cars: [VINS.SPRING] });
  world.renault.fail(VINS.SPRING, 'hvac-status', 'forbidden');
  await world.tick(15 * MINUTE);
  world.renault.heal(VINS.SPRING, 'hvac-status');
  await world.tick(15 * MINUTE);
  assert.equal(world.renault.carCalls().filter((c) => c.endpoint === 'hvac-status').length, 3);
  assert.ok(
    world.device(VINS.SPRING).features.some((f) => f.external_id.endsWith(':preconditioning')),
  );
  await world.stop();
});

test('stopping a charge: accepted by the cloud, held until the car reports it', async () => {
  const world = await createWorld(ZOE_ONLY);
  await world.createAll();
  const ack = await world.fake.setValue(...target(world, VINS.ZOE, 'charging'), 0);
  assert.deepEqual(ack, { success: true });
  // The Zoe phase 2 pauses its charge through the KCM API.
  assert.deepEqual(world.renault.actions.at(-1), {
    vin: VINS.ZOE,
    endpoint: 'charge/pause-resume',
    body: { data: { type: 'ChargePauseResume', attributes: { action: 'pause' } } },
  });
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'charging')), 0);

  // Two minutes later, a follow-up read: the cloud still has the old state.
  const before = world.renault.carCalls().length;
  await world.tick(2 * MINUTE);
  assert.deepEqual(
    world.renault
      .carCalls()
      .slice(before)
      .map((c) => c.endpoint),
    ['battery-status'],
  );
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'charging')), 0, 'still held');
  assert.equal(world.runtime.vehicleView(world.device(VINS.ZOE).external_id).pending.size, 1);

  // The car reports the stop.
  world.renault.data[VINS.ZOE]['battery-status'] = batteryStatus({
    timestamp: new Date(T0 + 3 * MINUTE).toISOString(),
    batteryLevel: 61,
    batteryAutonomy: 143,
    plugStatus: 1,
    chargingStatus: 0.0,
  });
  await world.tick(4 * MINUTE);
  const view = world.runtime.vehicleView(world.device(VINS.ZOE).external_id);
  assert.equal(view.pending.size, 0);
  assert.equal(view.lastCommand.outcome, 'confirmed');
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'charging')), 0);
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'charging-state')), 1);
  // Stopped from Gladys: no "charge finished" event.
  assert.deepEqual(world.fake.sceneEvents, []);
  await world.stop();
});

test('a command the car never reports: the real state comes back after 10 minutes', async () => {
  const world = await createWorld({ cars: [VINS.R5] });
  await world.createAll();
  await world.fake.setValue(...target(world, VINS.R5, 'preconditioning'), 1);
  assert.deepEqual(world.renault.actions.at(-1).body, {
    data: { type: 'HvacStart', attributes: { action: 'start', targetTemperature: 21 } },
  });
  assert.equal(world.fake.lastState(world.feature(VINS.R5, 'preconditioning')), 1);
  for (let i = 0; i < 10; i += 1) await world.tick(MINUTE);
  assert.equal(world.fake.lastState(world.feature(VINS.R5, 'preconditioning')), 0);
  const view = world.runtime.vehicleView(world.device(VINS.R5).external_id);
  assert.equal(view.lastCommand.outcome, 'unconfirmed');
  assert.ok(world.logger.lines.info.some((l) => /hvacStart not reported by the car/.test(l)));
  await world.stop();
});

test('a newer state that contradicts the command ends the wait at once', async () => {
  const world = await createWorld({ cars: [VINS.SPRING] });
  await world.createAll();
  await world.fake.setValue(...target(world, VINS.SPRING, 'charging'), 1);
  assert.deepEqual(world.renault.actions.at(-1).body, {
    data: { type: 'ChargePauseResume', attributes: { action: 'resume' } },
  });
  world.renault.data[VINS.SPRING]['battery-status'] = batteryStatus({
    timestamp: new Date(T0 + MINUTE).toISOString(),
    batteryLevel: 50,
    plugStatus: 0,
    chargingStatus: 0.0,
  });
  await world.tick(2 * MINUTE);
  assert.equal(world.fake.lastState(world.feature(VINS.SPRING, 'charging')), 0);
  const view = world.runtime.vehicleView(world.device(VINS.SPRING).external_id);
  assert.equal(view.lastCommand.outcome, 'unconfirmed');
  await world.stop();
});

test('Renault 5: the charge starts by turning the programs off, and cannot be stopped', async () => {
  const world = await createWorld({ cars: [VINS.R5] });
  await world.createAll();
  await world.fake.setValue(...target(world, VINS.R5, 'charging'), 1);
  const post = world.renault.actions.at(-1);
  assert.equal(post.endpoint, 'ev/settings');
  assert.deepEqual(
    post.body.programs.map((p) => p.programActivationStatus),
    [false],
  );
  assert.equal(post.body.chargeModeRq, 'SCHEDULED', 'the rest of the settings sent back as read');

  const actions = world.renault.actions.length;
  const ack = await world.fake.setValue(...target(world, VINS.R5, 'charging'), 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /cannot stop a charge remotely/);
  assert.equal(world.renault.actions.length, actions, 'nothing sent');
  await world.stop();
});

test('charge mode: the Zoe phase 1 sets it with the charge-mode action', async () => {
  const world = await createWorld({ cars: [VINS.ZOE_PH1] });
  await world.createAll();
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE_PH1, 'charge-mode')), 'always');
  await world.fake.setValue(...target(world, VINS.ZOE_PH1, 'charge-mode'), 'scheduled');
  assert.deepEqual(world.renault.actions.at(-1), {
    vin: VINS.ZOE_PH1,
    endpoint: 'actions/charge-mode',
    body: { data: { type: 'ChargeMode', attributes: { action: 'schedule_mode' } } },
  });
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE_PH1, 'charge-mode')), 'scheduled');
  await world.stop();
});

test('the preconditioning temperature is kept and sent with the next start', async () => {
  const store = createMemoryStore();
  const world = await createWorld({ cars: [VINS.ZOE], store });
  await world.createAll();
  await world.fake.setValue(...target(world, VINS.ZOE, 'target-temperature'), 19.4);
  assert.equal(world.renault.actions.length, 0, 'nothing sent to the cloud');
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'target-temperature')), 19.5);
  assert.equal(store.data.vehicles[VINS.ZOE].targetTempC, 19.5);
  await world.fake.setValue(...target(world, VINS.ZOE, 'preconditioning'), 1);
  assert.equal(world.renault.actions.at(-1).body.data.attributes.targetTemperature, 19.5);
  await world.stop();
});

test('a command refused by the cloud: red ack, the known state put back', async () => {
  const world = await createWorld(ZOE_ONLY);
  await world.createAll();
  world.renault.fail(VINS.ZOE, 'actions/hvac-start', 'privacy_on');
  const before = statesOf(world, VINS.ZOE, 'preconditioning').length;
  const ack = await world.fake.setValue(...target(world, VINS.ZOE, 'preconditioning'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /privacy mode/);
  // Sent again (forced), so the dashboard toggle goes back to off.
  assert.equal(statesOf(world, VINS.ZOE, 'preconditioning').length, before + 1);
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'preconditioning')), 0);
  await world.stop();
});

test('"charge finished": fired when the car stops charging, still plugged in', async () => {
  const world = await createWorld(ZOE_ONLY);
  await world.createAll();
  world.renault.data[VINS.ZOE]['battery-status'] = batteryStatus({
    timestamp: new Date(T0 + 10 * MINUTE).toISOString(),
    batteryLevel: 100,
    batteryAutonomy: 240,
    plugStatus: 1,
    chargingStatus: 0.2,
  });
  await world.tick(15 * MINUTE);
  assert.deepEqual(world.fake.sceneEvents, [
    {
      key: 'charge_finished',
      data: { device: world.device(VINS.ZOE).external_id, battery_level: 100, range_km: 240 },
    },
  ]);
  // Unplugged afterwards: nothing more.
  world.renault.data[VINS.ZOE]['battery-status'] = 'battery-status.1';
  await world.tick(15 * MINUTE);
  assert.equal(world.fake.sceneEvents.length, 1);
  await world.stop();
});

test('a spent quota pauses the reads for 15 minutes, logged once', async () => {
  const world = await createWorld(ZOE_ONLY);
  await world.createAll();
  world.renault.fail(VINS.ZOE, 'battery-status', 'quota_limit');
  await world.tick(15 * MINUTE);
  const calls = world.renault.carCalls().length;
  await world.tick(15 * MINUTE - MINUTE);
  assert.equal(world.renault.carCalls().length, calls, 'paused');
  world.renault.heal(VINS.ZOE, 'battery-status');
  await world.tick(MINUTE);
  assert.ok(world.renault.carCalls().length > calls, 'resumed');
  assert.equal(world.logger.lines.warn.filter((l) => /quota/.test(l)).length, 1);
  assert.ok(world.logger.lines.info.some((l) => /quota is available again/.test(l)));
  await world.stop();
});

test('a cloud outage: one warning, the status follows, one line when it is over', async () => {
  // Seven cars, one outage: one line.
  const world = await createWorld();
  await world.createAll();
  world.renault.network = false;
  for (let i = 0; i < 4; i += 1) await world.tick(30 * MINUTE);
  assert.equal(world.logger.lines.warn.length, 1);
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.unreachable,
  });
  world.renault.network = true;
  await world.tick(30 * MINUTE);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    world.logger.lines.info.filter((l) => /again/.test(l)),
    ['The Renault cloud answers again'],
  );
  await world.stop();
});

test('a refused password: no new sign-in until the configuration is saved again', async () => {
  const world = await createWorld({ ...ZOE_ONLY, config: { password: 'wrong password' } });
  assert.equal(world.runtime.blocked, 'auth');
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.auth,
  });
  for (let i = 0; i < 5; i += 1) await world.tick(15 * MINUTE);
  assert.equal(world.renault.loginCount, 1);

  await world.fake.configUpdated({ username: USERNAME, password: PASSWORD, locale: 'fr_FR' });
  assert.equal(world.runtime.blocked, null);
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  await world.stop();
});

test('a saved session is reused after a restart, and replaced once revoked', async () => {
  const store = createMemoryStore();
  const first = await createWorld({ ...ZOE_ONLY, store });
  await first.stop();
  const cloud = first.renault;

  const second = await createWorld({ ...ZOE_ONLY, store, cloud });
  assert.equal(cloud.loginCount, 1, 'no password sign-in after the restart');
  await second.stop();

  cloud.revokedTokens.add('login-token-1');
  const third = await createWorld({ ...ZOE_ONLY, store, cloud });
  assert.equal(cloud.loginCount, 2, 'one password sign-in once the session was revoked');
  assert.equal(store.data.session.loginToken, 'login-token-2');
  assert.equal(third.fake.discoveredDevices.length, 1);
  await third.stop();
});

test('another account in the configuration drops the saved session', async () => {
  const store = createMemoryStore();
  const first = await createWorld({ ...ZOE_ONLY, store });
  await first.stop();
  first.renault.password = 'new password';
  const second = await createWorld({
    ...ZOE_ONLY,
    store,
    cloud: first.renault,
    config: { password: 'new password' },
  });
  assert.equal(first.renault.loginCount, 2);
  assert.equal(second.runtime.blocked, null);
  await second.stop();
});

test('two-step verification: a code by e-mail, then this installation is remembered', async () => {
  const store = createMemoryStore();
  const world = await createWorld({ ...ZOE_ONLY, tfa: true, store });
  assert.equal(world.runtime.blocked, 'tfa-required');
  assert.deepEqual(world.fake.connectionStatus.message, MESSAGES['tfa-required']);
  assert.deepEqual(world.fake.discoveredDevices, []);

  // Entered before any code was sent.
  let ack = await world.fake.action('verify_code', { code: TFA_CODE });
  assert.deepEqual(ack, { success: false, error: MESSAGES.tfaSendFirst });

  ack = await world.fake.action('send_verification_code', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /Code sent to e\*\*\*@example\.com/);
  assert.equal(world.renault.codesSent, 1);

  ack = await world.fake.action('verify_code', { code: 'abc' });
  assert.deepEqual(ack, { success: false, error: MESSAGES.tfaCodeFormat });
  ack = await world.fake.action('verify_code', { code: '000000' });
  assert.deepEqual(ack, { success: false, error: MESSAGES.tfaWrongCode });
  ack = await world.fake.action('verify_code', { code: ` ${TFA_CODE} ` });
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /Verified and connected: 1 vehicle/);
  assert.equal(world.runtime.blocked, null);
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.deepEqual(store.data.session.deviceIds, { gmid: 'gmid-1', ucid: 'ucid-1' });
  await world.stop();

  // A new sign-in from this installation is not asked for a code again.
  store.data.session.loginToken = null;
  const again = await createWorld({ ...ZOE_ONLY, store, cloud: world.renault });
  assert.equal(again.runtime.blocked, null);
  assert.equal(world.renault.codesSent, 1);
  await again.stop();
});

test('the connection test lists the cars, or says in red what is wrong', async () => {
  const world = await createWorld({ cars: [VINS.ZOE, VINS.SPRING] });
  const ack = await world.fake.action('test_connection', {});
  assert.deepEqual(ack.data.message, {
    en: 'Connected: 2 vehicle(s) (Renault Zoe (XX-001-XX), Dacia Spring (XX-003-XX)).',
    fr: 'Connecté : 2 véhicule(s) (Renault Zoe (XX-001-XX), Dacia Spring (XX-003-XX)).',
    de: 'Verbunden: 2 Fahrzeug(e) (Renault Zoe (XX-001-XX), Dacia Spring (XX-003-XX)).',
    es: 'Conectado: 2 vehículo(s) (Renault Zoe (XX-001-XX), Dacia Spring (XX-003-XX)).',
  });
  await world.stop();

  const refused = await createWorld({ config: { password: 'wrong password' } });
  const failed = await refused.fake.action('test_connection', {});
  assert.deepEqual(failed, { success: false, error: MESSAGES.auth });
  await refused.stop();

  const empty = await createWorld({ config: { username: '', password: '' } });
  assert.deepEqual(await empty.fake.action('test_connection', {}), {
    success: false,
    error: MESSAGES.notSaved,
  });
  await empty.stop();
});

test('an account id that holds no car: nothing discovered, the status says so', async () => {
  const world = await createWorld({ config: { account_id: 'account-id-9' } });
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.accountNotFound,
  });
  await world.stop();
  const kept = await createWorld({ config: { account_id: 'account-id-1' } });
  assert.equal(kept.fake.discoveredDevices.length, 7);
  await kept.stop();
});

test('turning the GPS on and off: the position is read, then forgotten', async () => {
  const world = await createWorld(ZOE_ONLY);
  await world.createAll();
  await world.fake.configUpdated({ username: USERNAME, password: PASSWORD, gps: true });
  assert.ok(world.device(VINS.ZOE).features.some((f) => f.external_id.endsWith(':position')));
  // The user updates the device to add the new feature.
  await world.fake.deviceUpdated(world.device(VINS.ZOE));
  assert.equal(world.fake.lastState(world.feature(VINS.ZOE, 'position')), '48.12346, 11.12346');
  await world.fake.configUpdated({ username: USERNAME, password: PASSWORD, gps: false });
  assert.ok(!world.device(VINS.ZOE).features.some((f) => f.external_id.endsWith(':position')));
  const view = world.runtime.vehicleView(world.device(VINS.ZOE).external_id);
  assert.equal(view.snapshot.latitude, undefined);
  await world.stop();
});

test('reconnected to Gladys: every state is sent again', async () => {
  const world = await createWorld(ZOE_ONLY);
  await world.createAll();
  const count = statesOf(world, VINS.ZOE, 'battery-level').length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  assert.equal(statesOf(world, VINS.ZOE, 'battery-level').length, count + 1);
  await world.stop();
});

test('a normal cycle writes nothing at info level, nor above', async () => {
  const world = await createWorld();
  await world.createAll();
  const lines = world.logger.lines;
  const before = { info: lines.info.length, warn: lines.warn.length, error: lines.error.length };
  for (let i = 0; i < 6; i += 1) await world.tick(30 * MINUTE);
  world.renault.data[VINS.ZOE]['battery-status'] = 'battery-status.1';
  await world.tick(30 * MINUTE);
  assert.deepEqual(
    { info: lines.info.length, warn: lines.warn.length, error: lines.error.length },
    before,
  );
  assert.ok(lines.debug.length > 0, 'the details stay at debug level');
  await world.stop();
});

test('no secret of the configuration or of the session ever reaches the logs', async () => {
  const world = await createWorld({ tfa: true, config: { gps: true } });
  await world.fake.action('send_verification_code', {});
  await world.fake.action('verify_code', { code: '000000' });
  await world.fake.action('verify_code', { code: TFA_CODE });
  await world.createAll();
  await world.fake.action('test_connection', {});
  world.renault.network = false;
  await world.tick(30 * MINUTE);
  world.renault.network = true;
  await world.tick(30 * MINUTE);
  await world.fake.setValue(...target(world, VINS.ZOE, 'charging'), 0);
  const text = world.logger.all().join('\n');
  for (const secret of [
    PASSWORD,
    USERNAME,
    'login-token',
    'eyJ',
    'sample-reg-token',
    'sample-gigya-assertion',
    'sample-phv-token',
    TFA_CODE,
    'gmid-1',
    'person-id-1',
    VINS.ZOE,
    'XX-001-XX',
    '48.12346',
    '3_VgdkgtIRH3AdHvJm',
  ]) {
    assert.ok(!text.includes(secret), `the logs contain ${secret}`);
  }
  await world.stop();
});

test('the fixtures are those the tests think they are', () => {
  assert.equal(fixture('kamereon/data/battery-status.2').data.attributes.chargingStatus, 1);
});
