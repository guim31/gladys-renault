// -----------------------------------------------------------------------------
// Feature names, in the language chosen in the configuration.
//
// A `device` integration does not receive the language of the user (a widget
// request does): feature names follow the `language` setting, and Gladys keeps
// a name once the device is created. Widget contents and action messages use
// multi-language objects instead, so the core picks the viewer's language.
// -----------------------------------------------------------------------------

export const NAMES = {
  en: {
    batteryLevel: 'Battery level',
    range: 'Range',
    chargingState: 'Charging state',
    plugged: 'Plugged in',
    charging: 'Charging',
    chargePower: 'Charging power',
    chargeTimeRemaining: 'Charging time remaining',
    batteryTemperature: 'Battery temperature',
    chargeMode: 'Charge mode',
    preconditioning: 'Preconditioning',
    targetTemperature: 'Preconditioning temperature',
    outsideTemperature: 'Outside temperature',
    insideTemperature: 'Inside temperature',
    odometer: 'Mileage',
    fuelRange: 'Fuel range',
    locked: 'Locked',
    doorOpen: 'Door or tailgate open',
    position: 'GPS position',
  },
  fr: {
    batteryLevel: 'Niveau de batterie',
    range: 'Autonomie',
    chargingState: 'État de la charge',
    plugged: 'Branchée',
    charging: 'Charge',
    chargePower: 'Puissance de charge',
    chargeTimeRemaining: 'Temps de charge restant',
    batteryTemperature: 'Température de la batterie',
    chargeMode: 'Mode de charge',
    preconditioning: 'Préconditionnement',
    targetTemperature: 'Température de préconditionnement',
    outsideTemperature: 'Température extérieure',
    insideTemperature: 'Température intérieure',
    odometer: 'Kilométrage',
    fuelRange: 'Autonomie carburant',
    locked: 'Verrouillée',
    doorOpen: 'Portière ou coffre ouvert',
    position: 'Position GPS',
  },
  de: {
    batteryLevel: 'Batteriestand',
    range: 'Reichweite',
    chargingState: 'Ladezustand',
    plugged: 'Angeschlossen',
    charging: 'Laden',
    chargePower: 'Ladeleistung',
    chargeTimeRemaining: 'Verbleibende Ladezeit',
    batteryTemperature: 'Batterietemperatur',
    chargeMode: 'Lademodus',
    preconditioning: 'Vorklimatisierung',
    targetTemperature: 'Vorklimatisierungstemperatur',
    outsideTemperature: 'Außentemperatur',
    insideTemperature: 'Innentemperatur',
    odometer: 'Kilometerstand',
    fuelRange: 'Kraftstoffreichweite',
    locked: 'Verriegelt',
    doorOpen: 'Tür oder Heckklappe offen',
    position: 'GPS-Position',
  },
  es: {
    batteryLevel: 'Nivel de batería',
    range: 'Autonomía',
    chargingState: 'Estado de la carga',
    plugged: 'Enchufado',
    charging: 'Carga',
    chargePower: 'Potencia de carga',
    chargeTimeRemaining: 'Tiempo de carga restante',
    batteryTemperature: 'Temperatura de la batería',
    chargeMode: 'Modo de carga',
    preconditioning: 'Preacondicionamiento',
    targetTemperature: 'Temperatura de preacondicionamiento',
    outsideTemperature: 'Temperatura exterior',
    insideTemperature: 'Temperatura interior',
    odometer: 'Kilometraje',
    fuelRange: 'Autonomía de combustible',
    locked: 'Bloqueado',
    doorOpen: 'Puerta o portón abierto',
    position: 'Posición GPS',
  },
};

// Option labels of the charge mode select (one language, like the names).
export const CHARGE_MODE_LABELS = {
  en: { always: 'Immediate', scheduled: 'Scheduled' },
  fr: { always: 'Immédiate', scheduled: 'Programmée' },
  de: { always: 'Sofort', scheduled: 'Geplant' },
  es: { always: 'Inmediata', scheduled: 'Programada' },
};

/** Feature name in one language. */
export function t(language, key) {
  const table = NAMES[language] ?? NAMES.en;
  const name = table[key];
  if (!name) throw new Error(`Unknown text key: ${key}`);
  return name;
}
