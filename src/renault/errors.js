// -----------------------------------------------------------------------------
// Errors of the Gigya (sign-in) and Kamereon (car data) clouds, sorted by what
// the runtime does about them (see src/renault.js).
//
// Gigya answers `{ errorCode, errorDetails }` (errorCode 0 = success), often
// with HTTP 200. Kamereon answers `{ errors: [{ errorCode, errorMessage }] }`.
// Known codes from hacf-fr/renault-api (gigya/models.py, kamereon/models.py)
// and its error fixtures.
// -----------------------------------------------------------------------------

export const ERROR_KINDS = {
  // Wrong e-mail address or password (Gigya 403042): stop, the user must fix
  // the configuration. Insisting could lock the account.
  AUTH: 'auth',
  // The account asks for a code sent by e-mail (Gigya 403101).
  TFA_REQUIRED: 'tfa-required',
  // The e-mailed code is wrong (Gigya 400006 on the verification).
  TFA_CODE: 'tfa-code',
  // The sign-in pages refuse for now: captcha asked, account locked for a while.
  BLOCKED: 'blocked',
  // The saved session is no longer valid (Gigya 403005, 403013): sign in again.
  SESSION_EXPIRED: 'session-expired',
  // The access token (JWT) expired (Kamereon 401): get a new one, try again.
  TOKEN_EXPIRED: 'token-expired',
  // "You have reached your quota limit": pause the reads.
  RATE_LIMIT: 'rate-limit',
  // The model does not offer this endpoint (table, 501, "Operation not supported").
  NOT_SUPPORTED: 'not-supported',
  // 403 / forbidden: the model or the subscription does not give it.
  ACCESS_DENIED: 'access-denied',
  // 404: no such data for this car (often: never sent by this model).
  NOT_FOUND: 'not-found',
  // The privacy mode of the car is on: no data, no command.
  PRIVACY: 'privacy',
  // A change of the same kind is already in progress (409001).
  IN_PROGRESS: 'in-progress',
  // The request was refused as invalid (400).
  INVALID: 'invalid',
  NETWORK: 'network',
  SERVER: 'server',
  API: 'api',
};

export class RenaultError extends Error {
  constructor(kind, message, { code, status } = {}) {
    super(message);
    this.name = 'RenaultError';
    this.kind = kind;
    if (code !== undefined) this.code = code;
    if (status !== undefined) this.status = status;
  }
}

const GIGYA_CODES = {
  403042: ERROR_KINDS.AUTH,
  403101: ERROR_KINDS.TFA_REQUIRED,
  400006: ERROR_KINDS.TFA_CODE,
  403005: ERROR_KINDS.SESSION_EXPIRED,
  403013: ERROR_KINDS.SESSION_EXPIRED,
  // "Login failed, captcha required", "Account temporarily locked out".
  401020: ERROR_KINDS.BLOCKED,
  403120: ERROR_KINDS.BLOCKED,
};

/**
 * Throw the error a Gigya answer carries, if any.
 * @param {object} body parsed JSON answer
 * @param {number} status HTTP status
 * @returns {object} the body, when it is a success
 */
export function checkGigyaResponse(body, status) {
  if (!body || typeof body !== 'object') {
    throw new RenaultError(
      status >= 500 ? ERROR_KINDS.SERVER : ERROR_KINDS.API,
      `Unexpected Gigya answer (HTTP ${status})`,
      { status },
    );
  }
  const code = Number(body.errorCode ?? 0);
  if (code > 0) {
    let kind = GIGYA_CODES[code] ?? (code >= 500000 ? ERROR_KINDS.SERVER : ERROR_KINDS.API);
    // A pending two-factor answer without its token cannot be followed.
    if (kind === ERROR_KINDS.TFA_REQUIRED && !body.regToken) kind = ERROR_KINDS.API;
    const error = new RenaultError(kind, `Gigya error ${code}: ${describe(body.errorDetails)}`, {
      code,
      status,
    });
    // Kept out of the message: it never reaches a log line.
    if (kind === ERROR_KINDS.TFA_REQUIRED) {
      Object.defineProperty(error, 'regToken', { value: body.regToken, enumerable: false });
    }
    throw error;
  }
  if (status >= 500) throw new RenaultError(ERROR_KINDS.SERVER, `Gigya HTTP ${status}`, { status });
  if (status >= 400) throw new RenaultError(ERROR_KINDS.API, `Gigya HTTP ${status}`, { status });
  return body;
}

const KAMEREON_CODES = {
  'err.func.400': ERROR_KINDS.INVALID,
  'err.func.403': ERROR_KINDS.ACCESS_DENIED,
  'err.func.wired.forbidden': ERROR_KINDS.ACCESS_DENIED,
  'err.tech.500': ERROR_KINDS.SERVER,
  'err.tech.501': ERROR_KINDS.NOT_SUPPORTED,
  'err.func.wired.notFound': ERROR_KINDS.NOT_FOUND,
  'err.func.wired.not-found': ERROR_KINDS.NOT_FOUND,
  'err.tech.wired.kamereon-proxy': ERROR_KINDS.SERVER,
  'err.func.wired.overloaded': ERROR_KINDS.RATE_LIMIT,
  'err.func.privacy.on': ERROR_KINDS.PRIVACY,
  'err.func.wired.unauthorized': ERROR_KINDS.TOKEN_EXPIRED,
  409001: ERROR_KINDS.IN_PROGRESS,
};

/** The details sometimes nested as JSON in `errorMessage` (renault-api get_error_details). */
function errorDetails(message) {
  if (typeof message !== 'string') return describe(message);
  try {
    const nested = JSON.parse(message);
    const parts = (nested?.errors ?? [])
      .map((e) => [e.title, e.source?.pointer, e.detail].filter(Boolean).join(' '))
      .filter(Boolean);
    return parts.join(', ') || message;
  } catch {
    return message;
  }
}

/**
 * Throw the error a Kamereon answer carries, if any.
 * @param {object | null} body parsed JSON answer (null when not JSON)
 * @param {number} status HTTP status
 * @returns {object} the body, when it is a success
 */
export function checkKamereonResponse(body, status) {
  const first = Array.isArray(body?.errors) ? body.errors[0] : undefined;
  if (first) {
    const code = String(first.errorCode ?? '');
    const details = errorDetails(first.errorMessage);
    let kind = KAMEREON_CODES[code] ?? ERROR_KINDS.API;
    // "Operation not supported for this can": the model, not a refusal.
    if (kind === ERROR_KINDS.ACCESS_DENIED && /not supported/i.test(details)) {
      kind = ERROR_KINDS.NOT_SUPPORTED;
    }
    if (kind === ERROR_KINDS.API && status === 401) kind = ERROR_KINDS.TOKEN_EXPIRED;
    throw new RenaultError(kind, `Kamereon error ${code}: ${details}`.slice(0, 300), {
      code,
      status,
    });
  }
  if (status === 401) throw new RenaultError(ERROR_KINDS.TOKEN_EXPIRED, 'HTTP 401', { status });
  if (status === 403) throw new RenaultError(ERROR_KINDS.ACCESS_DENIED, 'HTTP 403', { status });
  if (status === 404) throw new RenaultError(ERROR_KINDS.NOT_FOUND, 'HTTP 404', { status });
  if (status === 429) throw new RenaultError(ERROR_KINDS.RATE_LIMIT, 'HTTP 429', { status });
  if (status >= 500) throw new RenaultError(ERROR_KINDS.SERVER, `HTTP ${status}`, { status });
  if (status >= 400) throw new RenaultError(ERROR_KINDS.API, `HTTP ${status}`, { status });
  if (!body || typeof body !== 'object') {
    throw new RenaultError(ERROR_KINDS.API, `Unexpected Kamereon answer (HTTP ${status})`, {
      status,
    });
  }
  return body;
}

function describe(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return 'no details';
  return JSON.stringify(value).slice(0, 200);
}
