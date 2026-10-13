# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the e-mail address and password of the MY Renault / MY Dacia account, kept in the Gladys
  configuration and sent only to the Renault sign-in service (Gigya, over HTTPS);
- in the `/data` volume, file `renault.json` (mode 0600, written atomically): the Gigya login token
  and person id, the device identifiers Gigya remembers after a two-step verification, a salted
  SHA-256 fingerprint of the credentials (never the password itself), and per car the
  preconditioning temperature and the optional values it reports;
- network: outbound HTTPS to the Renault cloud only (`accounts.*.gigya.com` or
  `gigya-prod-au1.renaultgroup.com`, `api-wired-prod-1-*.wrd-aws.com`); nothing listens.

The logs never contain the password, the e-mail address, a token, a full VIN, a plate or a position.
A report that one of them leaks is in scope.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)), the Renault cloud and
the cars.
