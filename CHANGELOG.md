# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-13

### Added

- Renault and Dacia cars of a MY Renault / MY Dacia account in Gladys, one device per car: battery
  level, range, charging state, plugged in, charging, charging power and time remaining, battery
  temperature, charge mode, preconditioning and its temperature, outside and inside temperature,
  mileage, fuel range, locks and openings, depending on what each model offers.
- GPS position of the cars, off by default.
- Commands: start and stop charging, start and stop the preconditioning, immediate or scheduled
  charge mode. A command shows as requested until the car reports it.
- Accounts with two-step verification: "Send the verification code" and "Enter the code" in the
  configuration; the installation is then remembered.
- "Test the connection" lists the cars of the account, or says in red what is wrong.
- Scene trigger "Charge finished", scene actions "Refresh a Renault / Dacia" and "Precondition a
  Renault / Dacia".
- Dashboard widget "Renault / Dacia car".
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-renault/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-renault/releases/tag/v1.0.1
