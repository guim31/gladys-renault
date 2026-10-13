# Renault cloud fixtures

Answers of the Gigya (sign-in) and Kamereon (car data) clouds, taken from the
tests of [hacf-fr/renault-api](https://github.com/hacf-fr/renault-api)
(`tests/fixtures/`, MIT License, Copyright © 2020 epenet), which collected them
from real cars and contributors. Already anonymized there (VIN, ids, tokens);
in addition here:

- `kamereon/vehicles.json` is composed for these tests: seven cars of the
  library's fixtures (Zoe phase 2 and phase 1, Renault 5, Dacia Spring, Captur
  II plug-in hybrid and LPG, Austral hybrid) under one account, each with its own
  invented VIN and plate;
- `kamereon/data/location.austral_XHN1SU.json` points to a public square
  instead of the original coordinates;
- `kamereon/person.json` keeps the accounts only.

No answer was captured for this integration: it was developed without a car
or an account.
