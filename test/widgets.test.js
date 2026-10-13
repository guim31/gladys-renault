// -----------------------------------------------------------------------------
// The vehicle widget and the scene actions, through the fake Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MINUTE, createWorld } from './helpers/world.js';
import { VINS } from './helpers/fakeRenault.js';
import { MESSAGES } from '../src/messages.js';

const content = async (world, vin, language = 'fr') => {
  const ack = await world.fake.widgetGet('vehicle', {
    settings: { device: world.device(vin).external_id },
    language,
    units: 'metric',
  });
  assert.equal(ack.success, true);
  return ack.data.content;
};
const buttons = (c) =>
  c.components.filter((x) => x.type === 'button').map((b) => b.action?.key ?? 'link');

test('the widget fits the core budget for every car, before and after creation', async () => {
  const world = await createWorld({ config: { gps: true } });
  for (const phase of ['before', 'after']) {
    if (phase === 'after') await world.createAll();
    for (const device of world.fake.discoveredDevices) {
      const vin = device.external_id.split(':').pop();
      const c = await content(world, vin);
      assert.deepEqual(validateWidgetContent(c), [], `${device.name} (${phase})`);
      // Every bound tile points to a feature of the device.
      const ids = new Set(device.features.map((f) => f.external_id));
      for (const tile of c.components.filter((x) => x.device_feature)) {
        assert.ok(ids.has(tile.device_feature), `${device.name}: ${tile.device_feature}`);
      }
      if (
        phase === 'after' &&
        device.features.some((f) => f.external_id.endsWith(':battery-level'))
      ) {
        assert.ok(c.components[0].device_feature, `${device.name}: tiles bound once created`);
      }
    }
  }
  await world.stop();
});

test('the buttons follow the car: what a tap does now', async () => {
  const world = await createWorld();
  // Charging Zoe: stop the charge, switch to immediate charging.
  assert.deepEqual(buttons(await content(world, VINS.ZOE)), [
    'preconditioning_start',
    'charge_stop',
    'mode_always',
    'refresh',
  ]);
  // Unplugged Spring: no charge button.
  assert.deepEqual(buttons(await content(world, VINS.SPRING)), [
    'preconditioning_start',
    'refresh',
  ]);
  // Preconditioning on (Zoe phase 1): stop it.
  assert.equal(buttons(await content(world, VINS.ZOE_PH1))[0], 'preconditioning_stop');
  // Austral: nothing to command.
  assert.deepEqual(buttons(await content(world, VINS.AUSTRAL)), ['refresh']);
  await world.stop();
});

test('a widget command: an honest toast, then "requested" until the car says so', async () => {
  const world = await createWorld({ cars: [VINS.ZOE] });
  const settings = { device: world.device(VINS.ZOE).external_id };
  const ack = await world.fake.widgetAction('vehicle', 'charge_stop', {}, { settings });
  assert.deepEqual(ack, { success: true, data: { message: MESSAGES.commandSent } });
  const c = await content(world, VINS.ZOE, 'en');
  const charge = c.components.find((x) => x.type === 'status').items[0];
  assert.equal(charge.value.en, 'Requested, waiting for the car');
  assert.ok(world.fake.widgetRefreshes.includes('vehicle'));

  // Ten minutes without news: the widget says the car did not report it.
  for (let i = 0; i < 10; i += 1) await world.tick(MINUTE);
  const after = await content(world, VINS.ZOE, 'en');
  const rows = after.components
    .find((x) => x.type === 'status')
    .items.map((i) => i.value.en ?? i.value);
  assert.ok(rows.includes('Not reported by the car'));
  await world.stop();
});

test('a refused widget command fails in red, in the language last seen', async () => {
  const world = await createWorld({ cars: [VINS.R5] });
  await content(world, VINS.R5, 'de');
  world.renault.data[VINS.R5]['battery-status'] = {
    data: { attributes: { plugStatus: 1, chargingStatus: 1 } },
  };
  await world.tick(20 * MINUTE);
  const settings = { device: world.device(VINS.R5).external_id };
  const ack = await world.fake.widgetAction('vehicle', 'charge_stop', {}, { settings });
  assert.equal(ack.success, false);
  assert.equal(ack.error, MESSAGES.chargeStopUnsupported.de);
  await world.stop();
});

test('the widget without a vehicle asks for one', async () => {
  const world = await createWorld({ cars: [VINS.ZOE] });
  const ack = await world.fake.widgetGet('vehicle', { settings: {}, language: 'en' });
  assert.match(ack.data.content.components[0].text.en, /Choose a vehicle/);
  const other = await world.fake.widgetGet('vehicle', {
    settings: { device: 'ext:other:device' },
    language: 'en',
  });
  assert.match(other.data.content.components[0].text.en, /not a vehicle/);
  await world.stop();
});

test('scene action refresh_vehicle: fresh values for the next actions', async () => {
  const world = await createWorld({ cars: [VINS.ZOE] });
  const device = world.device(VINS.ZOE).external_id;
  world.advance(2 * MINUTE);
  const calls = world.renault.carCalls().length;
  const ack = await world.fake.sceneAction('refresh_vehicle', { device });
  assert.deepEqual(ack.data.outputs, {
    battery_level: 60,
    range_km: 141,
    plugged: true,
    charging: true,
  });
  assert.equal(world.renault.carCalls().length, calls + 4);
  // Asked again within the minute: the read just made is reused.
  await world.fake.sceneAction('refresh_vehicle', { device });
  assert.equal(world.renault.carCalls().length, calls + 4);
  await world.stop();
});

test('scene action start_preconditioning: its own temperature, the setpoint kept', async () => {
  const world = await createWorld({ cars: [VINS.ZOE] });
  const device = world.device(VINS.ZOE).external_id;
  const ack = await world.fake.sceneAction('start_preconditioning', { device, temperature: 23 });
  assert.deepEqual(ack.data.outputs, { temperature: 23 });
  assert.equal(world.renault.actions.at(-1).body.data.attributes.targetTemperature, 23);
  const view = world.runtime.vehicleView(device);
  assert.equal(view.snapshot.targetTempC, 21);
  const noTemp = await world.fake.sceneAction('start_preconditioning', { device });
  assert.deepEqual(noTemp.data.outputs, { temperature: 21 });
  const wrong = await world.fake.sceneAction('start_preconditioning', { device: 'ext:x' });
  assert.equal(wrong.success, false);
  await world.stop();
});
