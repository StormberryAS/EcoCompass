# EcoCompass

Privacy-first solar energy planner. EcoCompass estimates daily and annual rooftop solar generation for any location on Earth, driven by roof orientation, tilt, panel area and system parameters, with an interactive 3D roof visualiser and a printable report.

**Live:** [eco.stormberry.as](https://eco.stormberry.as)

## Features
- **City search**: rapid, offline autocomplete for major cities worldwide, with strong Nordic and Brazilian coverage.
- **Manual GPS input**: plan a roof at any arbitrary point on the globe. A decimal comma works as well as a point (`60,39` or `60.39`), and so does a typographic minus; anything out of range is refused with a message rather than computed.
- **Interactive 3D roof model**: a glass-styled house built entirely with CSS 3D transforms; the roof pitches and rotates live as you move the tilt and orientation sliders.
- **Clear-sky energy model**: Kasten-Young air mass, clear-sky irradiance and plane-of-array geometry, scaled by a user-set sky-clearness factor. Estimates are clearly labelled as clear-sky model estimates, not quotations.
- **Energy graphs**: hourly generation curve for the selected date and a monthly yield bar chart, rendered as inline SVG.
- **Savings projection**: annual saving from your electricity price, in kr, €, £ or $. The price takes a decimal comma too (`1,50`), and the value used is shown back under the field.
- **Printable report**: one click opens your browser's print dialog with a clean, white-background summary; choose Save as PDF.
- **Polar edge cases**: Polar Night days simply render a flat zero curve, no errors.
- **Responsive layout**: optimised for mobile and desktop, two-column on wide screens.

## Architecture
- **Vanilla HTML and CSS, TypeScript**, no frameworks.
- **TypeScript source in `ts/`, compiled JavaScript committed.** `ts/app.ts` compiles to `app.js`, at the same path the page has always loaded, as a classic script (no modules). The compiled file is committed because GitHub Pages serves the repository as it is, with no build step of its own; `.gitattributes` marks it as generated. Edit the TypeScript, never the `.js`.
- **Vendored and generated files kept as they are.** `suncalc.js` is SunCalc 1.8.0, vendored unchanged; `ts/suncalc.d.ts` types it. `cities.js` is the shared Stormberry Labs city catalogue, written by SunApp's `update_cities.py`; `ts/cities.d.ts` types it. `gate.js` and `gate.css`, the first-run notice, are written by the shared `build-gates.py`. None of them is edited here.
- **Build:** `npm run build` (`tools/build-ts.sh`) installs the pinned compiler (`npm ci`), compiles, then runs `bump_assets.py` to restamp the `?v=` cache stamps. `npm run check` changes nothing and fails when the committed JavaScript is not what the TypeScript compiles to. `npm test` runs the tests in `tests/` with the test runner built into Node 24. The published app has no runtime dependencies.
- **Privacy first**, no cookies, no tracking, zero external calls; everything is computed in the browser. The page never asks for the device's location either: a place comes from city search or from typed coordinates.
- Stormberry dark-mode glassmorphism design system, Inter typography.
- **Sovereign AI**, built and maintained using high-speed agentic workflows.

## Stack
- [SunCalc](https://github.com/mourner/suncalc) for solar position maths, bundled locally.
- [Inter](https://rsms.me/inter/) typeface, locally hosted.

## Local development
```bash
git clone https://github.com/StormberryAS/EcoCompass.git
cd EcoCompass
python3 -m http.server 8000
```
Open `http://localhost:8000` in your browser.

### Running the tests
The pure energy-model functions, the number parser and the page itself are covered by tests in `tests/`, written in TypeScript for the test runner built into Node 24 (`node:test`). Node 24 runs them as they are, with no build:

```bash
npm test
```

## Credits
Built by [Stormberry AS](https://stormberry.as). Proudly powered by sovereign AI agents.

## Disclaimer

Supplied free of charge, **as is**, with no warranty of any kind. Using it creates no client or advisory relationship with Stormberry AS, and nothing it produces is professional advice.

**Not a basis for a purchase.** Yield figures are theoretical estimates from location, roof geometry and clear-sky models. They exclude shading, soiling, panel degradation, inverter losses, local weather and grid constraints, and real installations commonly produce materially less. Obtain a site survey and a written quotation before spending money on solar equipment.

This is a **functioning prototype**, not a certified instrument and not a professional service. Values are computed or modelled, not measured. Check anything that matters against an authoritative source before you act on it. Stormberry AS reimburses no cost or loss arising from use of this application.

Full terms: [DISCLAIMER.md](DISCLAIMER.md).
