// The model and the page, run as the page runs them (tests/vm-page.ts): suncalc.js, cities.js, then
// the compiled app.js.
//
// The first part is the old test.js (the model and input-parsing tests for the pure functions),
// ported with every assertion as it was: the model is loaded with no document, as test.js loaded
// app.js in Node, and each function is called in the page's global scope.
//
// The second part runs the page on a stub of index.html with the clock fixed at 5 November 2026
// 12:00 in Oslo. The expected values are what the JavaScript before the move to TypeScript
// (commit 718d619) showed at that instant.

process.env.TZ = 'Europe/Oslo';

import { test } from 'node:test';
import assert from 'node:assert';
import { loadModel, loadPage, type Page } from './vm-page.ts';

const root = new URL('../', import.meta.url);
const model = loadModel(root);
const { number, numbers, text } = model;

const OSLO = { lat: 59.91, lon: 10.75 };
const SYDNEY = { lat: -33.87, lon: 151.21 };

/** A configuration as test.js built it, as an expression for the page's scope (toRad is the page's). */
function cfg(lat: number, lon: number, azimuthDeg: number, tiltDeg: number): string {
  return `{ lat: ${lat}, lon: ${lon}, tiltRad: toRad(${tiltDeg}), panelCompassRad: toRad(${azimuthDeg}), area: 20, efficiency: 0.20, losses: 0.14, clearness: 1.0 }`;
}
/** new Date(Date.UTC(year, month, day)), in the page's scope. */
const utc = (year: number, month: number, day: number): string => `new Date(Date.UTC(${year}, ${month}, ${day}))`;
/** parseDecimal in the page's scope; text is a string or null. */
const parseDecimal = (s: string | null, min: number, max: number): unknown => model.run(`parseDecimal(${JSON.stringify(s)}, ${min}, ${max})`);

/* ── The old test.js ─────────────────────────────────────────── */

test('airMass at zenith (altitude 90 degrees) is close to 1', () => {
  const am = number('airMass(toRad(90))');
  assert.ok(Math.abs(am - 1) < 0.01, `expected ~1, got ${am}`);
});

test('airMass below the horizon is non-finite', () => {
  assert.ok(!Number.isFinite(number('airMass(toRad(-5))')));
  assert.ok(!Number.isFinite(number('airMass(0)')));
});

test('clear-sky DNI at air mass 1 is within [900, 1100] W/m2', () => {
  const dni = number('clearSkyDNI(1)');
  assert.ok(dni >= 900 && dni <= 1100, `got ${dni}`);
});

test('poaIrradiance is 0 at night (sun below horizon)', () => {
  const poa = number('poaIrradiance(toRad(-10), toRad(0), toRad(35), toRad(180), 1.0)');
  assert.strictEqual(poa, 0);
});

test('cosAOI geometry: south panel tilted 50 degrees beats flat when sun is due south at 40 degrees altitude', () => {
  const alt = 'toRad(40)';
  const sunCompass = 'toRad(180)';
  const tilted = number(`poaIrradiance(${alt}, ${sunCompass}, toRad(50), toRad(180), 1.0)`);
  const flat = number(`poaIrradiance(${alt}, ${sunCompass}, toRad(0), toRad(180), 1.0)`);
  assert.ok(tilted > flat, `tilted ${tilted} should exceed flat ${flat}`);
});

test('Oslo, 15 June, south-facing 35 degrees, 20 m2: day energy between 8 and 30 kWh', () => {
  const day = { kwh: number(`dayEnergy(${utc(2026, 5, 15)}, ${cfg(OSLO.lat, OSLO.lon, 180, 35)}).kwh`) };
  assert.ok(day.kwh > 8 && day.kwh < 30, `got ${day.kwh}`);
});

test('Oslo, 15 December: much smaller than June (under 20 percent)', () => {
  const c = cfg(OSLO.lat, OSLO.lon, 180, 35);
  const june = { kwh: number(`dayEnergy(${utc(2026, 5, 15)}, ${c}).kwh`) };
  const december = { kwh: number(`dayEnergy(${utc(2026, 11, 15)}, ${c}).kwh`) };
  assert.ok(december.kwh < 0.2 * june.kwh, `dec ${december.kwh} vs jun ${june.kwh}`);
});

test('Oslo: annual south-facing yield exceeds north-facing', () => {
  const south = { annualKwh: number(`yearEnergy(2026, ${cfg(OSLO.lat, OSLO.lon, 180, 35)}).annualKwh`) };
  const north = { annualKwh: number(`yearEnergy(2026, ${cfg(OSLO.lat, OSLO.lon, 0, 35)}).annualKwh`) };
  assert.ok(south.annualKwh > north.annualKwh,
    `south ${south.annualKwh} should exceed north ${north.annualKwh}`);
});

test('yearEnergy returns 12 finite non-negative monthly values', () => {
  const c = cfg(OSLO.lat, OSLO.lon, 180, 35);
  const year = { monthly: numbers(`yearEnergy(2026, ${c}).monthly`), annualKwh: number(`yearEnergy(2026, ${c}).annualKwh`) };
  assert.strictEqual(year.monthly.length, 12);
  for (const v of year.monthly) {
    assert.ok(Number.isFinite(v) && v >= 0, `bad monthly value ${v}`);
  }
  assert.ok(Number.isFinite(year.annualKwh) && year.annualKwh >= 0);
});

test('southern hemisphere: Sydney north-facing beats south-facing annually', () => {
  const north = { annualKwh: number(`yearEnergy(2026, ${cfg(SYDNEY.lat, SYDNEY.lon, 0, 30)}).annualKwh`) };
  const south = { annualKwh: number(`yearEnergy(2026, ${cfg(SYDNEY.lat, SYDNEY.lon, 180, 30)}).annualKwh`) };
  assert.ok(north.annualKwh > south.annualKwh,
    `north ${north.annualKwh} should exceed south ${south.annualKwh}`);
});

test('compass16 maps bearings to the correct 16-point names', () => {
  assert.strictEqual(text('compass16(0)'), 'N');
  assert.strictEqual(text('compass16(90)'), 'E');
  assert.strictEqual(text('compass16(180)'), 'S');
  assert.strictEqual(text('compass16(270)'), 'W');
  assert.strictEqual(text('compass16(22.5)'), 'NNE');
  assert.strictEqual(text('compass16(359)'), 'N');
});

test('polar night: Tromsø on 15 December yields ~0 kWh with no NaN points', () => {
  const run = `dayEnergy(${utc(2026, 11, 15)}, ${cfg(69.6492, 18.9553, 180, 35)})`;
  const day = { kwh: number(`${run}.kwh`), points: numbers(`${run}.points.map((pt) => pt.w)`).map((w) => ({ w })) };
  assert.ok(Number.isFinite(day.kwh));
  assert.ok(day.kwh < 0.5, `got ${day.kwh}`);
  assert.strictEqual(day.points.length, 145);
  for (const pt of day.points) assert.ok(Number.isFinite(pt.w) && pt.w >= 0);
});

/* ── Typed numbers: the shared Labs parser ─────────────────────── */

test('parseDecimal: a decimal comma is a decimal point', () => {
  assert.strictEqual(parseDecimal('60,39', -90, 90), 60.39);
  assert.strictEqual(parseDecimal('6,5', -90, 90), 6.5); // not 65
  assert.strictEqual(parseDecimal('1,5', 0, 100), 1.5); // a price, not 15
});

test('parseDecimal: a Unicode minus is a minus', () => {
  assert.strictEqual(parseDecimal('\u22125,3', -180, 180), -5.3);
  assert.strictEqual(parseDecimal('\u22125.32', -180, 180), -5.32); // was read as +5.32
});

test('parseDecimal: a point still works, with spaces trimmed', () => {
  assert.strictEqual(parseDecimal('60.39', -90, 90), 60.39);
  assert.strictEqual(parseDecimal(' 5.32 ', -180, 180), 5.32);
  assert.strictEqual(parseDecimal('1.50', 0, 100), 1.5);
});

test('parseDecimal: out of range, text and blanks are refused', () => {
  assert.strictEqual(parseDecimal('91', -90, 90), null);
  assert.strictEqual(parseDecimal('-181', -180, 180), null);
  assert.strictEqual(parseDecimal('-1', 0, 100), null); // no negative price
  assert.strictEqual(parseDecimal('abc', -90, 90), null);
  assert.strictEqual(parseDecimal('', 0, 100), null);
  assert.strictEqual(parseDecimal(null, 0, 100), null);
  assert.strictEqual(parseDecimal('1.234,5', 0, 100), null); // a thousands separator is not guessed
  assert.strictEqual(parseDecimal('60,39,1', -90, 90), null);
});

/* ── The page (a stub of index.html), each value as the old app.js showed it ── */

const NOW = Date.parse('2026-11-05T11:00:00Z');
/** The text, the hidden flag, the value and an attribute of an element of the stub page. */
const get = (page: Page, id: string, what: 'textContent' | 'hidden' | 'value' | 'className'): string =>
  String(page.run(`document.getElementById(${JSON.stringify(id)}).${what}`));
const attr = (page: Page, id: string, name: string): string => String(page.run(`document.getElementById(${JSON.stringify(id)}).getAttribute(${JSON.stringify(name)})`));
const rows = (page: Page): string => String(page.run("document.getElementById('city-dropdown').children.map((li) => li.textContent + (li.className ? ' [' + li.className + ']' : '')).join(' | ')"));
const results = (page: Page): string[] => ['res-location', 'res-date', 'res-setup', 'res-day-kwh', 'res-annual-kwh', 'res-saving', 'price-echo'].map((id) => get(page, id, 'textContent'));

test('page load: today in the date field, the readouts and the roof scene, no result', () => {
  const page = loadPage(root, NOW);
  assert.deepStrictEqual(
    [get(page, 'date-input', 'value'), get(page, 'azimuth-readout', 'textContent'), get(page, 'scene-readout', 'textContent'), get(page, 'results-card', 'hidden')],
    ['2026-11-05', '180° · S', 'Facing S (180°) · Tilt 35° · 20 m²', 'true']);
  assert.strictEqual(String(page.run("document.getElementById('house').style.text() + ' ' + document.getElementById('panel-grid').style.text()")),
    '--az-deg: 180deg; --tilt-deg: 35deg; --ridge-z: 92.9px; --panel-scale: 0.556;');
});

test('the city search: at most 8 rows, prefix matches first; the keys move, Enter picks', () => {
  const page = loadPage(root, NOW);
  page.type('city-search', 'berg');
  assert.strictEqual(rows(page), 'BergeracFrance | BergedorfGermany | BergheimGermany | Bergisch GladbachGermany | BergkamenGermany | BergamoItaly | BergenNorway | BergenThe Netherlands');
  assert.strictEqual(attr(page, 'city-search', 'aria-expanded'), 'true');
  page.key('ArrowDown'); page.key('ArrowDown');
  assert.strictEqual(rows(page), 'BergeracFrance | BergedorfGermany [highlighted] | BergheimGermany | Bergisch GladbachGermany | BergkamenGermany | BergamoItaly | BergenNorway | BergenThe Netherlands');
  assert.deepStrictEqual(page.state().scrolled, ['BergeracFrance', 'BergedorfGermany']);
  page.key('Enter');
  assert.deepStrictEqual([get(page, 'city-selected-text', 'textContent'), get(page, 'city-selected', 'hidden'), get(page, 'city-dropdown', 'hidden'), get(page, 'city-search', 'value')],
    ['Bergedorf, Germany (53.4846, 10.2290)', 'false', 'true', '']);
});

test('Oslo: the estimate, the charts\' titles and the monthly bars', () => {
  const page = loadPage(root, NOW);
  page.type('city-search', 'oslo'); page.key('Enter'); page.click('calculate-btn');
  assert.deepStrictEqual(results(page), ['Oslo, Norway', '5 November 2026', 'S 180° · tilt 35° · 20 m²', '5.3 kWh', '4,116 kWh', '6,174 kr', 'Using 1.5 kr per kWh']);
  assert.deepStrictEqual([get(page, 'hourly-chart-title', 'textContent'), get(page, 'monthly-chart-title', 'textContent'), get(page, 'results-card', 'hidden')],
    ['Generation curve, 5 November 2026 (local time, approx.)', 'Monthly yield, 2026 (kWh)', 'false']);
  assert.strictEqual(get(page, 'monthly-chart', 'textContent'), '028657288 kWhJ186 kWhF344 kWhM457 kWhA551 kWhM566 kWhJ572 kWhJ513 kWhA392 kWhS265 kWhO122 kWhN60 kWhD');
});

test('the price: an unreadable one holds the saving and the report; a decimal comma and the currency count', () => {
  const page = loadPage(root, NOW);
  page.type('city-search', 'oslo'); page.key('Enter'); page.click('calculate-btn');
  page.type('price-input', 'abc');
  assert.deepStrictEqual([get(page, 'res-saving', 'textContent'), get(page, 'res-saving', 'className'), get(page, 'price-echo', 'hidden'), get(page, 'price-error', 'hidden')],
    ['Check the price', 'sun-time-value mono is-pending', 'true', 'true']);
  page.click('report-btn');
  assert.deepStrictEqual([get(page, 'price-error', 'textContent'), page.state().focus, page.state().prints],
    ['Enter a price between 0 and 100, such as 1.50 or 1,50.', 'price-input', 0]);
  page.type('price-input', '1,25'); page.change('currency-select', '€');
  assert.deepStrictEqual([get(page, 'res-saving', 'textContent'), get(page, 'price-echo', 'textContent')], ['€5,145', 'Using €1.25 per kWh']);
  page.click('report-btn');
  assert.strictEqual(page.state().prints, 1);
  assert.deepStrictEqual(['report-generated', 'report-inputs', 'report-results', 'report-monthly'].map((id) => get(page, id, 'textContent')), [
    'Generated 5 November 2026',
    'LocationOslo, NorwayDate5 November 2026Roof orientation180° (S)Roof tilt35°Panel area20 m²Panel efficiency20%System losses14%Average sky clearness65%Electricity price1.25 €/kWh',
    'Estimated yield, 5 November 20265.3 kWhEstimated annual yield (2026)4,116 kWhEstimated annual saving€5,145',
    'JanFebMarAprMayJunJulAugSepOctNovDec8818634445755156657251339226512260',
  ]);
});

test('typed coordinates: messages for blanks, a decimal comma and a Unicode minus, the "Using" line', () => {
  const page = loadPage(root, NOW);
  page.click('tab-gps'); page.click('calculate-btn');
  assert.deepStrictEqual([get(page, 'lat-error', 'textContent'), get(page, 'lon-error', 'textContent'), page.state().focus, get(page, 'results-card', 'hidden'), attr(page, 'lat-input', 'aria-invalid')],
    ['Enter a latitude between -90 and 90, such as 60.39 or 60,39.', 'Enter a longitude between -180 and 180, such as 5.32 or 5,32.', 'lat-input', 'true', 'true']);
  page.type('lat-input', '60,39'); page.type('lon-input', '\u22125,32'); page.click('calculate-btn');
  assert.deepStrictEqual([get(page, 'gps-echo', 'textContent'), get(page, 'res-location', 'textContent'), get(page, 'res-annual-kwh', 'textContent'), get(page, 'lat-error', 'hidden')],
    ['Using 60.39, -5.32', '60.3900, -5.3200', '4,077 kWh', 'true']);
});
