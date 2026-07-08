/**
 * EcoCompass · test.js
 * Model tests for the pure functions in app.js.
 * Run with: node --test test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  toRad,
  compass16,
  airMass,
  clearSkyDNI,
  poaIrradiance,
  dayEnergy,
  yearEnergy
} = require('./app.js');

const OSLO = { lat: 59.91, lon: 10.75 };
const SYDNEY = { lat: -33.87, lon: 151.21 };

function cfg(lat, lon, azimuthDeg, tiltDeg, overrides) {
  return Object.assign({
    lat,
    lon,
    tiltRad: toRad(tiltDeg),
    panelCompassRad: toRad(azimuthDeg),
    area: 20,
    efficiency: 0.20,
    losses: 0.14,
    clearness: 1.0
  }, overrides || {});
}

test('airMass at zenith (altitude 90 degrees) is close to 1', () => {
  const am = airMass(toRad(90));
  assert.ok(Math.abs(am - 1) < 0.01, `expected ~1, got ${am}`);
});

test('airMass below the horizon is non-finite', () => {
  assert.ok(!Number.isFinite(airMass(toRad(-5))));
  assert.ok(!Number.isFinite(airMass(0)));
});

test('clear-sky DNI at air mass 1 is within [900, 1100] W/m2', () => {
  const dni = clearSkyDNI(1);
  assert.ok(dni >= 900 && dni <= 1100, `got ${dni}`);
});

test('poaIrradiance is 0 at night (sun below horizon)', () => {
  const poa = poaIrradiance(toRad(-10), toRad(0), toRad(35), toRad(180), 1.0);
  assert.strictEqual(poa, 0);
});

test('cosAOI geometry: south panel tilted 50 degrees beats flat when sun is due south at 40 degrees altitude', () => {
  const alt = toRad(40);
  const sunCompass = toRad(180);
  const tilted = poaIrradiance(alt, sunCompass, toRad(50), toRad(180), 1.0);
  const flat = poaIrradiance(alt, sunCompass, toRad(0), toRad(180), 1.0);
  assert.ok(tilted > flat, `tilted ${tilted} should exceed flat ${flat}`);
});

test('Oslo, 15 June, south-facing 35 degrees, 20 m2: day energy between 8 and 30 kWh', () => {
  const day = dayEnergy(new Date(Date.UTC(2026, 5, 15)), cfg(OSLO.lat, OSLO.lon, 180, 35));
  assert.ok(day.kwh > 8 && day.kwh < 30, `got ${day.kwh}`);
});

test('Oslo, 15 December: much smaller than June (under 20 percent)', () => {
  const c = cfg(OSLO.lat, OSLO.lon, 180, 35);
  const june = dayEnergy(new Date(Date.UTC(2026, 5, 15)), c);
  const december = dayEnergy(new Date(Date.UTC(2026, 11, 15)), c);
  assert.ok(december.kwh < 0.2 * june.kwh, `dec ${december.kwh} vs jun ${june.kwh}`);
});

test('Oslo: annual south-facing yield exceeds north-facing', () => {
  const south = yearEnergy(2026, cfg(OSLO.lat, OSLO.lon, 180, 35));
  const north = yearEnergy(2026, cfg(OSLO.lat, OSLO.lon, 0, 35));
  assert.ok(south.annualKwh > north.annualKwh,
    `south ${south.annualKwh} should exceed north ${north.annualKwh}`);
});

test('yearEnergy returns 12 finite non-negative monthly values', () => {
  const year = yearEnergy(2026, cfg(OSLO.lat, OSLO.lon, 180, 35));
  assert.strictEqual(year.monthly.length, 12);
  for (const v of year.monthly) {
    assert.ok(Number.isFinite(v) && v >= 0, `bad monthly value ${v}`);
  }
  assert.ok(Number.isFinite(year.annualKwh) && year.annualKwh >= 0);
});

test('southern hemisphere: Sydney north-facing beats south-facing annually', () => {
  const north = yearEnergy(2026, cfg(SYDNEY.lat, SYDNEY.lon, 0, 30));
  const south = yearEnergy(2026, cfg(SYDNEY.lat, SYDNEY.lon, 180, 30));
  assert.ok(north.annualKwh > south.annualKwh,
    `north ${north.annualKwh} should exceed south ${south.annualKwh}`);
});

test('compass16 maps bearings to the correct 16-point names', () => {
  assert.strictEqual(compass16(0), 'N');
  assert.strictEqual(compass16(90), 'E');
  assert.strictEqual(compass16(180), 'S');
  assert.strictEqual(compass16(270), 'W');
  assert.strictEqual(compass16(22.5), 'NNE');
  assert.strictEqual(compass16(359), 'N');
});

test('polar night: Tromsø on 15 December yields ~0 kWh with no NaN points', () => {
  const day = dayEnergy(new Date(Date.UTC(2026, 11, 15)), cfg(69.6492, 18.9553, 180, 35));
  assert.ok(Number.isFinite(day.kwh));
  assert.ok(day.kwh < 0.5, `got ${day.kwh}`);
  assert.strictEqual(day.points.length, 145);
  for (const pt of day.points) assert.ok(Number.isFinite(pt.w) && pt.w >= 0);
});
