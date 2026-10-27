# sheets-i18n-figma-sync
Sync Google Sheets or uploaded XLSX files with Figma using i18n keys and export language JSON files.

For XLSX files, the plugin inspects up to the first three visible worksheets and lets you choose which valid worksheet to use. It keeps parsed data for up to three recent XLSX files in history when each file's history record is no larger than 500 KB.

## Versions

- `main`: English plugin and standalone web UI.
- `feature/ko`: Korean plugin and standalone web UI with the same functionality.

## Standalone converter

The [web converter](web/README.md) uploads XLSX files locally in the browser, lets you select a worksheet and languages, and downloads one JSON file or a ZIP of language JSON files. Run `node web/serve.mjs` from this repository and open http://127.0.0.1:4173.

Run `node web/test.mjs` to verify conversion rules and JSON parity with the plugin. The live website is deployed separately from these branches.
