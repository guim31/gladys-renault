// -----------------------------------------------------------------------------
// A small HTTP layer over the global fetch: timeouts, query strings, JSON and
// form bodies, cookies sent and read, network errors as RenaultError.
//
// Error messages name the host only, never the URL: the Gigya calls carry
// tokens in their query string.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, RenaultError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30000;

/** The `name=value` cookies a response sets. */
export function responseCookies(headers) {
  const lines =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie')].filter(Boolean);
  const cookies = {};
  for (const line of lines) {
    const [pair] = line.split(';');
    const at = pair.indexOf('=');
    if (at > 0) cookies[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return cookies;
}

/**
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export function createHttp({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  /**
   * One request.
   * @param {string} url
   * @param {object} [options]
   * @param {string} [options.method] default GET, POST with a body
   * @param {Record<string, string>} [options.headers]
   * @param {Record<string, string|number>} [options.query]
   * @param {Record<string, string|number>} [options.form] form-urlencoded body
   * @param {object} [options.json] JSON body
   * @param {string} [options.contentType] of the JSON body
   * @param {Record<string, string>} [options.cookies]
   * @returns {Promise<{ status: number, headers: Headers, text: string, json: () => any }>}
   */
  async function request(url, options = {}) {
    const target = new URL(url);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    }
    const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
    let body;
    if (options.json !== undefined) {
      headers['Content-Type'] = options.contentType ?? 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(
        Object.entries(options.form).map(([key, value]) => [key, String(value)]),
      ).toString();
    }
    const cookies = Object.entries(options.cookies ?? {}).filter(([, value]) => value);
    if (cookies.length > 0) {
      headers.Cookie = cookies.map(([name, value]) => `${name}=${value}`).join('; ');
    }
    let response;
    try {
      response = await fetchImpl(target.toString(), {
        method: options.method ?? (body !== undefined ? 'POST' : 'GET'),
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.cause?.code ?? err?.name ?? 'error';
      throw new RenaultError(ERROR_KINDS.NETWORK, `${target.host} unreachable (${reason})`);
    }
    let text;
    try {
      text = await response.text();
    } catch (err) {
      throw new RenaultError(
        ERROR_KINDS.NETWORK,
        `${target.host}: answer interrupted (${err?.name ?? 'error'})`,
      );
    }
    return {
      status: response.status,
      headers: response.headers,
      text,
      /** The parsed body, `null` when it is not JSON. */
      json() {
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      },
    };
  }

  return { request };
}
