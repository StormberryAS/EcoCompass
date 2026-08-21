/**
 * EcoCompass · app.js
 * ================================================================
 * A fully client-side solar energy planner.
 * Libraries used:
 *   SunCalc (bundled locally, suncalc.js) for solar position maths.
 *
 * Key design decisions:
 *   1. All estimates come from a clear-sky irradiance model
 *      (Kasten-Young air mass + a simple atmospheric transmittance),
 *      scaled by a user-set sky-clearness factor. They are labelled
 *      as estimates everywhere; this is a planner, not a quotation.
 *   2. SunCalc returns azimuth in radians measured from SOUTH,
 *      positive towards WEST. We convert to a compass bearing
 *      (radians from North, clockwise) before any geometry.
 *   3. Days are integrated in approximate local solar time: the
 *      civil day starts at UTC midnight minus lon/15 hours. That
 *      keeps the maths timezone-free and accurate to well under an
 *      hour, which is plenty for an energy estimate.
 *   4. The pure model functions are DOM-free and exported for the
 *      node:test suite; the DOM layer only runs in a browser.
 * ================================================================
 */

'use strict';

const SunCalc = (typeof window !== 'undefined') ? window.SunCalc : require('./suncalc.js');

/* ================================================================
   SECTION 1 · CITY DATABASE
   Format: { name, country, lat, lon }
   Coverage: world majors on every continent, strong Nordic
   coverage, and all Brazilian state capitals.
================================================================ */
// The city catalogue lives in the shared cities.js, loaded by index.html
// before this file. Regenerate every app's copy with GitHub/update_cities.py.
// In Node (test.js requires this file directly) no <script> tag runs, so
// pull the catalogue in explicitly. Browsers skip this branch.
if (typeof CITIES === 'undefined' && typeof require === 'function') require('./cities.js');

/* ================================================================
   SECTION 2 · PURE MODEL FUNCTIONS (no DOM access)
================================================================ */

const toRad = deg => deg * Math.PI / 180;
const toDeg = rad => rad * 180 / Math.PI;

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
];

/** 16-point compass name for a bearing in degrees (0 = North). */
function compass16(deg) {
  const norm = ((deg % 360) + 360) % 360;
  return COMPASS_16[Math.round(norm / 22.5) % 16];
}

/**
 * Sun position as altitude + compass bearing.
 * SunCalc azimuth is radians measured from SOUTH, positive towards
 * WEST; convert to a compass bearing from North, clockwise.
 */
function sunPositionCompass(date, lat, lon) {
  const pos = SunCalc.getPosition(date, lat, lon);
  let compassRad = pos.azimuth + Math.PI;
  const TWO_PI = 2 * Math.PI;
  compassRad = ((compassRad % TWO_PI) + TWO_PI) % TWO_PI;
  return { altitude: pos.altitude, compassRad };
}

/** Kasten-Young (1989) relative air mass. Infinity below the horizon. */
function airMass(altitudeRad) {
  if (altitudeRad <= 0) return Infinity;
  const zDeg = 90 - toDeg(altitudeRad);
  return 1 / (Math.cos(toRad(zDeg)) + 0.50572 * Math.pow(96.07995 - zDeg, -1.6364));
}

/** Clear-sky direct normal irradiance (W/m2) for a given air mass. */
function clearSkyDNI(am) {
  if (!Number.isFinite(am)) return 0;
  return 1353 * Math.pow(0.7, Math.pow(am, 0.678));
}

/**
 * Plane-of-array irradiance (W/m2) on a tilted panel.
 * Simple isotropic-sky model with diffuse taken as 10% of DNI and
 * 0.2 ground albedo, scaled by the sky-clearness factor.
 */
function poaIrradiance(altitudeRad, sunCompassRad, tiltRad, panelCompassRad, clearness) {
  if (altitudeRad <= 0) return 0;
  const dni = clearSkyDNI(airMass(altitudeRad)) * clearness;
  const dhi = 0.1 * dni;
  const ghi = dni * Math.max(0, Math.sin(altitudeRad)) + dhi;
  const cosAOI = Math.sin(altitudeRad) * Math.cos(tiltRad) +
    Math.cos(altitudeRad) * Math.sin(tiltRad) * Math.cos(sunCompassRad - panelCompassRad);
  return dni * Math.max(0, cosAOI) +
    dhi * (1 + Math.cos(tiltRad)) / 2 +
    0.2 * ghi * (1 - Math.cos(tiltRad)) / 2;
}

/** Instantaneous DC-side power (W) for a configuration at a moment. */
function instantPowerW(date, cfg) {
  const sun = sunPositionCompass(date, cfg.lat, cfg.lon);
  const poa = poaIrradiance(sun.altitude, sun.compassRad, cfg.tiltRad, cfg.panelCompassRad, cfg.clearness);
  return poa * cfg.area * cfg.efficiency * (1 - cfg.losses);
}

/**
 * Energy for one calendar day.
 * `date` must be the UTC midnight of the calendar date. The
 * integration window starts lon/15 hours earlier, approximating the
 * location's civil day, and samples every 10 minutes for 24 hours.
 * Returns { kwh, points: [{ h, w }] } with h in approximate local hours.
 */
function dayEnergy(date, cfg) {
  const startMs = date.getTime() - (cfg.lon / 15) * 3600 * 1000;
  const stepMs = 10 * 60 * 1000;
  const points = [];
  let joules = 0;
  for (let i = 0; i <= 144; i++) {
    const w = instantPowerW(new Date(startMs + i * stepMs), cfg);
    points.push({ h: i / 6, w });
    if (i < 144) joules += w * 600; // each sample covers 10 minutes
  }
  return { kwh: joules / 3.6e6, points };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Annual energy: mid-month sample day (the 15th) scaled by the
 * number of days in each month.
 * Returns { annualKwh, monthly: [12 kWh values] }.
 */
function yearEnergy(year, cfg) {
  const monthly = [];
  let annualKwh = 0;
  for (let m = 0; m < 12; m++) {
    const sample = dayEnergy(new Date(Date.UTC(year, m, 15)), cfg);
    const monthKwh = sample.kwh * daysInMonth(year, m);
    monthly.push(monthKwh);
    annualKwh += monthKwh;
  }
  return { annualKwh, monthly };
}

/* ================================================================
   SECTION 3 · DOM LAYER (browser only)
================================================================ */
if (typeof document !== 'undefined') {

  const $ = id => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const els = {
    // Tabs
    tabCity: $('tab-city'),
    tabGps: $('tab-gps'),
    tabDevice: $('tab-device'),
    // Panels
    panelCity: $('panel-city'),
    panelGps: $('panel-gps'),
    panelDevice: $('panel-device'),
    // City search
    citySearch: $('city-search'),
    cityDropdown: $('city-dropdown'),
    citySelected: $('city-selected'),
    citySelectedText: $('city-selected-text'),
    cityClearBtn: $('city-clear-btn'),
    // GPS inputs
    latInput: $('lat-input'),
    lonInput: $('lon-input'),
    // Device panel
    getLocationBtn: $('get-location-btn'),
    deviceCoords: $('device-coords'),
    // Roof parameter sliders
    azimuthInput: $('azimuth-input'),
    tiltInput: $('tilt-input'),
    areaInput: $('area-input'),
    efficiencyInput: $('efficiency-input'),
    lossesInput: $('losses-input'),
    clearnessInput: $('clearness-input'),
    azimuthReadout: $('azimuth-readout'),
    tiltReadout: $('tilt-readout'),
    areaReadout: $('area-readout'),
    efficiencyReadout: $('efficiency-readout'),
    lossesReadout: $('losses-readout'),
    clearnessReadout: $('clearness-readout'),
    // Date + price
    dateInput: $('date-input'),
    priceInput: $('price-input'),
    currencySelect: $('currency-select'),
    // Calculate
    calculateBtn: $('calculate-btn'),
    errorMsg: $('error-msg'),
    // Scene
    sceneViewport: $('scene-viewport'),
    sceneWorld: $('scene-world'),
    house: $('house'),
    panelGrid: $('panel-grid'),
    sceneReadout: $('scene-readout'),
    // Results
    resultsCard: $('results-card'),
    resLocation: $('res-location'),
    resDate: $('res-date'),
    resSetup: $('res-setup'),
    resDayKwh: $('res-day-kwh'),
    resAnnualKwh: $('res-annual-kwh'),
    resSaving: $('res-saving'),
    hourlyChart: $('hourly-chart'),
    hourlyChartTitle: $('hourly-chart-title'),
    monthlyChart: $('monthly-chart'),
    monthlyChartTitle: $('monthly-chart-title'),
    reportBtn: $('report-btn'),
    // Print report
    reportGenerated: $('report-generated'),
    reportInputs: $('report-inputs'),
    reportResults: $('report-results'),
    reportMonthly: $('report-monthly')
  };

  const state = {
    activeTab: 'city',
    selectedCity: null,
    deviceCoords: null,
    matches: [],
    highlightIndex: -1,
    hasCalculated: false,
    last: null // { cfg, location, dateStr, day, year, yearNum }
  };

  /* ── Init ─────────────────────────────────────────────────── */

  function init() {
    // Set date picker to today's local date (YYYY-MM-DD format)
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    els.dateInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    // Tabs
    [els.tabCity, els.tabGps, els.tabDevice].forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // City search
    els.citySearch.addEventListener('input', debounce(onCityInput, 120));
    els.citySearch.addEventListener('keydown', onCityKeydown);
    els.cityClearBtn.addEventListener('click', clearCity);
    document.addEventListener('click', e => {
      if (!els.cityDropdown.hidden && !e.target.closest('.search-wrapper')) closeDropdown();
    });

    // Device geolocation
    els.getLocationBtn.addEventListener('click', requestDeviceLocation);

    // Sliders: live readouts + live 3D scene + live recompute
    const sliders = [
      els.azimuthInput, els.tiltInput, els.areaInput,
      els.efficiencyInput, els.lossesInput, els.clearnessInput
    ];
    sliders.forEach(s => s.addEventListener('input', onParamsChanged));

    // Date + price also live-update the results after first calculation
    els.dateInput.addEventListener('change', onParamsChanged);
    els.priceInput.addEventListener('input', onParamsChanged);
    els.currencySelect.addEventListener('change', onParamsChanged);

    // Calculate + report
    els.calculateBtn.addEventListener('click', calculate);
    els.reportBtn.addEventListener('click', generateReport);

    // Scene orbit drag
    initOrbitDrag();

    updateReadouts();
    updateScene();
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /* ── Tabs ─────────────────────────────────────────────────── */

  function switchTab(tabName) {
    state.activeTab = tabName;
    const map = {
      city: [els.tabCity, els.panelCity],
      gps: [els.tabGps, els.panelGps],
      device: [els.tabDevice, els.panelDevice]
    };
    for (const [name, [tab, panel]] of Object.entries(map)) {
      const active = name === tabName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    }
    hideError();
  }

  /* ── City search ──────────────────────────────────────────── */

  function onCityInput() {
    const q = els.citySearch.value.trim().toLowerCase();
    if (q.length < 2) { closeDropdown(); return; }

    // Match on name OR country, prioritise name-starts-with
    const starts = [];
    const contains = [];
    // Folded comparison so 'Herat' finds 'Her\u0101t'; foldQuery comes from cities.js.
    const qf = foldQuery(q);
    for (const city of CITIES) {
      const name = city.fold;
      const country = city.cfold;
      if (name.startsWith(qf)) starts.push(city);
      else if (name.includes(qf) || country.includes(qf)) contains.push(city);
    }
    state.matches = starts.concat(contains).slice(0, 8);
    state.highlightIndex = -1;

    renderDropdown();
  }

  function renderDropdown() {
    els.cityDropdown.textContent = '';
    if (state.matches.length === 0) { closeDropdown(); return; }

    state.matches.forEach((city, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'city-name';
      nameSpan.textContent = city.name;
      const countrySpan = document.createElement('span');
      countrySpan.className = 'city-country';
      countrySpan.textContent = city.country;
      li.append(nameSpan, countrySpan);
      li.addEventListener('click', () => selectCity(city));
      els.cityDropdown.appendChild(li);
    });
    els.cityDropdown.hidden = false;
    els.citySearch.setAttribute('aria-expanded', 'true');
  }

  function onCityKeydown(e) {
    if (els.cityDropdown.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(Math.min(state.highlightIndex + 1, state.matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(Math.max(state.highlightIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.highlightIndex >= 0) selectCity(state.matches[state.highlightIndex]);
      else if (state.matches.length > 0) selectCity(state.matches[0]);
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  }

  function setHighlight(index) {
    state.highlightIndex = index;
    [...els.cityDropdown.children].forEach((li, i) => {
      li.classList.toggle('highlighted', i === index);
      if (i === index) li.scrollIntoView({ block: 'nearest' });
    });
  }

  function selectCity(city) {
    state.selectedCity = city;
    els.citySearch.value = '';
    closeDropdown();
    els.citySelectedText.textContent = `${city.name}, ${city.country} (${city.lat.toFixed(4)}, ${city.lon.toFixed(4)})`;
    els.citySelected.hidden = false;
    hideError();
    if (state.hasCalculated) recompute();
  }

  function clearCity() {
    state.selectedCity = null;
    els.citySelected.hidden = true;
    els.citySearch.focus();
  }

  function closeDropdown() {
    els.cityDropdown.hidden = true;
    els.citySearch.setAttribute('aria-expanded', 'false');
    state.highlightIndex = -1;
  }

  /* ── Device geolocation ───────────────────────────────────── */

  function requestDeviceLocation() {
    if (!('geolocation' in navigator)) {
      showError('Geolocation is not supported by this browser. Use City Search or GPS Coords instead.');
      return;
    }
    els.getLocationBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.deviceCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        els.deviceCoords.textContent = `${state.deviceCoords.lat.toFixed(4)}, ${state.deviceCoords.lon.toFixed(4)}`;
        els.deviceCoords.hidden = false;
        els.getLocationBtn.disabled = false;
        hideError();
        if (state.hasCalculated) recompute();
      },
      err => {
        els.getLocationBtn.disabled = false;
        const reasons = {
          1: 'Location permission was denied. You can use City Search or GPS Coords instead.',
          2: 'Your position is currently unavailable. Try again, or use City Search.',
          3: 'The location request timed out. Try again, or use City Search.'
        };
        showError(reasons[err.code] || 'Could not read your location. Use City Search or GPS Coords instead.');
      },
      { timeout: 10000 }
    );
  }

  /* ── Errors ───────────────────────────────────────────────── */

  function showError(msg) {
    els.errorMsg.textContent = msg;
    els.errorMsg.hidden = false;
  }

  function hideError() {
    els.errorMsg.hidden = true;
  }

  /* ── Config + location readers ────────────────────────────── */

  function readParams() {
    return {
      azimuthDeg: Number(els.azimuthInput.value),
      tiltDeg: Number(els.tiltInput.value),
      area: Number(els.areaInput.value),
      efficiencyPct: Number(els.efficiencyInput.value),
      lossesPct: Number(els.lossesInput.value),
      clearnessPct: Number(els.clearnessInput.value)
    };
  }

  function getLocation() {
    if (state.activeTab === 'city') {
      if (!state.selectedCity) return { error: 'Choose a city first (type at least two letters and pick a suggestion).' };
      const c = state.selectedCity;
      return { lat: c.lat, lon: c.lon, label: `${c.name}, ${c.country}` };
    }
    if (state.activeTab === 'gps') {
      const lat = parseFloat(String(els.latInput.value).replace('−', '-').replace(',', '.'));
      const lon = parseFloat(String(els.lonInput.value).replace('−', '-').replace(',', '.'));
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: 'Latitude must be a number between −90 and 90.' };
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) return { error: 'Longitude must be a number between −180 and 180.' };
      return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
    }
    if (!state.deviceCoords) return { error: 'Press "Get My Location" first, or use City Search.' };
    return {
      lat: state.deviceCoords.lat,
      lon: state.deviceCoords.lon,
      label: `${state.deviceCoords.lat.toFixed(4)}, ${state.deviceCoords.lon.toFixed(4)}`
    };
  }

  /* ── Live readouts + 3D scene ─────────────────────────────── */

  function onParamsChanged() {
    updateReadouts();
    updateScene();
    if (state.hasCalculated) recompute();
  }

  function updateReadouts() {
    const p = readParams();
    els.azimuthReadout.textContent = `${p.azimuthDeg}° · ${compass16(p.azimuthDeg)}`;
    els.tiltReadout.textContent = `${p.tiltDeg}°`;
    els.areaReadout.textContent = `${p.area} m²`;
    els.efficiencyReadout.textContent = `${p.efficiencyPct}%`;
    els.lossesReadout.textContent = `${p.lossesPct}%`;
    els.clearnessReadout.textContent = `${p.clearnessPct}%`;
  }

  function updateScene() {
    const p = readParams();
    const tiltRad = toRad(p.tiltDeg);
    // Ridge rises so the eaves stay level with the wall tops
    const ridgeZ = 55 + 66 * Math.sin(tiltRad);
    els.house.style.setProperty('--az-deg', `${p.azimuthDeg}deg`);
    els.house.style.setProperty('--tilt-deg', `${p.tiltDeg}deg`);
    els.house.style.setProperty('--ridge-z', `${ridgeZ.toFixed(1)}px`);
    // Panel coverage scales gently with the configured area
    const scale = Math.min(1, 0.35 + 0.65 * Math.sqrt(p.area / 200));
    els.panelGrid.style.setProperty('--panel-scale', scale.toFixed(3));
    els.sceneReadout.textContent =
      `Facing ${compass16(p.azimuthDeg)} (${p.azimuthDeg}°) · Tilt ${p.tiltDeg}° · ${p.area} m²`;
  }

  function initOrbitDrag() {
    let dragging = false;
    let startX = 0;
    let baseOrbit = 0;
    let orbit = 0;
    els.sceneViewport.addEventListener('pointerdown', e => {
      dragging = true;
      startX = e.clientX;
      baseOrbit = orbit;
      els.sceneViewport.setPointerCapture(e.pointerId);
    });
    els.sceneViewport.addEventListener('pointermove', e => {
      if (!dragging) return;
      orbit = baseOrbit + (e.clientX - startX) * 0.4;
      els.sceneWorld.style.setProperty('--orbit', `${orbit.toFixed(1)}deg`);
    });
    const stop = () => { dragging = false; };
    els.sceneViewport.addEventListener('pointerup', stop);
    els.sceneViewport.addEventListener('pointercancel', stop);
  }

  /* ── Calculation flow ─────────────────────────────────────── */

  function calculate() {
    const loc = getLocation();
    if (loc.error) { showError(loc.error); return; }
    hideError();
    state.hasCalculated = true;
    runModel(loc);
  }

  function recompute() {
    const loc = getLocation();
    if (loc.error) return; // keep last results until the location is valid again
    runModel(loc);
  }

  function runModel(loc) {
    const p = readParams();
    const cfg = {
      lat: loc.lat,
      lon: loc.lon,
      tiltRad: toRad(p.tiltDeg),
      panelCompassRad: toRad(p.azimuthDeg),
      area: p.area,
      efficiency: p.efficiencyPct / 100,
      losses: p.lossesPct / 100,
      clearness: p.clearnessPct / 100
    };

    const dateStr = els.dateInput.value;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) { showError('Pick a valid date.'); return; }
    const dayDate = new Date(Date.UTC(y, m - 1, d));

    const day = dayEnergy(dayDate, cfg);
    const yearNum = y;
    const year = yearEnergy(yearNum, cfg);

    state.last = { cfg, p, loc, dateStr, dayDate, day, year, yearNum };
    renderResults();
  }

  /* ── Results rendering ────────────────────────────────────── */

  const fmtDateGB = date => date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });

  function fmtKwh(kwh) {
    if (kwh >= 100) return `${Math.round(kwh).toLocaleString('en-GB')} kWh`;
    return `${kwh.toFixed(1)} kWh`;
  }

  function fmtMoney(value, currency) {
    const rounded = Math.round(value).toLocaleString('en-GB');
    return currency === 'kr' ? `${rounded} kr` : `${currency}${rounded}`;
  }

  function renderResults() {
    const { p, loc, day, year, yearNum, dayDate } = state.last;
    const price = Math.max(0, parseFloat(String(els.priceInput.value).replace(',', '.')) || 0);
    const currency = els.currencySelect.value;

    els.resLocation.textContent = loc.label;
    els.resDate.textContent = fmtDateGB(dayDate);
    els.resSetup.textContent =
      `${compass16(p.azimuthDeg)} ${p.azimuthDeg}° · tilt ${p.tiltDeg}° · ${p.area} m²`;

    els.resDayKwh.textContent = fmtKwh(day.kwh);
    els.resAnnualKwh.textContent = fmtKwh(year.annualKwh);
    els.resSaving.textContent = fmtMoney(year.annualKwh * price, currency);

    els.hourlyChartTitle.textContent =
      `Generation curve, ${fmtDateGB(dayDate)} (local time, approx.)`;
    renderHourlyChart(day.points);

    els.monthlyChartTitle.textContent = `Monthly yield, ${yearNum} (kWh)`;
    renderMonthlyChart(year.monthly);

    els.resultsCard.hidden = false;
  }

  /* ── SVG charts (built with createElementNS, no innerHTML) ── */

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
  }

  function makeChartSvg(id) {
    const svg = svgEl('svg', { viewBox: '0 0 640 260', width: '100%' });
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#ffd700', 'stop-opacity': 0.85 }));
    grad.appendChild(svgEl('stop', { offset: '55%', 'stop-color': '#7ed957', 'stop-opacity': 0.55 }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#3fa34d', 'stop-opacity': 0.08 }));
    defs.appendChild(grad);
    svg.appendChild(defs);
    return svg;
  }

  function chartText(x, y, text, anchor, cls) {
    const t = svgEl('text', { x, y, 'text-anchor': anchor || 'middle', class: cls || 'chart-axis-label' });
    t.textContent = text;
    return t;
  }

  function renderHourlyChart(points) {
    els.hourlyChart.textContent = '';
    const svg = makeChartSvg('ecoAreaGrad');
    const L = 52, R = 620, T = 16, B = 224;
    const maxW = Math.max(1, ...points.map(pt => pt.w));
    const x = h => L + (h / 24) * (R - L);
    const yOf = w => B - (w / maxW) * (B - T);

    // Gridlines + y labels (0, half, max)
    const useKw = maxW >= 1000;
    const yLabel = w => useKw ? `${(w / 1000).toFixed(w === 0 ? 0 : 1)} kW` : `${Math.round(w)} W`;
    [0, maxW / 2, maxW].forEach(w => {
      svg.appendChild(svgEl('line', { x1: L, y1: yOf(w), x2: R, y2: yOf(w), class: 'chart-grid' }));
      svg.appendChild(chartText(L - 6, yOf(w) + 4, yLabel(w), 'end'));
    });

    // X axis labels every 6 hours
    for (let h = 0; h <= 24; h += 6) {
      svg.appendChild(chartText(x(h), B + 20, `${String(h).padStart(2, '0')}:00`));
    }

    // Area path
    let dArea = `M ${x(0)} ${B}`;
    let dLine = '';
    points.forEach((pt, i) => {
      const px = x(pt.h).toFixed(1);
      const py = yOf(pt.w).toFixed(1);
      dArea += ` L ${px} ${py}`;
      dLine += (i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`);
    });
    dArea += ` L ${x(24)} ${B} Z`;
    svg.appendChild(svgEl('path', { d: dArea, fill: 'url(#ecoAreaGrad)', stroke: 'none' }));
    svg.appendChild(svgEl('path', { d: dLine, fill: 'none', class: 'chart-line' }));

    els.hourlyChart.appendChild(svg);
  }

  function renderMonthlyChart(monthly) {
    els.monthlyChart.textContent = '';
    const svg = makeChartSvg('ecoBarGrad');
    const L = 52, R = 620, T = 16, B = 224;
    const labels = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    const maxV = Math.max(1, ...monthly);
    const slot = (R - L) / 12;
    const yOf = v => B - (v / maxV) * (B - T);

    [0, maxV / 2, maxV].forEach(v => {
      svg.appendChild(svgEl('line', { x1: L, y1: yOf(v), x2: R, y2: yOf(v), class: 'chart-grid' }));
      svg.appendChild(chartText(L - 6, yOf(v) + 4, `${Math.round(v).toLocaleString('en-GB')}`, 'end'));
    });

    monthly.forEach((v, i) => {
      const bx = L + i * slot + slot * 0.18;
      const bw = slot * 0.64;
      const by = yOf(v);
      const bar = svgEl('rect', {
        x: bx.toFixed(1), y: by.toFixed(1),
        width: bw.toFixed(1), height: Math.max(0, B - by).toFixed(1),
        rx: 3, fill: 'url(#ecoBarGrad)', class: 'chart-bar'
      });
      const title = svgEl('title');
      title.textContent = `${Math.round(v).toLocaleString('en-GB')} kWh`;
      bar.appendChild(title);
      svg.appendChild(bar);
      svg.appendChild(chartText(L + i * slot + slot / 2, B + 20, labels[i]));
    });

    els.monthlyChart.appendChild(svg);
  }

  /* ── PDF report (via the browser's print dialog) ──────────── */

  function tableRow(tbody, label, value) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = label;
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(th, td);
    tbody.appendChild(tr);
  }

  function generateReport() {
    if (!state.last) return;
    const { p, loc, day, year, yearNum, dayDate } = state.last;
    const price = Math.max(0, parseFloat(String(els.priceInput.value).replace(',', '.')) || 0);
    const currency = els.currencySelect.value;

    els.reportGenerated.textContent = `Generated ${fmtDateGB(new Date(Date.UTC(
      new Date().getFullYear(), new Date().getMonth(), new Date().getDate()
    )))}`;

    const inputsBody = els.reportInputs.querySelector('tbody');
    inputsBody.textContent = '';
    tableRow(inputsBody, 'Location', loc.label);
    tableRow(inputsBody, 'Date', fmtDateGB(dayDate));
    tableRow(inputsBody, 'Roof orientation', `${p.azimuthDeg}° (${compass16(p.azimuthDeg)})`);
    tableRow(inputsBody, 'Roof tilt', `${p.tiltDeg}°`);
    tableRow(inputsBody, 'Panel area', `${p.area} m²`);
    tableRow(inputsBody, 'Panel efficiency', `${p.efficiencyPct}%`);
    tableRow(inputsBody, 'System losses', `${p.lossesPct}%`);
    tableRow(inputsBody, 'Average sky clearness', `${p.clearnessPct}%`);
    tableRow(inputsBody, 'Electricity price', `${price.toFixed(2)} ${currency}/kWh`);

    const resultsBody = els.reportResults.querySelector('tbody');
    resultsBody.textContent = '';
    tableRow(resultsBody, `Estimated yield, ${fmtDateGB(dayDate)}`, fmtKwh(day.kwh));
    tableRow(resultsBody, `Estimated annual yield (${yearNum})`, fmtKwh(year.annualKwh));
    tableRow(resultsBody, 'Estimated annual saving', fmtMoney(year.annualKwh * price, currency));

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const thead = els.reportMonthly.querySelector('thead');
    const tbody = els.reportMonthly.querySelector('tbody');
    thead.textContent = '';
    tbody.textContent = '';
    const headRow = document.createElement('tr');
    const bodyRow = document.createElement('tr');
    monthNames.forEach((name, i) => {
      const th = document.createElement('th');
      th.textContent = name;
      headRow.appendChild(th);
      const td = document.createElement('td');
      td.textContent = Math.round(year.monthly[i]).toLocaleString('en-GB');
      bodyRow.appendChild(td);
    });
    thead.appendChild(headRow);
    tbody.appendChild(bodyRow);

    window.print();
  }

  init();
}

/* ================================================================
   SECTION 4 · EXPORTS (node:test suite)
================================================================ */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CITIES,
    toRad,
    toDeg,
    compass16,
    sunPositionCompass,
    airMass,
    clearSkyDNI,
    poaIrradiance,
    instantPowerW,
    dayEnergy,
    yearEnergy
  };
}
