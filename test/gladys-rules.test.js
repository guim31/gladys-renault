// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: seven cars of the renault-api fixtures (Zoe phase 1 and 2,
// Renault 5, Dacia Spring, Captur II plug-in hybrid and LPG, Austral hybrid),
// with and without the GPS position, in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'default configuration (French names)', config: {} },
  { label: 'GPS on, English names', config: { gps: true, language: 'en' } },
  { label: 'GPS on, German names', config: { gps: true, language: 'de' } },
  { label: 'GPS on, Spanish names', config: { gps: true, language: 'es' } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({ config: scenario.config });
    try {
      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, 7, `expected the seven fixture cars, got ${devices.length}`);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: unit ${feature.unit} unknown to ${feature.category}`,
              );
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }

      // The user adds them all: Gladys accepts every state (the fake refuses
      // what the core refuses).
      await world.createAll();
      const refused = world.fake.requests.filter((r) => r.path === '/state' && r.status !== 200);
      assert.deepEqual(refused, []);
      assert.ok(world.fake.states.length > 40);
    } finally {
      await world.stop();
    }
  });
}

test('the GPS position is a feature only once the user turned it on', async () => {
  const off = await createWorld();
  const on = await createWorld({ config: { gps: true } });
  try {
    const has = (world) =>
      world.fake.discoveredDevices.some((d) =>
        d.features.some((f) => f.external_id.endsWith(':position')),
      );
    assert.equal(has(off), false);
    assert.equal(has(on), true);
    // Without GPS, the location endpoint is never called.
    assert.equal(off.renault.calls.filter((c) => c.endpoint === 'location').length, 0);
  } finally {
    await off.stop();
    await on.stop();
  }
});
