# EcoCompass

Privacy-first solar energy planner. EcoCompass estimates daily and annual rooftop solar generation for any location on Earth, driven by roof orientation, tilt, panel area and system parameters, with an interactive 3D roof visualiser and a printable report.

**Live:** [eco.stormberry.as](https://eco.stormberry.as)

## Features
- **City search**: rapid, offline autocomplete for major cities worldwide, with strong Nordic and Brazilian coverage.
- **On-device geolocation**: retrieve your current coordinates with one click.
- **Manual GPS input**: plan a roof at any arbitrary point on the globe.
- **Interactive 3D roof model**: a glass-styled house built entirely with CSS 3D transforms; the roof pitches and rotates live as you move the tilt and orientation sliders.
- **Clear-sky energy model**: Kasten-Young air mass, clear-sky irradiance and plane-of-array geometry, scaled by a user-set sky-clearness factor. Estimates are clearly labelled as clear-sky model estimates, not quotations.
- **Energy graphs**: hourly generation curve for the selected date and a monthly yield bar chart, rendered as inline SVG.
- **Savings projection**: annual saving from your electricity price, in kr, €, £ or $.
- **Printable report**: one click opens your browser's print dialog with a clean, white-background summary; choose Save as PDF.
- **Polar edge cases**: Polar Night days simply render a flat zero curve, no errors.
- **Responsive layout**: optimised for mobile and desktop, two-column on wide screens.

## Architecture
- **Vanilla HTML/CSS/JS**, no frameworks, no build step.
- **Privacy first**, no cookies, no tracking, zero external calls; everything is computed in the browser.
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

### Running the model tests
The pure energy-model functions are covered by a `node:test` suite:

```bash
node --test test.js
```

## Credits
Built by [Stormberry AS](https://stormberry.as). Proudly powered by sovereign AI agents.

## Disclaimer

Supplied free of charge, **as is**, with no warranty of any kind. Using it creates no client or advisory relationship with Stormberry AS, and nothing it produces is professional advice.

**Not a basis for a purchase.** Yield figures are theoretical estimates from location, roof geometry and clear-sky models. They exclude shading, soiling, panel degradation, inverter losses, local weather and grid constraints, and real installations commonly produce materially less. Obtain a site survey and a written quotation before spending money on solar equipment.

This is a **functioning prototype**, not a certified instrument and not a professional service. Values are computed or modelled, not measured. Check anything that matters against an authoritative source before you act on it. Stormberry AS reimburses no cost or loss arising from use of this application.

Full terms: [DISCLAIMER.md](DISCLAIMER.md).
