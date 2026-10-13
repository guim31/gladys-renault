#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Sign-in probe against the real MY Renault cloud, with the integration's own
// client: Gigya login, JWT, and (with --vehicles) the number of accounts and
// cars. Nothing sensitive is printed: no token, no address, no VIN.
//
//   RENAULT_USERNAME=… RENAULT_PASSWORD=… [RENAULT_LOCALE=fr_FR] node scripts/probe.mjs [--vehicles]
//
// An account with two-step verification: run it in a terminal, the code
// e-mailed is asked for on stdin.
// -----------------------------------------------------------------------------

import { createInterface } from 'node:readline/promises';
import { createHttp } from '../src/renault/http.js';
import { createRenaultClient } from '../src/renault/client.js';
import { ERROR_KINDS } from '../src/renault/errors.js';
import { createMemoryStore } from '../src/store.js';

const username = process.env.RENAULT_USERNAME ?? '';
const password = process.env.RENAULT_PASSWORD ?? '';
const locale = process.env.RENAULT_LOCALE ?? 'fr_FR';
if (!username || !password) {
  console.error('Set RENAULT_USERNAME and RENAULT_PASSWORD (and RENAULT_LOCALE, default fr_FR).');
  process.exit(2);
}

const store = createMemoryStore();
const session = store.sessionStore(store.fingerprint({ locale, username, password }));
const client = createRenaultClient({
  http: createHttp(),
  locale,
  credentials: { username, password },
  session,
});
const step = (label, outcome) => console.log(`${label.padEnd(28)} ${outcome}`);
// Only the kind and the cloud's code: the message of a Gigya error is safe,
// but this keeps the output free of anything that came back.
const describe = (err) => `${err.kind ?? 'error'}${err.code !== undefined ? ` (${err.code})` : ''}`;

async function askCode() {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('Code received by e-mail: ')).trim();
  } finally {
    rl.close();
  }
}

try {
  step('Locale', client.locale);
  try {
    await client.connect();
    step('Gigya login + JWT', 'OK');
  } catch (err) {
    if (err.kind !== ERROR_KINDS.TFA_REQUIRED) throw err;
    step('Gigya login', 'two-step verification required (403101)');
    const { email } = await client.requestTfaCode();
    step('Verification code', email === null ? 'not needed after all' : `sent to ${email}`);
    if (email !== null) {
      const code = await askCode();
      if (!code) {
        step('Verification', 'skipped (no terminal)');
        process.exit(0);
      }
      await client.verifyTfaCode(code);
      step('Verification + login + JWT', 'OK');
    }
  }
  if (process.argv.includes('--vehicles')) {
    const accounts = await client.accounts();
    step('Accounts', `${accounts.length} (${accounts.map((a) => a.accountType).join(', ')})`);
    let cars = 0;
    for (const account of accounts) {
      try {
        cars += (await client.vehicles(account.accountId)).length;
      } catch (err) {
        step(`  ${account.accountType}`, `no vehicle list: ${describe(err)}`);
      }
    }
    step('Vehicles', String(cars));
  }
} catch (err) {
  step('Failed', describe(err));
  process.exit(1);
}
