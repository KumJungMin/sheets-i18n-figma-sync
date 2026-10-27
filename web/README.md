# Sheet to JSON

A static page that converts XLSX translations into language JSON files without Figma. Files are processed entirely in the browser, with no external packages, CDN, or server uploads.

## Run locally

Run `node web/serve.mjs` from the repository root and open http://127.0.0.1:4173. The page uses ES modules and must be served over HTTP instead of opening the HTML file directly.

## Validation

Run `node web/test.mjs` to compare JSON output with the plugin and verify parsing rules, special keys, and ZIP generation. It also creates `web/fixtures/translations.xlsx` for browser upload testing. Multilingual fixture values are intentionally preserved.

## Conversion rules

- The `key` header must appear within the first 10 non-empty rows. Other non-empty headers become lowercase language codes.
- All visible worksheets are inspected. Invalid worksheets are disabled.
- For duplicate keys, the last row wins. Empty translations are omitted. Dotted keys become nested objects.
- All languages are selected initially. One language downloads as JSON; multiple languages download as a ZIP containing UTF-8 JSON files.
- ZIP downloads use uncompressed entries generated in the browser. Reading compressed XLSX files requires a current browser with `DecompressionStream` support.
- Files and history are not persisted.

`dist/` contains the complete static site. The current live site is public and does not require a ChatGPT account: https://sheet-to-json-jm.alertflea259.chatgpt.site/

## Branches

`main` contains the English plugin and web UI. `feature/ko` contains the Korean version with the same functionality. The live website is deployed separately; changing Git branches does not change its language.
