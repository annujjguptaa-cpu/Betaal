# Firefox Extension Deployment Guide

## Overview
Betaal is fully compatible with both Google Chrome and Mozilla Firefox (Manifest V3).

## Switching Manifest for Firefox

To load and test Betaal in Mozilla Firefox:

1. **Copy the Firefox Manifest**:
   ```bash
   cp manifest-firefox.json manifest.json
   ```
2. **Open Firefox Add-ons Debugging**:
   - Navigate to `about:debugging#/runtime/this-firefox` in Firefox.
3. **Load Temporary Add-on**:
   - Click **"Load Temporary Add-on..."**.
   - Select `manifest.json` from the project root directory.

To return to Chrome:
- Git checkout or revert `manifest.json`:
  ```bash
  git checkout manifest.json
  ```

---

## Permissions & Manifest Differences

| Property | Chrome (`manifest.json`) | Firefox (`manifest-firefox.json`) | Notes |
| :--- | :--- | :--- | :--- |
| `browser_specific_settings` | N/A | `gecko.id: "betaal@yourteam.dev"` | Required for Firefox MV3 identification |
| `background` | `"service_worker": "background.js"` | `"scripts": ["extension/browser-polyfill.js", "background.js"]` | Firefox uses background scripts array |
| `content_security_policy` | Default | `"extension_pages": "script-src 'self' 'wasm-unsafe-eval'"` | Allows ONNX Runtime WebAssembly execution |
| `permissions` | `activeTab`, `scripting`, `tabs`, `storage` | `activeTab`, `scripting`, `tabs`, `storage` | 100% identical in both browsers |

---

## Cross-Browser Polyfill Shim
All Chrome/Firefox browser API interactions use `extension/browser-polyfill.js`. This guarantees seamless promise-based execution for `browser.tabs`, `browser.runtime`, `browser.scripting`, and `browser.storage` across both platforms.
