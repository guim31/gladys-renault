// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, SDK v0.14+, Gladys 5.1+).
//
// What a scene already does through the device features (start or stop the
// charge, start the preconditioning at the saved temperature) is not repeated,
// except where a parameter or an output adds something:
//   - `refresh_vehicle` reads the car's state from the cloud now (without
//     waking the car) and gives it to the next actions of the scene;
//   - `start_preconditioning` takes its own temperature, without changing the
//     one saved for the dashboard.
// The charge mode is a select feature, which a scene sets like any device.
//
// Fields arrive resolved and validated by the core, without defaults (a
// manifest default is not applied to an action). Throwing fails this action
// only, the scene goes on.
// -----------------------------------------------------------------------------

export const SCENE_ACTION_KEYS = {
  REFRESH_VEHICLE: 'refresh_vehicle',
  START_PRECONDITIONING: 'start_preconditioning',
};

const known = (value) => value !== undefined && value !== null;

export function createSceneActions(runtime) {
  return {
    async [SCENE_ACTION_KEYS.REFRESH_VEHICLE]({ fields }) {
      const snapshot = await runtime.refresh(fields.device);
      const outputs = {};
      if (Number.isFinite(snapshot.batteryLevel)) {
        outputs.battery_level = Math.round(snapshot.batteryLevel);
      }
      if (Number.isFinite(snapshot.rangeKm)) outputs.range_km = Math.round(snapshot.rangeKm);
      if (known(snapshot.plugged)) outputs.plugged = snapshot.plugged;
      if (known(snapshot.charging)) outputs.charging = snapshot.charging;
      return outputs;
    },

    async [SCENE_ACTION_KEYS.START_PRECONDITIONING]({ fields }) {
      const temperature = await runtime.startPreconditioning(fields.device, fields.temperature);
      return { temperature };
    },
  };
}
