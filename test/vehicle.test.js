// -----------------------------------------------------------------------------
// The car model: the answers of each endpoint folded into a snapshot, the
// published states, the commands, the names.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARGING_STATION_STATE as S,
  chargingStationState,
  prettyName,
  preconditioningTemperature,
  snapshotOf,
  vehicleCommand,
  vehicleInfo,
  vehicleName,
  vehicleStates,
  logLabel,
} from '../src/devices/vehicle.js';
import { fixture } from './helpers/fakeRenault.js';

const attributes = (name) => fixture(`kamereon/data/${name}`).data.attributes;

test('battery-status: charging Zoe, unplugged car, Renault 5', () => {
  assert.deepEqual(snapshotOf('battery-status', attributes('battery-status.2')), {
    batteryUpdatedAt: Date.parse('2020-01-12T21:40:16Z'),
    batteryLevel: 60,
    rangeKm: 141,
    plugged: true,
    chargingStatus: 1,
    charging: true,
    chargePowerKw: 27,
    chargeRemainingMin: 145,
    batteryTempC: 20,
  });
  const unplugged = snapshotOf('battery-status', attributes('battery-status.1'));
  assert.equal(unplugged.plugged, false);
  assert.equal(unplugged.charging, false);
  assert.equal(chargingStationState(unplugged), S.IDLE);
  const r5 = snapshotOf('battery-status', attributes('battery-status.renault_5'));
  assert.equal(r5.chargePowerKw, undefined);
  assert.equal(r5.chargeRemainingMin, 0);
});

test('the Zoe phase 1 reports its charging power in watts', () => {
  const snapshot = snapshotOf(
    'battery-status',
    { chargingInstantaneousPower: 7400, chargingStatus: 1, plugStatus: 1 },
    { modelCode: 'X101VE' },
  );
  assert.equal(snapshot.chargePowerKw, 7.4);
});

test('the charge session states of Gladys (OCPP)', () => {
  const state = (plugged, chargingStatus) =>
    chargingStationState(snapshotOf('battery-status', { plugStatus: plugged, chargingStatus }));
  assert.equal(state(1, 1.0), S.CHARGING);
  assert.equal(state(1, -1.6), S.CHARGING);
  assert.equal(state(1, 0.2), S.EV_CONNECTED);
  assert.equal(state(1, 0.1), S.EV_CONNECTED);
  assert.equal(state(1, 0.3), S.PAUSED_BY_CHARGER);
  assert.equal(state(1, -1.5), S.DISCHARGING);
  assert.equal(state(0, 0.0), S.IDLE);
  // Plug error / unknown: nothing published.
  assert.equal(state(-1, -1.1), null);
  assert.equal(state(-2147483648, undefined), null);
});

test('hvac-status, cockpit, lock-status, charge mode, location', () => {
  assert.deepEqual(snapshotOf('hvac-status', attributes('hvac-status.zoe')), {
    hvacOn: false,
    outsideTempC: 8,
    insideTempC: undefined,
    hvacUpdatedAt: undefined,
  });
  assert.equal(snapshotOf('hvac-status', attributes('hvac-status.zoe_50')).hvacOn, true);
  assert.equal(snapshotOf('hvac-status', attributes('hvac-status.renault_5')).insideTempC, 15);
  assert.deepEqual(snapshotOf('cockpit', attributes('cockpit.captur_ii')), {
    odometerKm: 5566.78,
    fuelRangeKm: 35,
  });
  assert.deepEqual(snapshotOf('lock-status', attributes('lock-status.1')), {
    locked: true,
    doorOpen: false,
    lockUpdatedAt: Date.parse('2022-02-02T13:51:13Z'),
  });
  assert.equal(snapshotOf('lock-status', { hatchStatus: 'open' }).doorOpen, true);
  assert.equal(snapshotOf('charge-mode', { chargeMode: 'always_charging' }).chargeMode, 'always');
  assert.equal(snapshotOf('charge-mode', { chargeMode: 'schedule_mode' }).chargeMode, 'scheduled');
  assert.equal(snapshotOf('charging-settings', { mode: 'scheduled' }).chargeMode, 'scheduled');
  assert.equal(snapshotOf('charging-settings', { mode: 'delayed' }).chargeMode, undefined);
  const location = snapshotOf('location', attributes('location.renault_5_2'));
  assert.equal(location.latitude, 48.8584);
  assert.equal(snapshotOf('location', { gpsLatitude: 200, gpsLongitude: 2 }).latitude, undefined);
});

test('states: rounded, stale charge estimates zeroed, texts for the select and position', () => {
  const states = vehicleStates({
    batteryLevel: 60.4,
    rangeKm: 141.6,
    plugged: true,
    charging: false,
    chargingStatus: 0.2,
    chargePowerKw: 7.36,
    chargeRemainingMin: 30,
    chargeMode: 'scheduled',
    targetTempC: 21,
    locked: true,
    latitude: 48.858412,
    longitude: 2.294513,
  });
  const byKey = Object.fromEntries(states.map((s) => [s.key, s.value ?? s.text]));
  assert.deepEqual(byKey, {
    'battery-level': 60,
    range: 142,
    'charging-state': S.EV_CONNECTED,
    plugged: 1,
    charging: 0,
    'charge-power': 0,
    'charge-time-remaining': 0,
    'target-temperature': 21,
    locked: 1,
    'charge-mode': 'scheduled',
    position: '48.85841, 2.29451',
  });
});

test('commands: charge, preconditioning at the saved temperature, setpoint, mode', () => {
  assert.deepEqual(vehicleCommand('charging', 1), {
    order: 'chargeStart',
    expect: { charging: true },
  });
  assert.deepEqual(vehicleCommand('preconditioning', 1, { targetTempC: 19.5 }), {
    order: 'hvacStart',
    args: 19.5,
    expect: { hvacOn: true },
  });
  assert.deepEqual(vehicleCommand('target-temperature', 30), {
    local: true,
    expect: { targetTempC: 25 },
  });
  assert.equal(vehicleCommand('charge-mode', 'always').args, 'always');
  assert.throws(() => vehicleCommand('charge-mode', 'turbo'));
  assert.equal(vehicleCommand('battery-level', 1), null);
  assert.equal(preconditioningTemperature('20,3'), 20.5);
  assert.equal(preconditioningTemperature(3), 15);
  assert.throws(() => preconditioningTemperature(''));
});

test('names: brand and model as people say them, the plate when the cloud gives it', () => {
  assert.equal(prettyName('MEGANE E-TECH'), 'Megane E-Tech');
  assert.equal(prettyName('CAPTUR II'), 'Captur II');
  assert.equal(prettyName('RENAULT 5'), 'Renault 5');
  const r5 = vehicleInfo(
    {
      vin: 'VF1AAAA0000000000',
      vehicleDetails: {
        brand: { label: 'RENAULT' },
        model: { code: 'R5E1VE', label: 'RENAULT 5' },
        engineEnergyType: 'ELEC',
        registrationNumber: 'XX-002-XX',
      },
    },
    'account-id-1',
  );
  assert.equal(vehicleName(r5), 'Renault 5 (XX-002-XX)');
  assert.equal(logLabel(r5), 'Renault 5 …0000');
  assert.equal(r5.electric, true);
  assert.equal(r5.fuel, false);
  const spring = vehicleInfo(
    {
      vin: 'UU1AAAA555777999',
      vehicleDetails: {
        brand: { label: 'DACIA' },
        model: { label: 'SPRING' },
        energy: { code: 'ELEC' },
      },
    },
    'a',
  );
  assert.equal(vehicleName(spring), 'Dacia Spring');
  const phev = vehicleInfo(
    { vin: 'V', vehicleDetails: { engineEnergyType: 'PHEV', energy: { code: 'ESS' } } },
    'a',
  );
  assert.deepEqual([phev.electric, phev.fuel], [true, true]);
});
