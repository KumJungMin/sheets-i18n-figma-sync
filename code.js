figma.showUI(__html__, { width: 440, height: 460 });

let translations = {};
let availableLanguages = [];

function keyFromNodeName(name) {
  if (!name || name[0] !== '*') return null;
  var key = name.slice(1).trim();
  return key.length > 0 ? key : null;
}

function ensureNestedValue(target, dotKey, value) {
  if (!value) return;
  var parts = dotKey.split('.').filter(Boolean);
  if (parts.length === 0) return;

  var cursor = target;
  for (var i = 0; i < parts.length - 1; i += 1) {
    var part = parts[i];
    if (typeof cursor[part] !== 'object' || cursor[part] === null || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function createNestedLanguageJson(map, lang) {
  var result = {};
  for (var _i = 0, entries = Object.entries(map); _i < entries.length; _i += 1) {
    var entry = entries[_i];
    var key = entry[0];
    var values = entry[1];
    var value = values[lang];
    if (!value) continue;
    ensureNestedValue(result, key, value);
  }
  return result;
}

function normalizeInput(value) {
  return String(value || '').trim().replace(/^['"\s]+|['"\s]+$/g, '');
}

function extractGidFromText(text) {
  var m = String(text || '').match(/[?#&]gid=([0-9]+)/);
  return m ? m[1] : null;
}

function extractGidFromUrl(url) {
  var gidFromQuery = url.searchParams.get('gid');
  if (gidFromQuery) return gidFromQuery;
  var hash = String(url.hash || '');
  var hashMatch = hash.match(/gid=([0-9]+)/);
  return hashMatch ? hashMatch[1] : null;
}

function buildCandidates(sheetId, gid) {
  var gvizUrl = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:csv';
  if (gid) gvizUrl += '&gid=' + gid;

  var exportUrl = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/export?format=csv';
  if (gid) exportUrl += '&gid=' + gid;

  return [gvizUrl, exportUrl];
}

function resolveCsvCandidates(inputValue) {
  var input = normalizeInput(inputValue);
  if (!input) return [];

  var sheetMatch = input.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetMatch) {
    var sheetId = sheetMatch[1];
    var gidFromText = extractGidFromText(input);

    var isDirectCsvText =
      /docs\.google\.com/.test(input) &&
      /\/spreadsheets\/d\/[a-zA-Z0-9-_]+\/gviz\/tq/.test(input) &&
      /[?&]tqx=out:csv/.test(input);

    if (isDirectCsvText) {
      return [input];
    }

    return buildCandidates(sheetId, gidFromText);
  }

  try {
    var url = new URL(input);
    var match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
      return buildCandidates(match[1], extractGidFromUrl(url));
    }
  } catch (e) {}

  if (/^[a-zA-Z0-9-_]{20,}$/.test(input)) {
    return buildCandidates(input, null);
  }

  return [];
}

function parseCsvLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;

  for (var i = 0; i < line.length; i += 1) {
    var char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map(function (x) { return x.trim(); });
}


function normalizeHeaderCell(value) {
  return String(value || '').replace(/^﻿/, '').trim().toLowerCase();
}

function parseCsv(csvText) {
  var lines = csvText.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV must include a header and at least one data row.');
  }

  var header = parseCsvLine(lines[0]);
  var normalizedHeader = header.map(normalizeHeaderCell);
  var keyIndex = normalizedHeader.indexOf('key');
  if (keyIndex < 0) {
    throw new Error('CSV header must include a key column. Received: ' + header.join(', '));
  }

  var languageColumns = [];
  for (var i = 0; i < header.length; i += 1) {
    if (i === keyIndex) continue;
    var lang = normalizeHeaderCell(header[i]);
    if (lang) languageColumns.push({ index: i, lang: lang });
  }

  if (languageColumns.length === 0) {
    throw new Error('CSV must include at least one language column.');
  }

  var map = {};
  for (var rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    var row = parseCsvLine(lines[rowIndex]);
    var key = (row[keyIndex] || '').trim();
    if (!key) continue;

    var values = {};
    for (var c = 0; c < languageColumns.length; c += 1) {
      var col = languageColumns[c];
      values[col.lang] = row[col.index] || '';
    }
    map[key] = values;
  }

  return { translations: map, languages: languageColumns.map(function (x) { return x.lang; }) };
}

async function fetchTranslationsInPlugin(inputUrl) {
  var candidates = resolveCsvCandidates(inputUrl);
  if (candidates.length === 0) throw new Error('Invalid Google Sheets URL / CSV URL / Sheet ID.');

  var lastError = null;
  for (var i = 0; i < candidates.length; i += 1) {
    var csvUrl = candidates[i];
    try {
      var response = await fetch(csvUrl);
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      var csvText = await response.text();
      return parseCsv(csvText);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error('Failed to fetch/parse sheet. Ensure the sheet is public and has header: key,...');
}

async function loadFontsForNode(node) {
  if (node.fontName !== figma.mixed) {
    await figma.loadFontAsync(node.fontName);
    return;
  }

  var loaded = new Set();
  var fonts = node.getRangeAllFontNames(0, node.characters.length);
  for (var i = 0; i < fonts.length; i += 1) {
    var font = fonts[i];
    var key = font.family + '__' + font.style;
    if (loaded.has(key)) continue;
    loaded.add(key);
    await figma.loadFontAsync(font);
  }
}

async function applyTranslations(lang) {
  var textNodes = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] });
  var appliedCount = 0;
  var skippedMissingKey = 0;
  var skippedMissingValue = 0;

  for (var i = 0; i < textNodes.length; i += 1) {
    var node = textNodes[i];
    var key = keyFromNodeName(node.name);
    if (!key) continue;

    var entry = translations[key];
    if (!entry) {
      skippedMissingKey += 1;
      console.warn('[i18n] Missing key in sheet: ' + key);
      continue;
    }

    var nextText = entry[lang];
    if (!nextText) {
      skippedMissingValue += 1;
      console.warn('[i18n] Missing value (' + lang + ') for key: ' + key);
      continue;
    }

    if (node.characters === nextText) continue;
    await loadFontsForNode(node);
    node.characters = nextText;
    appliedCount += 1;
  }

  return { totalTextNodes: textNodes.length, appliedCount: appliedCount, skippedMissingKey: skippedMissingKey, skippedMissingValue: skippedMissingValue };
}

figma.ui.onmessage = async function (msg) {
  try {
    if (msg.type === 'set-translations') {
      var incoming = msg && msg.payload ? msg.payload : {};
      translations = incoming.translations || {};
      availableLanguages = Array.isArray(incoming.languages) ? incoming.languages : [];
      figma.ui.postMessage({
        type: 'set-translations-success',
        payload: { count: Object.keys(translations).length, languages: availableLanguages },
      });
      figma.notify('Loaded ' + Object.keys(translations).length + ' i18n keys.');
      return;
    }

    if (msg.type === 'fetch-translations') {
      var result = await fetchTranslationsInPlugin(msg.payload && msg.payload.url);
      translations = result.translations;
      availableLanguages = result.languages;

      figma.ui.postMessage({
        type: 'set-translations-success',
        payload: { count: Object.keys(translations).length, languages: availableLanguages },
      });
      figma.notify('Loaded ' + Object.keys(translations).length + ' i18n keys.');
      return;
    }

    if (msg.type === 'apply-translations') {
      if (Object.keys(translations).length === 0) {
        figma.ui.postMessage({ type: 'error', payload: 'No translation data loaded. Click Fetch first.' });
        return;
      }

      var applyPayload = msg && msg.payload ? msg.payload : {};
      var lang = String(applyPayload.lang || '').trim();
      if (!lang) {
        figma.ui.postMessage({ type: 'error', payload: 'Please select a language.' });
        return;
      }

      var applyResult = await applyTranslations(lang);
      figma.notify('Applied ' + applyResult.appliedCount + ' layer(s) (' + lang + ').');
      figma.ui.postMessage({ type: 'apply-result', payload: applyResult });
      return;
    }

    if (msg.type === 'export-json') {
      if (Object.keys(translations).length === 0) {
        figma.ui.postMessage({ type: 'error', payload: 'No translation data loaded. Click Fetch first.' });
        return;
      }

      var langs = availableLanguages.length > 0 ? availableLanguages : Object.keys(Object.values(translations)[0] || {});
      var files = {};
      for (var i = 0; i < langs.length; i += 1) {
        var exportLang = langs[i];
        files[exportLang + '.json'] = JSON.stringify(createNestedLanguageJson(translations, exportLang), null, 2);
      }

      figma.ui.postMessage({ type: 'export-json-result', payload: { files: files, languages: langs } });
      figma.notify('Prepared ' + langs.length + ' language JSON file(s).');
      return;
    }
  } catch (error) {
    var message = error instanceof Error ? error.message : 'Unknown plugin error';
    figma.ui.postMessage({ type: 'error', payload: message });
  }
};
