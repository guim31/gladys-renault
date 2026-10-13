// -----------------------------------------------------------------------------
// Small JSON persistence under /data, the container's only writable volume.
//
// What survives a restart:
//   - the session of the account: the Gigya login token (signing in with the
//     password at every start is what triggers the e-mailed codes), the person
//     id and the device ids Gigya remembers after a two-factor verification;
//     with a fingerprint of the credentials they belong to (a salted hash: the
//     password itself is never written here);
//   - per car, the preconditioning setpoint chosen in Gladys (the cloud has no
//     "set temperature" command: it is sent with the next start) and the
//     optional values the car sends (they decide its features).
// The file holds tokens: it is written with mode 0600, atomically (temporary
// file + rename), and its content is never logged.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';
const FILE_NAME = 'renault.json';

const emptyData = () => ({ version: 1, salt: null, session: {}, vehicles: {} });

export function createStore({ dir = DEFAULT_DATA_DIR, debounceMs = 2000, logger } = {}) {
  const file = join(dir, FILE_NAME);
  let data = emptyData();
  let timer = null;
  let writing = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed && parsed.version === 1) data = { ...emptyData(), ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger?.warn(`Ignoring unreadable ${file}: ${err.code ?? 'invalid JSON'}`);
      }
    }
    return data;
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    const content = JSON.stringify(data);
    writing = writing.then(async () => {
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(`${file}.tmp`, content, { mode: 0o600 });
        await chmod(`${file}.tmp`, 0o600);
        await rename(`${file}.tmp`, file);
      } catch (err) {
        logger?.warn(`Could not save ${file}: ${err.code ?? err.message}`);
      }
    });
    return writing;
  }

  function touch() {
    if (!timer) {
      timer = setTimeout(flush, debounceMs);
      timer.unref?.();
    }
  }

  return createStoreApi({ get: () => data, touch, flush, load });
}

/** In-memory store with the same API (tests, the probe script). */
export function createMemoryStore(initial = emptyData()) {
  let data = structuredClone(initial);
  return createStoreApi({
    get: () => data,
    touch() {},
    async flush() {},
    async load() {
      data = { ...emptyData(), ...data };
      return data;
    },
  });
}

function createStoreApi({ get, touch, flush, load }) {
  return {
    load,
    flush,
    touch,
    get data() {
      return get();
    },

    /**
     * A one-way fingerprint of the credentials, to drop a session that belongs
     * to other ones (salted: the hash says nothing of the password).
     */
    fingerprint({ locale, username, password }) {
      const data = get();
      if (!data.salt) {
        data.salt = randomBytes(16).toString('hex');
        touch();
      }
      return createHash('sha256')
        .update(`${data.salt}\0${locale}\0${username.toLowerCase()}\0${password}`)
        .digest('hex');
    },

    /**
     * The session store of the cloud client, bound to the credentials it
     * belongs to: another fingerprint starts from an empty session (the
     * Gigya device ids are kept: they identify this installation, not the
     * account).
     */
    sessionStore(fingerprint) {
      const data = get();
      if (data.session.fingerprint !== fingerprint) {
        data.session = { fingerprint, deviceIds: data.session.deviceIds ?? null };
        touch();
      }
      return {
        get: () => get().session,
        set(partial) {
          Object.assign(get().session, partial);
          // A new token is saved at once: a restart must not sign in again.
          flush();
        },
      };
    },

    /** The memory of one car. */
    vehicle(vin) {
      const data = get();
      data.vehicles[vin] = data.vehicles[vin] ?? {};
      return data.vehicles[vin];
    },
  };
}
