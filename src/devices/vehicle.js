// -----------------------------------------------------------------------------
// Device type: RENAULT / DACIA VEHICLE.
//
// One Gladys device per car, keyed on the VIN (it never changes, unlike the
// registration or the account the car is linked to).
//
// The cloud gives the state in several endpoints (battery-status, cockpit,
// hvac-status...), each read on its own. Their answers are folded into one
// canonical snapshot (km, °C, minutes, kW); the published states are derived
// from it. The field meanings are those of hacf-fr/renault-api (MIT,
// kamereon/models.py and enums.py) and of the Home Assistant integration.
//
// Which features a car gets depends on its model (the endpoints it offers, see
// src/renault/endpoints.js) and, for the optional values, on what its first
// answers contained: a Zoe phase 1 has no outside temperature, a Renault 5 no
// charging power. A value seen once keeps its feature (src/store.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { CHARGE_MODE_LABELS, t } from '../i18n.js';

export const VEHICLE_DEVICE_TYPE = 'vehicle';

// Feature keys: part of the external_id, frozen once published.
export const VEHICLE_FEATURES = {
  BATTERY_LEVEL: 'battery-level',
  RANGE: 'range',
  CHARGING_STATE: 'charging-state',
  PLUGGED: 'plugged',
  CHARGING: 'charging',
  CHARGE_POWER: 'charge-power',
  CHARGE_TIME_REMAINING: 'charge-time-remaining',
  BATTERY_TEMPERATURE: 'battery-temperature',
  CHARGE_MODE: 'charge-mode',
  PRECONDITIONING: 'preconditioning',
  TARGET_TEMPERATURE: 'target-temperature',
  OUTSIDE_TEMPERATURE: 'outside-temperature',
  INSIDE_TEMPERATURE: 'inside-temperature',
  ODOMETER: 'odometer',
  FUEL_RANGE: 'fuel-range',
  LOCKED: 'locked',
  DOOR_OPEN: 'door-open',
  POSITION: 'position',
};

// Charge session states, the Gladys `charging-station/charging-state` enum
// (OCPP values, translated by the Gladys front).
export const CHARGING_STATION_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
  DISCHARGING: 5,
};

// battery-status `chargingStatus` (renault-api ChargeState).
export const CHARGE_STATUS = {
  NOT_IN_CHARGE: 0,
  WAITING_FOR_A_PLANNED_CHARGE: 0.1,
  CHARGE_ENDED: 0.2,
  WAITING_FOR_CURRENT_CHARGE: 0.3,
  ENERGY_FLAP_OPENED: 0.4,
  CHARGE_IN_PROGRESS: 1,
  CHARGE_ERROR: -1,
  UNAVAILABLE: -1.1,
  V2G_CHARGING_WAITING: -1.3,
  V2L_CONNECTED: -1.4,
  V2G_DISCHARGING: -1.5,
  V2G_CHARGING_NORMAL: -1.6,
};

export const CHARGE_MODES = ['always', 'scheduled'];

// Preconditioning temperatures the app accepts (Home Assistant: 15-25 °C by 0.5).
export const PRECONDITIONING_MIN_C = 15;
export const PRECONDITIONING_MAX_C = 25;
export const DEFAULT_PRECONDITIONING_C = 21;

// Models that report the charging power in watts (renault-api VEHICLE_SPECIFICATIONS).
const POWER_IN_WATTS_MODELS = new Set(['X101VE']);

export function vehicleIds(gladys, vin) {
  return gladys.externalIds(VEHICLE_DEVICE_TYPE, vin);
}

// --- The car ------------------------------------------------------------------

const ELECTRIC_ENERGIES = new Set(['ELEC', 'ELECX', 'PHEV']);
const FUEL_ENERGIES = new Set(['OTHER', 'PHEV', 'HEV']);

/** "MEGANE E-TECH" → "Megane E-Tech", "CAPTUR II" → "Captur II". */
export function prettyName(label) {
  return String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\p{L}\d]+/gu, (word) =>
      /^[ivx]+$/.test(word) && word.length <= 4
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    );
}

/**
 * What the integration needs of a vehicle link of the account.
 * @param {object} link entry of `vehicleLinks` ({ vin, vehicleDetails })
 * @param {string} accountId
 */
export function vehicleInfo(link, accountId) {
  const details = link.vehicleDetails ?? {};
  const energy = details.engineEnergyType || details.energy?.code || '';
  const brand = prettyName(details.brand?.label || link.brand || 'Renault');
  const model = prettyName(details.model?.label || '');
  return {
    accountId,
    vin: String(link.vin),
    modelCode: details.model?.code || undefined,
    brand,
    model: model || brand,
    registration: String(details.registrationNumber ?? '').trim() || null,
    electric: ELECTRIC_ENERGIES.has(energy),
    fuel: FUEL_ENERGIES.has(energy),
  };
}

/** "Renault Zoe", "Renault 5" (not "Renault Renault 5"), "Dacia Spring". */
function modelName(info) {
  return info.model.toLowerCase().startsWith(info.brand.toLowerCase())
    ? info.model
    : `${info.brand} ${info.model}`;
}

/** "Renault Zoe (AB-123-CD)", "Renault 5", "Dacia Spring". */
export function vehicleName(info) {
  return info.registration ? `${modelName(info)} (${info.registration})` : modelName(info);
}

/** A short label for the logs: the model and the end of the VIN, never the plate. */
export const logLabel = (info) => `${modelName(info)} …${info.vin.slice(-4)}`;

// --- Reading -------------------------------------------------------------------

const num = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const time = (value) => {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : undefined;
};
const near = (a, b) => a !== undefined && Math.abs(a - b) < 0.001;

function onOff(value, on, off) {
  const text = String(value ?? '').toLowerCase();
  if (text === on) return true;
  if (text === off) return false;
  return undefined;
}

/** Charge mode of `charge-mode` (always_charging / always / schedule_mode / scheduled). */
export function chargeModeOf(value) {
  const text = String(value ?? '').toLowerCase();
  if (text === 'always' || text === 'always_charging') return 'always';
  if (text === 'scheduled' || text === 'schedule_mode') return 'scheduled';
  return undefined;
}

/**
 * The snapshot fields of one endpoint's answer. Every field of the endpoint is
 * set (undefined when absent), so a value the car stopped sending is cleared.
 * @param {string} endpoint e.g. "battery-status"
 * @param {object} attributes the `data.attributes` of the answer
 * @param {{ modelCode?: string }} info
 */
export function snapshotOf(endpoint, attributes = {}, info = {}) {
  const a = attributes ?? {};
  switch (endpoint) {
    case 'battery-status': {
      const status = num(a.chargingStatus);
      const plug = num(a.plugStatus);
      const power = num(a.chargingInstantaneousPower);
      return {
        batteryUpdatedAt: time(a.timestamp),
        batteryLevel: num(a.batteryLevel),
        rangeKm: num(a.batteryAutonomy),
        // -1 (plug error) and -2147483648 (unknown) say nothing.
        plugged: plug === 1 ? true : plug === 0 ? false : undefined,
        chargingStatus: status,
        charging:
          status === undefined
            ? undefined
            : near(status, CHARGE_STATUS.CHARGE_IN_PROGRESS) ||
              near(status, CHARGE_STATUS.V2G_CHARGING_NORMAL),
        chargePowerKw:
          power !== undefined && POWER_IN_WATTS_MODELS.has(info.modelCode) ? power / 1000 : power,
        chargeRemainingMin: num(a.chargingRemainingTime),
        batteryTempC: num(a.batteryTemperature),
      };
    }
    case 'cockpit':
      return { odometerKm: num(a.totalMileage), fuelRangeKm: num(a.fuelAutonomy) };
    case 'hvac-status':
      return {
        hvacOn: onOff(a.hvacStatus, 'on', 'off'),
        outsideTempC: num(a.externalTemperature),
        insideTempC: num(a.internalTemperature),
        hvacUpdatedAt: time(a.lastUpdateTime),
      };
    case 'charge-mode':
      return { chargeMode: chargeModeOf(a.chargeMode) };
    case 'charging-settings':
      return { chargeMode: chargeModeOf(a.mode) };
    case 'lock-status': {
      const openings = [
        a.doorStatusDriver,
        a.doorStatusPassenger,
        a.doorStatusRearLeft,
        a.doorStatusRearRight,
        a.hatchStatus,
      ]
        .map((value) => onOff(value, 'open', 'closed'))
        .filter((value) => value !== undefined);
      return {
        locked: onOff(a.lockStatus, 'locked', 'unlocked'),
        doorOpen: openings.length === 0 ? undefined : openings.some(Boolean),
        lockUpdatedAt: time(a.lastUpdateTime),
      };
    }
    case 'location': {
      const latitude = num(a.gpsLatitude);
      const longitude = num(a.gpsLongitude);
      const valid =
        latitude !== undefined &&
        longitude !== undefined &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180;
      return {
        latitude: valid ? latitude : undefined,
        longitude: valid ? longitude : undefined,
        locationUpdatedAt: time(a.lastUpdateTime),
      };
    }
    default:
      return {};
  }
}

// Snapshot fields whose presence decides an optional feature.
export const OPTIONAL_FIELDS = [
  'chargePowerKw',
  'chargeRemainingMin',
  'batteryTempC',
  'outsideTempC',
  'insideTempC',
  'fuelRangeKm',
];

/** Charge session state of the snapshot (null when unknown). */
export function chargingStationState(snapshot) {
  const status = snapshot.chargingStatus;
  if (snapshot.charging === true) return CHARGING_STATION_STATE.CHARGING;
  if (near(status, CHARGE_STATUS.V2L_CONNECTED) || near(status, CHARGE_STATUS.V2G_DISCHARGING)) {
    return CHARGING_STATION_STATE.DISCHARGING;
  }
  if (snapshot.plugged === false) return CHARGING_STATION_STATE.IDLE;
  if (snapshot.plugged === true) {
    // Plugged, the charger gives no current yet.
    if (near(status, CHARGE_STATUS.WAITING_FOR_CURRENT_CHARGE)) {
      return CHARGING_STATION_STATE.PAUSED_BY_CHARGER;
    }
    return CHARGING_STATION_STATE.EV_CONNECTED;
  }
  return null;
}

// --- Publishing ----------------------------------------------------------------

/**
 * The discovery payload of one car.
 * @param {object} gladys SDK instance
 * @param {object} info vehicleInfo()
 * @param {object} caps what the car offers (src/renault.js capabilities())
 * @param {{ language: string }} options
 */
export function buildVehicleDevice(gladys, info, caps, { language }) {
  const ids = vehicleIds(gladys, info.vin);
  const seen = caps.seen ?? new Set();
  const feature = (key, name, category, type, extra) => ({
    name: t(language, name),
    external_id: ids.feature(key),
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 1,
    ...extra,
  });
  // A command whose effect the next reads report.
  const command = { read_only: false, has_feedback: true };
  const features = [];
  const F = VEHICLE_FEATURES;

  if (caps.battery) {
    features.push(
      feature(
        F.BATTERY_LEVEL,
        'batteryLevel',
        CATEGORIES.ELECTRICAL_VEHICLE_BATTERY,
        TYPES.ELECTRICAL_VEHICLE_BATTERY.BATTERY_LEVEL,
        { unit: UNITS.PERCENT, max: 100 },
      ),
      feature(
        F.RANGE,
        'range',
        CATEGORIES.ELECTRICAL_VEHICLE_BATTERY,
        TYPES.ELECTRICAL_VEHICLE_BATTERY.BATTERY_RANGE_ESTIMATE,
        { unit: UNITS.KM, max: 1000 },
      ),
      feature(
        F.CHARGING_STATE,
        'chargingState',
        CATEGORIES.CHARGING_STATION,
        TYPES.CHARGING_STATION.CHARGING_STATE,
        { max: 5 },
      ),
      feature(
        F.PLUGGED,
        'plugged',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.PLUGGED,
      ),
      feature(
        F.CHARGING,
        'charging',
        CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
        TYPES.ELECTRICAL_VEHICLE_CHARGE.CHARGE_ON,
        caps.chargeStart ? command : {},
      ),
    );
    if (seen.has('chargePowerKw')) {
      features.push(
        feature(
          F.CHARGE_POWER,
          'chargePower',
          CATEGORIES.ELECTRICAL_VEHICLE_CHARGE,
          TYPES.ELECTRICAL_VEHICLE_CHARGE.CHARGE_POWER,
          { unit: UNITS.KILOWATT, max: 400 },
        ),
      );
    }
    if (seen.has('chargeRemainingMin')) {
      features.push(
        feature(
          F.CHARGE_TIME_REMAINING,
          'chargeTimeRemaining',
          CATEGORIES.DURATION,
          TYPES.DURATION.INTEGER,
          {
            unit: UNITS.MINUTES,
            max: 3000,
          },
        ),
      );
    }
    if (seen.has('batteryTempC')) {
      features.push(
        feature(
          F.BATTERY_TEMPERATURE,
          'batteryTemperature',
          CATEGORIES.ELECTRICAL_VEHICLE_BATTERY,
          TYPES.ELECTRICAL_VEHICLE_BATTERY.BATTERY_TEMPERATURE,
          { unit: UNITS.CELSIUS, min: -40, max: 80 },
        ),
      );
    }
  }
  if (caps.chargeMode) {
    const labels = CHARGE_MODE_LABELS[language] ?? CHARGE_MODE_LABELS.en;
    features.push(
      feature(F.CHARGE_MODE, 'chargeMode', CATEGORIES.TEXT, TYPES.TEXT.SELECT, {
        ...command,
        // A setting, not history worth keeping (a text state has none anyway).
        keep_history: false,
        max: 0,
        supported_options: CHARGE_MODES.map((value, index) => ({
          value,
          label: labels[value],
          sort_order: index,
        })),
      }),
    );
  }
  if (caps.hvac) {
    features.push(
      feature(
        F.PRECONDITIONING,
        'preconditioning',
        CATEGORIES.ELECTRICAL_VEHICLE_CLIMATE,
        TYPES.ELECTRICAL_VEHICLE_CLIMATE.CLIMATE_ON,
        caps.hvacStart ? command : {},
      ),
    );
    if (caps.hvacStart) {
      features.push(
        feature(
          F.TARGET_TEMPERATURE,
          'targetTemperature',
          CATEGORIES.ELECTRICAL_VEHICLE_CLIMATE,
          TYPES.ELECTRICAL_VEHICLE_CLIMATE.TARGET_TEMPERATURE,
          {
            ...command,
            // A setpoint kept by the integration, not history worth keeping.
            keep_history: false,
            unit: UNITS.CELSIUS,
            min: PRECONDITIONING_MIN_C,
            max: PRECONDITIONING_MAX_C,
          },
        ),
      );
    }
    if (seen.has('outsideTempC')) {
      features.push(
        feature(
          F.OUTSIDE_TEMPERATURE,
          'outsideTemperature',
          CATEGORIES.TEMPERATURE_SENSOR,
          TYPES.SENSOR.DECIMAL,
          { unit: UNITS.CELSIUS, min: -40, max: 60 },
        ),
      );
    }
    if (seen.has('insideTempC')) {
      features.push(
        feature(
          F.INSIDE_TEMPERATURE,
          'insideTemperature',
          CATEGORIES.ELECTRICAL_VEHICLE_CLIMATE,
          TYPES.ELECTRICAL_VEHICLE_CLIMATE.INDOOR_TEMPERATURE,
          { unit: UNITS.CELSIUS, min: -40, max: 80 },
        ),
      );
    }
  }
  if (caps.cockpit) {
    features.push(
      feature(
        F.ODOMETER,
        'odometer',
        CATEGORIES.ELECTRICAL_VEHICLE_STATE,
        TYPES.ELECTRICAL_VEHICLE_STATE.ODOMETER,
        { unit: UNITS.KM, max: 2000000 },
      ),
    );
    if (info.fuel && seen.has('fuelRangeKm')) {
      features.push(
        feature(F.FUEL_RANGE, 'fuelRange', CATEGORIES.DISTANCE_SENSOR, TYPES.SENSOR.DECIMAL, {
          unit: UNITS.KM,
          max: 2000,
        }),
      );
    }
  }
  if (caps.lock) {
    features.push(
      // 1 = locked (the lock icon of the Gladys front).
      feature(F.LOCKED, 'locked', CATEGORIES.LOCK, TYPES.LOCK.BINARY),
      feature(
        F.DOOR_OPEN,
        'doorOpen',
        CATEGORIES.ELECTRICAL_VEHICLE_STATE,
        TYPES.ELECTRICAL_VEHICLE_STATE.DOOR_OPENED,
      ),
    );
  }
  if (caps.location) {
    features.push(
      feature(F.POSITION, 'position', CATEGORIES.TEXT, TYPES.TEXT.TEXT, {
        keep_history: false,
        max: 0,
      }),
    );
  }
  return {
    name: vehicleName(info),
    external_id: ids.device,
    // The runtime keeps its own pace (src/renault.js): the core never polls it.
    should_poll: false,
    model: info.model,
    features,
  };
}

const round = (value, decimals = 0) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const binary = (value) => (value === true ? 1 : value === false ? 0 : null);

/** "48.85661, 2.35222" (about one metre). */
export const positionText = (snapshot) =>
  Number.isFinite(snapshot.latitude) && Number.isFinite(snapshot.longitude)
    ? `${snapshot.latitude.toFixed(5)}, ${snapshot.longitude.toFixed(5)}`
    : null;

/**
 * States of one car, from its snapshot.
 * @param {object} snapshot canonical snapshot (+ `targetTempC`, the setpoint kept locally)
 * @returns {Array<{ key: string, value?: number, text?: string }>} only the known values
 */
export function vehicleStates(snapshot) {
  const F = VEHICLE_FEATURES;
  // Stale estimates once the charge is over mean nothing.
  const whileCharging = (value) => (snapshot.charging === false ? 0 : value);
  const values = [
    [F.BATTERY_LEVEL, round(snapshot.batteryLevel)],
    [F.RANGE, round(snapshot.rangeKm)],
    [F.CHARGING_STATE, chargingStationState(snapshot)],
    [F.PLUGGED, binary(snapshot.plugged)],
    [F.CHARGING, binary(snapshot.charging)],
    [F.CHARGE_POWER, whileCharging(round(snapshot.chargePowerKw, 1))],
    [F.CHARGE_TIME_REMAINING, whileCharging(round(snapshot.chargeRemainingMin))],
    [F.BATTERY_TEMPERATURE, round(snapshot.batteryTempC, 1)],
    [F.PRECONDITIONING, binary(snapshot.hvacOn)],
    [F.TARGET_TEMPERATURE, round(snapshot.targetTempC, 1)],
    [F.OUTSIDE_TEMPERATURE, round(snapshot.outsideTempC, 1)],
    [F.INSIDE_TEMPERATURE, round(snapshot.insideTempC, 1)],
    [F.ODOMETER, round(snapshot.odometerKm)],
    [F.FUEL_RANGE, round(snapshot.fuelRangeKm)],
    [F.LOCKED, binary(snapshot.locked)],
    [F.DOOR_OPEN, binary(snapshot.doorOpen)],
  ];
  const states = values
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ({ key, value }));
  if (snapshot.chargeMode) states.push({ key: F.CHARGE_MODE, text: snapshot.chargeMode });
  const position = positionText(snapshot);
  if (position) states.push({ key: F.POSITION, text: position });
  return states;
}

// --- Commands ------------------------------------------------------------------

function finite(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  if (String(value ?? '').trim() === '' || !Number.isFinite(n)) throw new Error('Not a number');
  return n;
}

/** A preconditioning temperature the app accepts: 15 to 25 °C, by half degrees. */
export function preconditioningTemperature(value) {
  const n = Math.round(finite(value) * 2) / 2;
  return Math.min(PRECONDITIONING_MAX_C, Math.max(PRECONDITIONING_MIN_C, n));
}

/**
 * Translate a Gladys command into a cloud order.
 * @param {string} featureKey
 * @param {number|string} value
 * @param {object} snapshot current snapshot (for the setpoint)
 * @returns {{ order: string, args?: object, expect: object, local?: boolean } | null}
 *   `expect`: the snapshot fields the car should report once it did it
 */
export function vehicleCommand(featureKey, value, snapshot = {}) {
  const on = Number(value) === 1;
  switch (featureKey) {
    case VEHICLE_FEATURES.CHARGING:
      return on
        ? { order: 'chargeStart', expect: { charging: true } }
        : { order: 'chargeStop', expect: { charging: false } };
    case VEHICLE_FEATURES.PRECONDITIONING:
      return on
        ? {
            order: 'hvacStart',
            args: preconditioningTemperature(snapshot.targetTempC ?? DEFAULT_PRECONDITIONING_C),
            expect: { hvacOn: true },
          }
        : { order: 'hvacStop', expect: { hvacOn: false } };
    case VEHICLE_FEATURES.TARGET_TEMPERATURE:
      // Kept for the next start: the cloud has no "set temperature" alone.
      return { local: true, expect: { targetTempC: preconditioningTemperature(value) } };
    case VEHICLE_FEATURES.CHARGE_MODE: {
      const mode = chargeModeOf(value) ?? (CHARGE_MODES.includes(value) ? value : undefined);
      if (!mode) throw new Error(`Unknown charge mode: ${value}`);
      return { order: 'setChargeMode', args: mode, expect: { chargeMode: mode } };
    }
    default:
      return null;
  }
}
