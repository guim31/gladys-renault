// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names, and the documentation (same sections in the four
// files). German says "du", never the polite "Sie"; Spanish says "usted".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { CHARGE_MODE_LABELS, NAMES } from '../src/i18n.js';
import { MESSAGES, WIDGET_ISSUES } from '../src/messages.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;
// "tú" forms in Spanish (the series uses "usted").
const FAMILIAR_SPANISH = /(?<!\p{L})(tu|tus|tú|puedes|debes|introduce|elige|pulsa)(?!\p{L})/iu;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 400,
  message: 200,
  short: 24,
  row: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') return [`${path} is empty`];
  const found = [];
  if (text.length > max) found.push(`${path} has ${text.length} characters (${max} at most)`);
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  if (lang === 'es' && FAMILIAR_SPANISH.test(text)) {
    found.push(`${path} uses "tú" instead of "usted": "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) walk(item, `${path}.${child}`, child);
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
  assert.deepEqual(Object.keys(CHARGE_MODE_LABELS), LANGS);
});

test('the name of the integration is the same in every language', () => {
  assert.equal(typeof manifest.name, 'string');
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 80, `only ${texts.length} texts found in the manifest`);
  assert.deepEqual(
    texts.flatMap(({ path, value, max }) => problems(value, path, max)),
    [],
  );
});

test('every message table of the code has the four languages', () => {
  const short = new Set([
    'battery',
    'range',
    'mileage',
    'fuelRange',
    'startPreconditioning',
    'stopPreconditioning',
    'startCharge',
    'stopCharge',
    'chargeNow',
    'useSchedule',
    'refresh',
    'map',
  ]);
  const found = [
    ...Object.entries(MESSAGES).flatMap(([key, value]) =>
      problems(value, `MESSAGES.${key}`, MAX.message),
    ),
    ...Object.entries(WIDGET_ISSUES).flatMap(([key, value]) =>
      problems(value, `WIDGET_ISSUES.${key}`, MAX.row),
    ),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(
        value,
        `TEXT.${key}`,
        short.has(key)
          ? MAX.short
          : key === 'pickDevice' || key === 'notVehicle'
            ? MAX.message
            : MAX.row,
      ),
    ),
  ];
  assert.deepEqual(found, []);
});

test('the feature names and charge mode labels exist in every language', () => {
  const found = [];
  for (const [table, name] of [
    [NAMES, 'NAMES'],
    [CHARGE_MODE_LABELS, 'CHARGE_MODE_LABELS'],
  ]) {
    for (const lang of LANGS) {
      if (
        JSON.stringify(sorted(Object.keys(table[lang]))) !==
        JSON.stringify(sorted(Object.keys(table.en)))
      ) {
        found.push(`${name}.${lang} does not have the keys of ${name}.en`);
      }
      for (const [key, text] of Object.entries(table[lang])) {
        found.push(...textProblems(text, `${name}.${lang}.${key}`, lang, MAX.featureName));
      }
    }
  }
  assert.deepEqual(found, []);
});

test('the four documentation files have the same sections', async () => {
  const outline = {};
  for (const lang of LANGS) {
    const text = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
    assert.ok(text.length > 3000, `docs/${lang}.md is too short`);
    assert.ok(text.includes('Renault / Dacia'), `docs/${lang}.md`);
    assert.match(text, /hacf-fr\/renault-api/, `docs/${lang}.md credits renault-api`);
    outline[lang] = {
      sections: text.split('\n').filter((line) => /^##? /.test(line)).length,
      tables: (text.match(/^\| ---/gm) ?? []).length,
      items: text.split('\n').filter((line) => /^(- |\d+\. )/.test(line)).length,
    };
    const de = lang === 'de' ? text : '';
    assert.ok(!POLITE_GERMAN.test(de), 'docs/de.md uses the polite form');
  }
  for (const lang of LANGS) assert.deepEqual(outline[lang], outline.en, `docs/${lang}.md`);
  assert.equal(outline.en.sections, 14);
});

test('the guard catches a missing language, an empty text and the wrong form of address', () => {
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: '', es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Auto', 'mit Ihrem Konto', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'Elige tu coche' }, 'x', 60).length, 1);
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.actions[2].fields[0].placeholder.de;
  assert.deepEqual(
    manifestTexts(forgotten).flatMap(({ path, value, max }) => problems(value, path, max)),
    ['manifest.actions[2].fields[0].placeholder has [en,fr,es], expected exactly [en,fr,de,es]'],
  );
});
