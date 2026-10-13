# Renault / Dacia for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that follows Renault and
Dacia electric and plug-in hybrid cars (Zoe, Megane E-Tech, Scenic E-Tech, Renault 5, Renault 4,
Twingo Electric, Dacia Spring, Captur and Megane plug-in hybrids…) through the cloud of the
**MY Renault** / **MY Dacia** apps.

Not affiliated with Renault or Dacia. **Developed without the hardware: feedback welcome.** No car
and no account were available while writing it: the protocol and the test fixtures come from
[hacf-fr/renault-api](https://github.com/hacf-fr/renault-api), whose answers were collected from
real cars.

## What it does

- **One Gladys device per car** (keyed on the VIN), named after its model and plate: battery level,
  range, charging state, plugged in, charging, charging power and time remaining, battery
  temperature, charge mode, preconditioning and its temperature, outside / inside temperature,
  mileage, fuel range (hybrids), locks and openings (the few models that report them), and the GPS
  position — **off by default**, for privacy. Each car only gets what its model offers.
- **Commands**: start / stop charging, start / stop the preconditioning (at a temperature you set),
  immediate or scheduled charge mode, depending on the model. A command accepted by the cloud is not
  a command carried out by the car: the requested value is held until the car reports it (ten
  minutes at most), and the widget says "requested, waiting for the car".
- **Scene trigger** "Charge finished" (the car stopped charging, still plugged in), with the battery
  level and the range as variables.
- **Scene actions** "Refresh a Renault / Dacia" (fresh values for the next actions) and "Precondition
  a Renault / Dacia" (with its own temperature).
- **Dashboard widget** "Renault / Dacia car": battery, range, charge, charge mode, preconditioning,
  last update, and buttons to act on the car.
- **Two-step verification**: accounts that ask for a code by e-mail are supported, through two
  buttons of the configuration page; the installation is then remembered.

Everything is described for users in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## Requirements

- Gladys **5.1.0** or later.
- A car visible in the MY Renault or MY Dacia app, with its connected services active, and the
  e-mail address and password of that account.

## Installation

In Gladys: **Integrations → Install from GitHub**, paste `https://github.com/guim31/gladys-renault`,
then open the integration's **Configuration**: country of the account, e-mail address, password,
**Save**, **Test the connection**. Add the cars from the **Discovery** tab.

## How it works

- **Sign-in** (Gigya): the password is used once; the login token it gives is kept in `/data` (mode
  0600), with a salted fingerprint of the credentials it belongs to, and mints the 15-minute JWTs of
  the data calls. A revoked token is replaced with the password, once; a refused password, a
  two-step verification or a temporary block stop every attempt until the user acts (insisting
  could lock the account).
- **Reads** (Kamereon) return the state each car last sent to the cloud: they never wake the car.
  The container reads on its own timer (Gladys 5.2 does not poll external devices reliably,
  GladysAssistant/Gladys#3198); `onPoll` is a fallback that never calls the cloud. The pace stays
  under 60 calls an hour per account, like Home Assistant: 10 to 60 minutes, stretched with several
  cars. "Quota reached" pauses the reads for 15 minutes.
- **Per model**, the endpoints come from renault-api's table: an endpoint a model does not offer is
  never called, and one refused at the first call (403, 404, "not supported") is dropped, as Home
  Assistant does.
- Only the changes are published (`publishChangedStates`), plus a 12-hour heartbeat; the logs stay
  quiet at info level during normal operation (`LOG_LEVEL=debug` for the details), never show a
  secret, the e-mail address, a full VIN, a plate or a position.

## Limits

- No remote locking (the cloud does not offer it), no horn or lights, no charge schedule editing,
  no charge limit, no charge history.
- On the Renault 5, Renault 4, Scenic / Megane / Master E-Tech and Alpine A290, starting a charge
  turns the charge programs off (as the official app does), and a charge cannot be stopped remotely.
- Everything goes through the Renault cloud: when it is down or changes, the integration stops
  working until it is fixed.
- The GPS position is published as text (no "distance from home").

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .   # store checks (from a clone)
```

The tests run against the fake Gladys of the SDK and a fake Renault cloud
([`test/helpers/fakeRenault.js`](test/helpers/fakeRenault.js)) answering with the fixtures of
renault-api. To check the sign-in against the real service with a test account (nothing sensitive is
printed):

```bash
RENAULT_USERNAME=… RENAULT_PASSWORD=… RENAULT_LOCALE=fr_FR node scripts/probe.mjs
```

Project rules for contributors and coding assistants: [`CLAUDE.md`](CLAUDE.md). Versions are set by
the Release workflow (**Actions → Release**), never by hand.

## Credits

- [hacf-fr/renault-api](https://github.com/hacf-fr/renault-api) (MIT License, Copyright © 2020
  epenet): the Gigya and Kamereon protocol, the locale keys, the per-model endpoint table and the
  test fixtures, ported to JavaScript here.
- The Home Assistant [`renault`](https://www.home-assistant.io/integrations/renault/) integration
  (Apache-2.0): the entities exposed, the call budget and the handling of the endpoints a model
  refuses.

## License

[Apache-2.0](LICENSE)
