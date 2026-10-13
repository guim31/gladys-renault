// -----------------------------------------------------------------------------
// Dashboard widget `vehicle` (SDK v0.14+, Gladys 5.1+): one car — two tiles,
// a status list, up to four buttons (preconditioning, charging, charge mode,
// refresh).
//
// The tiles are bound to the device features once the car is added to Gladys
// (they then move with every published state); before that they show the last
// known value. The status rows and the button labels are computed here: the
// runtime nudges the widget when they change (src/renault.js), the TTL is a
// safety net. A command accepted by the cloud is shown as "requested" until
// the car reports it: the cloud accepting it does not mean the car did it.
// Budget of the core: 8 components, 6 tiles, 1 status (10 rows), 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { VEHICLE_FEATURES as F } from './devices/vehicle.js';
import { MESSAGES, WIDGET_ISSUES, UserError } from './messages.js';
import { WIDGET_KEYS } from './renault.js';

export const TEXT = {
  pickDevice: {
    en: 'Choose a vehicle in the widget settings.',
    fr: 'Choisissez un véhicule dans les réglages du widget.',
    de: 'Wähle in den Widget-Einstellungen ein Fahrzeug.',
    es: 'Elija un vehículo en los ajustes del widget.',
  },
  notVehicle: {
    en: 'This device is not a vehicle of this integration.',
    fr: 'Cet appareil n’est pas un véhicule de cette intégration.',
    de: 'Dieses Gerät ist kein Fahrzeug dieser Integration.',
    es: 'Este dispositivo no es un vehículo de esta integración.',
  },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  range: { en: 'Range', fr: 'Autonomie', de: 'Reichweite', es: 'Autonomía' },
  mileage: { en: 'Mileage', fr: 'Kilométrage', de: 'Kilometerstand', es: 'Kilometraje' },
  fuelRange: { en: 'Fuel range', fr: 'Autonomie carb.', de: 'Kraftstoff', es: 'Combustible' },
  charge: { en: 'Charge', fr: 'Charge', de: 'Laden', es: 'Carga' },
  charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  plugged: { en: 'Plugged in', fr: 'Branchée', de: 'Angeschlossen', es: 'Enchufado' },
  unplugged: { en: 'Unplugged', fr: 'Débranchée', de: 'Nicht angeschlossen', es: 'Desenchufado' },
  chargeMode: { en: 'Charge mode', fr: 'Mode de charge', de: 'Lademodus', es: 'Modo de carga' },
  always: { en: 'Immediate', fr: 'Immédiate', de: 'Sofort', es: 'Inmediata' },
  scheduled: { en: 'Scheduled', fr: 'Programmée', de: 'Geplant', es: 'Programada' },
  preconditioning: {
    en: 'Preconditioning',
    fr: 'Préconditionnement',
    de: 'Vorklimatisierung',
    es: 'Preacondicionamiento',
  },
  on: { en: 'On', fr: 'En marche', de: 'Ein', es: 'Encendido' },
  requested: {
    en: 'Requested, waiting for the car',
    fr: 'Demandé, en attente de la voiture',
    de: 'Angefragt, wartet auf das Auto',
    es: 'Solicitado, esperando al coche',
  },
  locks: { en: 'Doors', fr: 'Portes', de: 'Türen', es: 'Puertas' },
  locked: { en: 'Locked', fr: 'Verrouillées', de: 'Verriegelt', es: 'Bloqueadas' },
  unlocked: { en: 'Unlocked', fr: 'Déverrouillées', de: 'Entriegelt', es: 'Desbloqueadas' },
  open: {
    en: 'Door or tailgate open',
    fr: 'Portière ou coffre ouvert',
    de: 'Tür oder Heckklappe offen',
    es: 'Puerta o portón abierto',
  },
  account: { en: 'Account', fr: 'Compte', de: 'Konto', es: 'Cuenta' },
  lastRequest: {
    en: 'Last request',
    fr: 'Dernière demande',
    de: 'Letzte Anfrage',
    es: 'Última solicitud',
  },
  unconfirmed: {
    en: 'Not reported by the car',
    fr: 'Pas signalée par la voiture',
    de: 'Vom Auto nicht gemeldet',
    es: 'No confirmada por el coche',
  },
  lastUpdate: {
    en: 'Last update',
    fr: 'Dernier relevé',
    de: 'Letzte Meldung',
    es: 'Última actualización',
  },
  startPreconditioning: {
    en: 'Precondition',
    fr: 'Préconditionner',
    de: 'Vorklimatisieren',
    es: 'Preacondicionar',
  },
  stopPreconditioning: {
    en: 'Stop preconditioning',
    fr: 'Arrêter le précond.',
    de: 'Vorklima. stoppen',
    es: 'Parar preacond.',
  },
  startCharge: {
    en: 'Start charging',
    fr: 'Lancer la charge',
    de: 'Laden starten',
    es: 'Iniciar carga',
  },
  stopCharge: {
    en: 'Stop charging',
    fr: 'Arrêter la charge',
    de: 'Laden stoppen',
    es: 'Parar carga',
  },
  chargeNow: { en: 'Charge now', fr: 'Charger maintenant', de: 'Jetzt laden', es: 'Cargar ahora' },
  useSchedule: {
    en: 'Use the schedule',
    fr: 'Charge programmée',
    de: 'Zeitplan nutzen',
    es: 'Usar el horario',
  },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  map: { en: 'Map', fr: 'Carte', de: 'Karte', es: 'Mapa' },
};

function message(text) {
  return { ttl_seconds: 300, components: [{ type: 'text', variant: 'body', text }] };
}

/** "13/10 14:05": when the car last sent its state, in every language. */
export function formatUpdated(ms, timeZone) {
  if (!Number.isFinite(ms)) return '—';
  const format = (locale) =>
    new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(ms));
  return { en: format('en-GB'), fr: format('fr-FR'), de: format('de-DE'), es: format('es-ES') };
}

const decimal = (value) => String(value).replace('.', ',');

function chargeRow(snapshot, pending) {
  if (pending.has(F.CHARGING)) {
    return { label: TEXT.charge, icon: 'zap', value: TEXT.requested, color: WIDGET_COLORS.INFO };
  }
  if (snapshot.charging === true) {
    const minutes = snapshot.chargeRemainingMin;
    const left =
      Number.isFinite(minutes) && minutes > 0
        ? ` ${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, '0')}`
        : '';
    const power =
      Number.isFinite(snapshot.chargePowerKw) && snapshot.chargePowerKw > 0
        ? `, ${Math.round(snapshot.chargePowerKw * 10) / 10} kW`
        : '';
    return {
      label: TEXT.charge,
      icon: 'zap',
      value: {
        en: `Charging${left ? `,${left} left` : ''}${power}`,
        fr: `En charge${left ? `, reste${left}` : ''}${decimal(power)}`,
        de: `Lädt${left ? `, noch${left}` : ''}${decimal(power)}`,
        es: `Cargando${left ? `, quedan${left}` : ''}${decimal(power)}`,
      },
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  if (snapshot.plugged === true) {
    return { label: TEXT.charge, icon: 'battery', value: TEXT.plugged, color: WIDGET_COLORS.INFO };
  }
  if (snapshot.plugged === false) {
    return {
      label: TEXT.charge,
      icon: 'battery',
      value: TEXT.unplugged,
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return { label: TEXT.charge, icon: 'battery', value: '—', color: WIDGET_COLORS.NEUTRAL };
}

function preconditioningRow(snapshot, pending) {
  if (pending.has(F.PRECONDITIONING)) {
    return {
      label: TEXT.preconditioning,
      icon: 'wind',
      value: TEXT.requested,
      color: WIDGET_COLORS.INFO,
    };
  }
  const setpoint = snapshot.targetTempC;
  return {
    label: TEXT.preconditioning,
    icon: 'wind',
    value:
      snapshot.hvacOn === true
        ? TEXT.on
        : {
            en: `Off (${setpoint} °C)`,
            fr: `Arrêté (${decimal(setpoint)} °C)`,
            de: `Aus (${decimal(setpoint)} °C)`,
            es: `Apagado (${decimal(setpoint)} °C)`,
          },
    color: snapshot.hvacOn === true ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
  };
}

/** The content of the widget for one car (see vehicleView in src/renault.js). */
export function vehicleContent(view, { timeZone } = {}) {
  const { device, created, caps, snapshot, pending, lastCommand, issue } = view;
  const ref = (key) => `${device.external_id}:${key}`;
  const createdIds = new Set((created?.features ?? []).map((f) => f.external_id));
  // A tile bound to a feature Gladys does not have shows nothing: inline value then.
  const tile = (key, label, icon, value, unit) =>
    createdIds.has(ref(key))
      ? { type: 'value', label, icon, device_feature: ref(key) }
      : {
          type: 'value',
          label,
          icon,
          value: Number.isFinite(value) ? Math.round(value) : '—',
          ...(Number.isFinite(value) ? { unit } : {}),
        };

  const components = caps.battery
    ? [
        tile(F.BATTERY_LEVEL, TEXT.battery, 'battery', snapshot.batteryLevel, '%'),
        tile(F.RANGE, TEXT.range, 'navigation', snapshot.rangeKm, 'km'),
      ]
    : [
        tile(F.ODOMETER, TEXT.mileage, 'activity', snapshot.odometerKm, 'km'),
        ...(Number.isFinite(snapshot.fuelRangeKm)
          ? [tile(F.FUEL_RANGE, TEXT.fuelRange, 'navigation', snapshot.fuelRangeKm, 'km')]
          : []),
      ];

  const items = [];
  if (caps.battery) items.push(chargeRow(snapshot, pending));
  if (caps.chargeMode) {
    items.push({
      label: TEXT.chargeMode,
      icon: 'clock',
      value: pending.has(F.CHARGE_MODE) ? TEXT.requested : (TEXT[snapshot.chargeMode] ?? '—'),
      color: pending.has(F.CHARGE_MODE) ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (caps.hvac) items.push(preconditioningRow(snapshot, pending));
  if (caps.lock && (snapshot.locked !== undefined || snapshot.doorOpen !== undefined)) {
    items.push({
      label: TEXT.locks,
      icon: snapshot.locked === false ? 'unlock' : 'lock',
      value:
        snapshot.doorOpen === true
          ? TEXT.open
          : snapshot.locked === true
            ? TEXT.locked
            : snapshot.locked === false
              ? TEXT.unlocked
              : '—',
      color:
        snapshot.doorOpen === true || snapshot.locked === false
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.SUCCESS,
    });
  }
  if (WIDGET_ISSUES[issue]) {
    items.push({
      label: TEXT.account,
      icon: 'alert-octagon',
      value: WIDGET_ISSUES[issue],
      color: WIDGET_COLORS.DANGER,
    });
  }
  if (lastCommand?.outcome === 'unconfirmed') {
    items.push({
      label: TEXT.lastRequest,
      icon: 'alert-triangle',
      value: TEXT.unconfirmed,
      color: WIDGET_COLORS.WARNING,
    });
  }
  items.push({
    label: TEXT.lastUpdate,
    icon: 'clock',
    value: formatUpdated(
      snapshot.batteryUpdatedAt ?? snapshot.hvacUpdatedAt ?? snapshot.lockUpdatedAt,
      timeZone,
    ),
    color: WIDGET_COLORS.NEUTRAL,
  });
  components.push({ type: 'status', items });

  // Buttons, most useful first: the core keeps four.
  const buttons = [];
  if (caps.hvacStart) {
    buttons.push(
      snapshot.hvacOn === true && caps.hvacStop
        ? {
            type: 'button',
            label: TEXT.stopPreconditioning,
            icon: 'wind',
            action: { key: 'preconditioning_stop' },
          }
        : {
            type: 'button',
            label: TEXT.startPreconditioning,
            icon: 'wind',
            // It heats or cools the car on its battery: asks first.
            action: { key: 'preconditioning_start', confirm: true },
          },
    );
  }
  if (caps.chargeStop && snapshot.charging === true) {
    buttons.push({
      type: 'button',
      label: TEXT.stopCharge,
      icon: 'zap-off',
      action: { key: 'charge_stop' },
    });
  } else if (caps.chargeStart && snapshot.plugged === true && snapshot.charging !== true) {
    buttons.push({
      type: 'button',
      label: TEXT.startCharge,
      icon: 'zap',
      action: { key: 'charge_start' },
    });
  }
  if (caps.chargeMode && snapshot.chargeMode) {
    buttons.push(
      snapshot.chargeMode === 'scheduled'
        ? { type: 'button', label: TEXT.chargeNow, icon: 'zap', action: { key: 'mode_always' } }
        : {
            type: 'button',
            label: TEXT.useSchedule,
            icon: 'clock',
            action: { key: 'mode_scheduled' },
          },
    );
  }
  buttons.push({
    type: 'button',
    label: TEXT.refresh,
    icon: 'refresh-cw',
    action: { key: 'refresh' },
  });
  if (caps.location && Number.isFinite(snapshot.latitude) && Number.isFinite(snapshot.longitude)) {
    buttons.push({
      type: 'button',
      label: TEXT.map,
      icon: 'map-pin',
      link: {
        url: `https://www.openstreetmap.org/?mlat=${snapshot.latitude.toFixed(5)}&mlon=${snapshot.longitude.toFixed(5)}#map=16/${snapshot.latitude.toFixed(5)}/${snapshot.longitude.toFixed(5)}`,
      },
    });
  }
  components.push(...buttons.slice(0, 4));
  return { ttl_seconds: 300, components };
}

// Widget action key → [feature, value].
export const VEHICLE_ACTIONS = {
  preconditioning_start: [F.PRECONDITIONING, 1],
  preconditioning_stop: [F.PRECONDITIONING, 0],
  charge_start: [F.CHARGING, 1],
  charge_stop: [F.CHARGING, 0],
  mode_always: [F.CHARGE_MODE, 'always'],
  mode_scheduled: [F.CHARGE_MODE, 'scheduled'],
};

/**
 * Widgets, keyed like the manifest. `runtime` is src/renault.js.
 * A widget action resolves its toast (multi-language), and throws on failure:
 * the core then shows "Action failed — <message>" in red, the message being
 * one plain string. A widget action does not carry the viewer's language, a
 * widget read does: the last one read is used.
 */
export function createWidgets(runtime, { timeZone = process.env.TZ } = {}) {
  let language = 'fr';
  const fail = (text) => new Error(text[language] ?? text.en);
  return {
    [WIDGET_KEYS.VEHICLE]: {
      async get({ settings, language: viewer } = {}) {
        if (typeof viewer === 'string' && viewer) language = viewer.slice(0, 2);
        if (!settings?.device) return message(TEXT.pickDevice);
        const view = runtime.vehicleView(settings.device);
        if (!view) return message(TEXT.notVehicle);
        return vehicleContent(view, { timeZone });
      },
      async action({ actionKey, settings }) {
        try {
          if (actionKey === 'refresh') {
            await runtime.refresh(settings?.device);
            return MESSAGES.refreshed;
          }
          const order = VEHICLE_ACTIONS[actionKey];
          if (!order) throw new Error(`Unknown action: ${actionKey}`);
          const [feature, value] = order;
          await runtime.order(settings?.device, feature, value);
          return MESSAGES.commandSent;
        } catch (err) {
          if (err instanceof UserError) throw fail(err.text);
          throw err;
        }
      },
    },
  };
}
