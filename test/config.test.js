import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, normalizeConfig, readPeriodMs } from '../src/config.js';
import { createStore } from '../src/store.js';

test('normalizeConfig: defaults, trimmed address, unknown choices replaced', () => {
  assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);
  const config = normalizeConfig({
    username: ' driver@example.com ',
    password: ' with spaces \n',
    locale: 'xx_XX',
    language: 'it',
    refresh_minutes: 5,
    gps: 'true',
    account_id: ' account-id-1 ',
  });
  assert.equal(config.username, 'driver@example.com');
  assert.equal(config.password, ' with spaces ');
  assert.equal(config.locale, 'fr_FR');
  assert.equal(config.language, 'fr');
  assert.equal(config.refresh_minutes, '15');
  assert.equal(config.gps, true);
  assert.equal(config.account_id, 'account-id-1');
});

test('readPeriodMs: the configured period, stretched past 60 calls an hour', () => {
  const config = normalizeConfig({ refresh_minutes: '10' });
  assert.equal(readPeriodMs(config, 4), 10 * 60 * 1000);
  assert.equal(readPeriodMs(config, 21), 21 * 60 * 1000);
  assert.equal(readPeriodMs(normalizeConfig({ refresh_minutes: '60' }), 21), 60 * 60 * 1000);
});

test('the store: 0600, atomic, a fingerprint that says nothing of the password', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'renault-store-'));
  const store = createStore({ dir });
  await store.load();
  const fingerprint = store.fingerprint({
    locale: 'fr_FR',
    username: 'Driver@example.com',
    password: 'secret password',
  });
  const session = store.sessionStore(fingerprint);
  session.set({ loginToken: 'token' });
  store.vehicle('VIN1').targetTempC = 20;
  await store.flush();
  const file = join(dir, 'renault.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const text = await readFile(file, 'utf8');
  assert.ok(!text.includes('secret password'));
  assert.equal(JSON.parse(text).session.loginToken, 'token');

  // The same credentials (any case of the address) keep the session, others drop it.
  const again = createStore({ dir });
  await again.load();
  const same = again.fingerprint({
    locale: 'fr_FR',
    username: 'driver@example.com',
    password: 'secret password',
  });
  assert.equal(again.sessionStore(same).get().loginToken, 'token');
  const other = again.fingerprint({ locale: 'fr_FR', username: 'x@example.com', password: 'p' });
  assert.equal(again.sessionStore(other).get().loginToken, undefined);
  assert.equal(again.vehicle('VIN1').targetTempC, 20);
});
