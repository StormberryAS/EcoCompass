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
const CITIES = [
  // Nordics
  { name: "Oslo", country: "Norway", lat: 59.9139, lon: 10.7522 },
  { name: "Bergen", country: "Norway", lat: 60.3913, lon: 5.3221 },
  { name: "Trondheim", country: "Norway", lat: 63.4305, lon: 10.3951 },
  { name: "Stavanger", country: "Norway", lat: 58.9700, lon: 5.7331 },
  { name: "Tromsø", country: "Norway", lat: 69.6492, lon: 18.9553 },
  { name: "Kristiansand", country: "Norway", lat: 58.1599, lon: 8.0182 },
  { name: "Drammen", country: "Norway", lat: 59.7439, lon: 10.2045 },
  { name: "Askøy", country: "Norway", lat: 60.4054, lon: 5.2213 },
  { name: "Stockholm", country: "Sweden", lat: 59.3293, lon: 18.0686 },
  { name: "Gothenburg", country: "Sweden", lat: 57.7089, lon: 11.9746 },
  { name: "Malmö", country: "Sweden", lat: 55.6050, lon: 13.0038 },
  { name: "Copenhagen", country: "Denmark", lat: 55.6761, lon: 12.5683 },
  { name: "Aarhus", country: "Denmark", lat: 56.1629, lon: 10.2039 },
  { name: "Helsinki", country: "Finland", lat: 60.1699, lon: 24.9384 },
  { name: "Reykjavik", country: "Iceland", lat: 64.1466, lon: -21.9426 },
  { name: "Tórshavn", country: "Faroe Islands", lat: 62.0079, lon: -6.7716 },
  // Brazilian state capitals
  { name: "Rio Branco", country: "Brazil", lat: -9.9750, lon: -67.8243 },
  { name: "Maceió", country: "Brazil", lat: -9.6658, lon: -35.7353 },
  { name: "Macapá", country: "Brazil", lat: 0.0349, lon: -51.0694 },
  { name: "Manaus", country: "Brazil", lat: -3.1190, lon: -60.0217 },
  { name: "Salvador", country: "Brazil", lat: -12.9714, lon: -38.5014 },
  { name: "Fortaleza", country: "Brazil", lat: -3.7172, lon: -38.5433 },
  { name: "Brasília", country: "Brazil", lat: -15.7939, lon: -47.8828 },
  { name: "Vitória", country: "Brazil", lat: -20.3155, lon: -40.3128 },
  { name: "Goiânia", country: "Brazil", lat: -16.6869, lon: -49.2648 },
  { name: "São Luís", country: "Brazil", lat: -2.5307, lon: -44.3068 },
  { name: "Cuiabá", country: "Brazil", lat: -15.6014, lon: -56.0979 },
  { name: "Campo Grande", country: "Brazil", lat: -20.4697, lon: -54.6201 },
  { name: "Belo Horizonte", country: "Brazil", lat: -19.9167, lon: -43.9345 },
  { name: "Belém", country: "Brazil", lat: -1.4558, lon: -48.4902 },
  { name: "João Pessoa", country: "Brazil", lat: -7.1195, lon: -34.8450 },
  { name: "Curitiba", country: "Brazil", lat: -25.4284, lon: -49.2733 },
  { name: "Recife", country: "Brazil", lat: -8.0476, lon: -34.8770 },
  { name: "Teresina", country: "Brazil", lat: -5.0892, lon: -42.8019 },
  { name: "Rio de Janeiro", country: "Brazil", lat: -22.9068, lon: -43.1729 },
  { name: "Natal", country: "Brazil", lat: -5.7945, lon: -35.2110 },
  { name: "Porto Alegre", country: "Brazil", lat: -30.0346, lon: -51.2177 },
  { name: "Porto Velho", country: "Brazil", lat: -8.7612, lon: -63.9004 },
  { name: "Boa Vista", country: "Brazil", lat: 2.8235, lon: -60.6758 },
  { name: "Florianópolis", country: "Brazil", lat: -27.5954, lon: -48.5480 },
  { name: "São Paulo", country: "Brazil", lat: -23.5505, lon: -46.6333 },
  { name: "Aracaju", country: "Brazil", lat: -10.9472, lon: -37.0731 },
  { name: "Palmas", country: "Brazil", lat: -10.2491, lon: -48.3243 },
  // Europe
  { name: "London", country: "United Kingdom", lat: 51.5074, lon: -0.1278 },
  { name: "Edinburgh", country: "United Kingdom", lat: 55.9533, lon: -3.1883 },
  { name: "Manchester", country: "United Kingdom", lat: 53.4808, lon: -2.2426 },
  { name: "Dublin", country: "Ireland", lat: 53.3498, lon: -6.2603 },
  { name: "Paris", country: "France", lat: 48.8566, lon: 2.3522 },
  { name: "Marseille", country: "France", lat: 43.2965, lon: 5.3698 },
  { name: "Berlin", country: "Germany", lat: 52.5200, lon: 13.4050 },
  { name: "Munich", country: "Germany", lat: 48.1351, lon: 11.5820 },
  { name: "Hamburg", country: "Germany", lat: 53.5511, lon: 9.9937 },
  { name: "Frankfurt", country: "Germany", lat: 50.1109, lon: 8.6821 },
  { name: "Madrid", country: "Spain", lat: 40.4168, lon: -3.7038 },
  { name: "Barcelona", country: "Spain", lat: 41.3874, lon: 2.1686 },
  { name: "Seville", country: "Spain", lat: 37.3891, lon: -5.9845 },
  { name: "Lisbon", country: "Portugal", lat: 38.7223, lon: -9.1393 },
  { name: "Porto", country: "Portugal", lat: 41.1579, lon: -8.6291 },
  { name: "Rome", country: "Italy", lat: 41.9028, lon: 12.4964 },
  { name: "Milan", country: "Italy", lat: 45.4642, lon: 9.1900 },
  { name: "Naples", country: "Italy", lat: 40.8518, lon: 14.2681 },
  { name: "Amsterdam", country: "Netherlands", lat: 52.3676, lon: 4.9041 },
  { name: "Brussels", country: "Belgium", lat: 50.8503, lon: 4.3517 },
  { name: "Vienna", country: "Austria", lat: 48.2082, lon: 16.3738 },
  { name: "Zurich", country: "Switzerland", lat: 47.3769, lon: 8.5417 },
  { name: "Geneva", country: "Switzerland", lat: 46.2044, lon: 6.1432 },
  { name: "Warsaw", country: "Poland", lat: 52.2297, lon: 21.0122 },
  { name: "Prague", country: "Czechia", lat: 50.0755, lon: 14.4378 },
  { name: "Budapest", country: "Hungary", lat: 47.4979, lon: 19.0402 },
  { name: "Bucharest", country: "Romania", lat: 44.4268, lon: 26.1025 },
  { name: "Athens", country: "Greece", lat: 37.9838, lon: 23.7275 },
  { name: "Istanbul", country: "Turkey", lat: 41.0082, lon: 28.9784 },
  { name: "Kyiv", country: "Ukraine", lat: 50.4501, lon: 30.5234 },
  { name: "Moscow", country: "Russia", lat: 55.7558, lon: 37.6173 },
  { name: "Tallinn", country: "Estonia", lat: 59.4370, lon: 24.7536 },
  { name: "Riga", country: "Latvia", lat: 56.9496, lon: 24.1052 },
  { name: "Vilnius", country: "Lithuania", lat: 54.6872, lon: 25.2797 },
  // North America
  { name: "New York", country: "United States", lat: 40.7128, lon: -74.0060 },
  { name: "Los Angeles", country: "United States", lat: 34.0522, lon: -118.2437 },
  { name: "Chicago", country: "United States", lat: 41.8781, lon: -87.6298 },
  { name: "Houston", country: "United States", lat: 29.7604, lon: -95.3698 },
  { name: "Phoenix", country: "United States", lat: 33.4484, lon: -112.0740 },
  { name: "Denver", country: "United States", lat: 39.7392, lon: -104.9903 },
  { name: "Seattle", country: "United States", lat: 47.6062, lon: -122.3321 },
  { name: "San Francisco", country: "United States", lat: 37.7749, lon: -122.4194 },
  { name: "Miami", country: "United States", lat: 25.7617, lon: -80.1918 },
  { name: "Boston", country: "United States", lat: 42.3601, lon: -71.0589 },
  { name: "Washington", country: "United States", lat: 38.9072, lon: -77.0369 },
  { name: "Atlanta", country: "United States", lat: 33.7490, lon: -84.3880 },
  { name: "Dallas", country: "United States", lat: 32.7767, lon: -96.7970 },
  { name: "Toronto", country: "Canada", lat: 43.6532, lon: -79.3832 },
  { name: "Vancouver", country: "Canada", lat: 49.2827, lon: -123.1207 },
  { name: "Montreal", country: "Canada", lat: 45.5019, lon: -73.5674 },
  { name: "Calgary", country: "Canada", lat: 51.0447, lon: -114.0719 },
  { name: "Mexico City", country: "Mexico", lat: 19.4326, lon: -99.1332 },
  { name: "Guadalajara", country: "Mexico", lat: 20.6597, lon: -103.3496 },
  { name: "Monterrey", country: "Mexico", lat: 25.6866, lon: -100.3161 },
  // Latin America and the Caribbean
  { name: "Buenos Aires", country: "Argentina", lat: -34.6037, lon: -58.3816 },
  { name: "Santiago", country: "Chile", lat: -33.4489, lon: -70.6693 },
  { name: "Lima", country: "Peru", lat: -12.0464, lon: -77.0428 },
  { name: "Bogotá", country: "Colombia", lat: 4.7110, lon: -74.0721 },
  { name: "Quito", country: "Ecuador", lat: -0.1807, lon: -78.4678 },
  { name: "Caracas", country: "Venezuela", lat: 10.4806, lon: -66.9036 },
  { name: "Montevideo", country: "Uruguay", lat: -34.9011, lon: -56.1645 },
  { name: "Asunción", country: "Paraguay", lat: -25.2637, lon: -57.5759 },
  { name: "La Paz", country: "Bolivia", lat: -16.4897, lon: -68.1193 },
  { name: "Panama City", country: "Panama", lat: 8.9824, lon: -79.5199 },
  { name: "Havana", country: "Cuba", lat: 23.1136, lon: -82.3666 },
  { name: "San José", country: "Costa Rica", lat: 9.9281, lon: -84.0907 },
  // Asia
  { name: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503 },
  { name: "Osaka", country: "Japan", lat: 34.6937, lon: 135.5023 },
  { name: "Seoul", country: "South Korea", lat: 37.5665, lon: 126.9780 },
  { name: "Beijing", country: "China", lat: 39.9042, lon: 116.4074 },
  { name: "Shanghai", country: "China", lat: 31.2304, lon: 121.4737 },
  { name: "Hong Kong", country: "China", lat: 22.3193, lon: 114.1694 },
  { name: "Taipei", country: "Taiwan", lat: 25.0330, lon: 121.5654 },
  { name: "Singapore", country: "Singapore", lat: 1.3521, lon: 103.8198 },
  { name: "Bangkok", country: "Thailand", lat: 13.7563, lon: 100.5018 },
  { name: "Kuala Lumpur", country: "Malaysia", lat: 3.1390, lon: 101.6869 },
  { name: "Jakarta", country: "Indonesia", lat: -6.2088, lon: 106.8456 },
  { name: "Manila", country: "Philippines", lat: 14.5995, lon: 120.9842 },
  { name: "Hanoi", country: "Vietnam", lat: 21.0285, lon: 105.8542 },
  { name: "Ho Chi Minh City", country: "Vietnam", lat: 10.8231, lon: 106.6297 },
  { name: "Mumbai", country: "India", lat: 19.0760, lon: 72.8777 },
  { name: "Delhi", country: "India", lat: 28.7041, lon: 77.1025 },
  { name: "Bengaluru", country: "India", lat: 12.9716, lon: 77.5946 },
  { name: "Chennai", country: "India", lat: 13.0827, lon: 80.2707 },
  { name: "Kolkata", country: "India", lat: 22.5726, lon: 88.3639 },
  { name: "Karachi", country: "Pakistan", lat: 24.8607, lon: 67.0011 },
  { name: "Lahore", country: "Pakistan", lat: 31.5204, lon: 74.3587 },
  { name: "Dhaka", country: "Bangladesh", lat: 23.8103, lon: 90.4125 },
  { name: "Colombo", country: "Sri Lanka", lat: 6.9271, lon: 79.8612 },
  { name: "Kathmandu", country: "Nepal", lat: 27.7172, lon: 85.3240 },
  { name: "Almaty", country: "Kazakhstan", lat: 43.2220, lon: 76.8512 },
  { name: "Tashkent", country: "Uzbekistan", lat: 41.2995, lon: 69.2401 },
  // Middle East
  { name: "Dubai", country: "United Arab Emirates", lat: 25.2048, lon: 55.2708 },
  { name: "Abu Dhabi", country: "United Arab Emirates", lat: 24.4539, lon: 54.3773 },
  { name: "Doha", country: "Qatar", lat: 25.2854, lon: 51.5310 },
  { name: "Riyadh", country: "Saudi Arabia", lat: 24.7136, lon: 46.6753 },
  { name: "Jeddah", country: "Saudi Arabia", lat: 21.4858, lon: 39.1925 },
  { name: "Tel Aviv", country: "Israel", lat: 32.0853, lon: 34.7818 },
  { name: "Jerusalem", country: "Israel", lat: 31.7683, lon: 35.2137 },
  { name: "Amman", country: "Jordan", lat: 31.9454, lon: 35.9284 },
  { name: "Beirut", country: "Lebanon", lat: 33.8938, lon: 35.5018 },
  { name: "Tehran", country: "Iran", lat: 35.6892, lon: 51.3890 },
  { name: "Baghdad", country: "Iraq", lat: 33.3152, lon: 44.3661 },
  { name: "Kuwait City", country: "Kuwait", lat: 29.3759, lon: 47.9774 },
  // Africa
  { name: "Cairo", country: "Egypt", lat: 30.0444, lon: 31.2357 },
  { name: "Lagos", country: "Nigeria", lat: 6.5244, lon: 3.3792 },
  { name: "Abuja", country: "Nigeria", lat: 9.0765, lon: 7.3986 },
  { name: "Nairobi", country: "Kenya", lat: -1.2921, lon: 36.8219 },
  { name: "Addis Ababa", country: "Ethiopia", lat: 9.0250, lon: 38.7469 },
  { name: "Accra", country: "Ghana", lat: 5.6037, lon: -0.1870 },
  { name: "Dakar", country: "Senegal", lat: 14.7167, lon: -17.4677 },
  { name: "Casablanca", country: "Morocco", lat: 33.5731, lon: -7.5898 },
  { name: "Marrakesh", country: "Morocco", lat: 31.6295, lon: -7.9811 },
  { name: "Tunis", country: "Tunisia", lat: 36.8065, lon: 10.1815 },
  { name: "Algiers", country: "Algeria", lat: 36.7538, lon: 3.0588 },
  { name: "Johannesburg", country: "South Africa", lat: -26.2041, lon: 28.0473 },
  { name: "Cape Town", country: "South Africa", lat: -33.9249, lon: 18.4241 },
  { name: "Durban", country: "South Africa", lat: -29.8587, lon: 31.0218 },
  { name: "Kinshasa", country: "DR Congo", lat: -4.4419, lon: 15.2663 },
  { name: "Luanda", country: "Angola", lat: -8.8390, lon: 13.2894 },
  { name: "Maputo", country: "Mozambique", lat: -25.9692, lon: 32.5732 },
  { name: "Dar es Salaam", country: "Tanzania", lat: -6.7924, lon: 39.2083 },
  { name: "Kampala", country: "Uganda", lat: 0.3476, lon: 32.5825 },
  // Oceania
  { name: "Sydney", country: "Australia", lat: -33.8688, lon: 151.2093 },
  { name: "Melbourne", country: "Australia", lat: -37.8136, lon: 144.9631 },
  { name: "Brisbane", country: "Australia", lat: -27.4698, lon: 153.0251 },
  { name: "Perth", country: "Australia", lat: -31.9505, lon: 115.8605 },
  { name: "Adelaide", country: "Australia", lat: -34.9285, lon: 138.6007 },
  { name: "Canberra", country: "Australia", lat: -35.2809, lon: 149.1300 },
  { name: "Auckland", country: "New Zealand", lat: -36.8485, lon: 174.7633 },
  { name: "Wellington", country: "New Zealand", lat: -41.2865, lon: 174.7762 }
];

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
    for (const city of CITIES) {
      const name = city.name.toLowerCase();
      const country = city.country.toLowerCase();
      if (name.startsWith(q)) starts.push(city);
      else if (name.includes(q) || country.includes(q)) contains.push(city);
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
