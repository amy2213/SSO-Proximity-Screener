# SSO Proximity Screener

A Vite React screening tool for reviewing Seamless Summer Option site proximity, coordinate quality, distance conflicts, and USDA Rural Development rural eligibility map checks.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## GitHub Pages

This repo is configured for GitHub Pages using GitHub Actions.

Expected URL:

```text
https://amy2213.github.io/SSO-Proximity-Screener/
```

The Vite base path is configured in `vite.config.js` as:

```js
base: '/SSO-Proximity-Screener/'
```

Do not move `App.jsx` or `main.jsx` out of the `src/` folder.
