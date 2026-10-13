// -----------------------------------------------------------------------------
// Account locales and their cloud keys, from hacf-fr/renault-api (MIT,
// const.py AVAILABLE_LOCALES). The locale picks the Gigya (sign-in) and
// Kamereon (car data) servers and API keys of the MY Renault / MY Dacia app of
// the country; its last two letters are the `country` of every Kamereon call.
//
// These keys are those the official apps ship with, public in the library:
// they identify the app, not the user.
// -----------------------------------------------------------------------------

const GIGYA_KEY_EU = '3_VgdkgtIRH3AdHvJm-cjV2ug2EFE0lxt0IJzMC4MFqZjFpn_GYFXVdNZ19L7wZX0N';
const GIGYA_URL_AU = 'https://gigya-prod-au1.renaultgroup.com';
const GIGYA_URL_EU = 'https://accounts.eu1.gigya.com';
const GIGYA_URL_US = 'https://accounts.us1.gigya.com';
const KAMEREON_KEY = 'YjkKtHmGfaceeuExUDKGxrLZGGvtVS0J';
const KAMEREON_URL_AU = 'https://api-wired-prod-1-apn1.wrd-aws.com';
const KAMEREON_URL_EU = 'https://api-wired-prod-1-euw1.wrd-aws.com';
const KAMEREON_URL_US = 'https://api-wired-prod-1-usw2.wrd-aws.com';

const EU = {
  gigyaUrl: GIGYA_URL_EU,
  gigyaKey: GIGYA_KEY_EU,
  kamereonUrl: KAMEREON_URL_EU,
  kamereonKey: KAMEREON_KEY,
};

/** Locale → servers and keys. */
export const LOCALES = {
  bg_BG: EU,
  cs_CZ: EU,
  da_DK: EU,
  de_DE: EU,
  de_AT: EU,
  de_CH: EU,
  en_AU: {
    gigyaUrl: GIGYA_URL_AU,
    gigyaKey: '4_GC9iGd3sH8sMJpz2x0q0CQ',
    kamereonUrl: KAMEREON_URL_AU,
    kamereonKey: KAMEREON_KEY,
  },
  en_GB: EU,
  en_IE: EU,
  es_ES: EU,
  es_MX: {
    gigyaUrl: GIGYA_URL_US,
    gigyaKey: '4_yTFqPSsGxVyRXPZUM7t1Iw',
    kamereonUrl: KAMEREON_URL_US,
    kamereonKey: KAMEREON_KEY,
  },
  fi_FI: EU,
  fr_FR: EU,
  fr_BE: EU,
  fr_CH: EU,
  fr_LU: { ...EU, gigyaKey: '3_zt44Wl_wT9mnqn-BHrR19PvXj3wYRPQKLcPbGWawlatFR837KdxSZZStbBTDaqnb' },
  hr_HR: EU,
  hu_HU: EU,
  it_IT: EU,
  it_CH: EU,
  nl_NL: EU,
  nl_BE: EU,
  no_NO: EU,
  pl_PL: EU,
  pt_PT: EU,
  ro_RO: EU,
  ru_RU: EU,
  sk_SK: EU,
  sl_SI: EU,
  sv_SE: EU,
};

export const LOCALE_CODES = Object.keys(LOCALES);
export const DEFAULT_LOCALE = 'fr_FR';

/** Servers and keys of a locale (unknown → French ones), plus its country code. */
export function localeSettings(locale) {
  const code = LOCALES[locale] ? locale : DEFAULT_LOCALE;
  return { locale: code, country: code.slice(-2), ...LOCALES[code] };
}
