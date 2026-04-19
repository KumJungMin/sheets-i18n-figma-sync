figma.showUI(__html__, { width: 440, height: 460 });

let translations = {};
let availableLanguages = [];
const HISTORY_KEY = 'sheets_i18n_history_v1';
const APPLY_CHUNK_SIZE = 100;
const MAX_WARNING_SAMPLES = 10;
const APPLY_SCOPE_PAGE = 'page';
const APPLY_SCOPE_SELECTION = 'selection';
const loadedFontCache = new Set();
const unavailableFontCache = new Map();

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

function fontKey(font) {
  return font.family + '__' + font.style;
}

function fontLabel(font) {
  return font.family + ' ' + font.style;
}

function pushUniqueSample(list, value) {
  if (list.length >= MAX_WARNING_SAMPLES) return false;
  if (list.indexOf(value) >= 0) return false;
  list.push(value);
  return true;
}

function yieldToMainThread() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
}

function collectNodeFonts(node) {
  if (node.fontName !== figma.mixed) {
    return [node.fontName];
  }

  var loaded = new Set();
  var fonts = node.getRangeAllFontNames(0, node.characters.length);
  var result = [];

  for (var i = 0; i < fonts.length; i += 1) {
    var font = fonts[i];
    var key = fontKey(font);
    if (loaded.has(key)) continue;
    loaded.add(key);
    result.push(font);
  }

  return result;
}

function getNodeChildren(node) {
  return node && Array.isArray(node.children) ? node.children : [];
}

function normalizeApplyScope(scope) {
  return scope === APPLY_SCOPE_SELECTION ? APPLY_SCOPE_SELECTION : APPLY_SCOPE_PAGE;
}

function normalizeSelectionRoots(selection) {
  var selectedIds = new Set();
  for (var i = 0; i < selection.length; i += 1) {
    selectedIds.add(selection[i].id);
  }

  var roots = [];
  for (var selectionIndex = 0; selectionIndex < selection.length; selectionIndex += 1) {
    var node = selection[selectionIndex];
    var current = node.parent;
    var nestedSelection = false;

    while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
      if (selectedIds.has(current.id)) {
        nestedSelection = true;
        break;
      }
      current = current.parent;
    }

    if (!nestedSelection) roots.push(node);
  }

  return roots;
}

function collectTextNodesFromRoots(roots) {
  var textNodes = [];
  var seenTextNodeIds = new Set();
  var stack = roots.slice().reverse();

  while (stack.length > 0) {
    var node = stack.pop();
    if (node.type === 'TEXT') {
      if (!seenTextNodeIds.has(node.id)) {
        seenTextNodeIds.add(node.id);
        textNodes.push(node);
      }
      continue;
    }

    var children = getNodeChildren(node);
    for (var i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }

  return textNodes;
}

function getSelectionTargets() {
  var selection = figma.currentPage.selection;
  var roots = normalizeSelectionRoots(selection);
  var textNodes = collectTextNodesFromRoots(roots);

  return {
    selection: selection,
    roots: roots,
    textNodes: textNodes,
  };
}

function createSelectionInfoFromTargets(targets) {
  return {
    selectedNodeCount: targets.selection.length,
    selectedRootCount: targets.roots.length,
    selectedTextNodeCount: targets.textNodes.length,
  };
}

function createSelectionInfo() {
  return createSelectionInfoFromTargets(getSelectionTargets());
}

function createEmptySelectionInfo() {
  return {
    selectedNodeCount: 0,
    selectedRootCount: 0,
    selectedTextNodeCount: 0,
  };
}

function postSelectionInfo() {
  figma.ui.postMessage({
    type: 'selection-info',
    payload: createSelectionInfo(),
  });
}

function countTextDescendants(node, cache) {
  var cacheKey = node.id;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  var children = getNodeChildren(node);
  var count = 0;

  for (var i = 0; i < children.length; i += 1) {
    var child = children[i];
    if (child.type === 'TEXT') {
      count += 1;
      continue;
    }

    count += countTextDescendants(child, cache);
  }

  cache.set(cacheKey, count);
  return count;
}

function cacheAncestorResolution(visitedAncestors, resolution, cache) {
  for (var i = 0; i < visitedAncestors.length; i += 1) {
    cache.set(visitedAncestors[i].id, resolution);
  }
}

function resolveKeyForTextNode(node, descendantCountCache, ancestorResolutionCache) {
  var directKey = keyFromNodeName(node.name);
  if (directKey) return { type: 'direct', key: directKey };

  var visitedAncestors = [];
  var current = node.parent;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    var cached = ancestorResolutionCache.get(current.id);
    if (cached) {
      cacheAncestorResolution(visitedAncestors, cached, ancestorResolutionCache);
      return cached;
    }

    visitedAncestors.push(current);
    var ancestorKey = keyFromNodeName(current.name);
    if (ancestorKey) {
      var descendantCount = countTextDescendants(current, descendantCountCache);
      if (descendantCount === 1) {
        var singleResolution = { type: 'ancestor', key: ancestorKey, ownerId: current.id };
        cacheAncestorResolution(visitedAncestors, singleResolution, ancestorResolutionCache);
        return singleResolution;
      }

      var ambiguousResolution = {
        type: 'ambiguous-ancestor',
        key: ancestorKey,
        ownerId: current.id,
        descendantCount: descendantCount,
      };
      cacheAncestorResolution(visitedAncestors, ambiguousResolution, ancestorResolutionCache);
      return ambiguousResolution;
    }

    current = current.parent;
  }

  var missingResolution = { type: 'missing-key' };
  cacheAncestorResolution(visitedAncestors, missingResolution, ancestorResolutionCache);
  return missingResolution;
}

function createApplyResult(totalTextNodes, scope, selectionInfo) {
  return {
    totalTextNodes: totalTextNodes,
    appliedCount: 0,
    changedNodeCount: 0,
    applyScope: scope,
    skippedMissingKey: 0,
    skippedMissingValue: 0,
    skippedAmbiguousAncestor: 0,
    skippedFontLoad: 0,
    fontLoadErrors: [],
    selectionInfo: selectionInfo || createEmptySelectionInfo(),
  };
}

function resolveApplyTargets(scope) {
  var normalizedScope = normalizeApplyScope(scope);
  if (normalizedScope === APPLY_SCOPE_SELECTION) {
    var selectionTargets = getSelectionTargets();
    if (selectionTargets.selection.length === 0) {
      return {
        type: 'empty-selection',
        scope: normalizedScope,
      };
    }

    if (selectionTargets.textNodes.length === 0) {
      return {
        type: 'selection-without-text',
        scope: normalizedScope,
        selectionInfo: createSelectionInfoFromTargets(selectionTargets),
      };
    }

    return {
      type: 'success',
      scope: normalizedScope,
      textNodes: selectionTargets.textNodes,
      selectionInfo: createSelectionInfoFromTargets(selectionTargets),
    };
  }

  return {
    type: 'success',
    scope: normalizedScope,
    textNodes: figma.currentPage.findAllWithCriteria({ types: ['TEXT'] }),
    selectionInfo: createSelectionInfo(),
  };
}

function buildApplyPlan(textNodes, lang, scope, selectionInfo) {
  var result = createApplyResult(textNodes.length, scope, selectionInfo);
  var updates = [];
  var descendantCountCache = new Map();
  var ancestorResolutionCache = new Map();
  var warnedAmbiguousAncestorIds = new Set();
  var missingKeySamples = [];
  var missingValueSamples = [];

  for (var i = 0; i < textNodes.length; i += 1) {
    var node = textNodes[i];
    var resolvedKey = resolveKeyForTextNode(node, descendantCountCache, ancestorResolutionCache);
    if (resolvedKey.type === 'missing-key') continue;
    if (resolvedKey.type === 'ambiguous-ancestor') {
      result.skippedAmbiguousAncestor += 1;
      if (!warnedAmbiguousAncestorIds.has(resolvedKey.ownerId)) {
        warnedAmbiguousAncestorIds.add(resolvedKey.ownerId);
        console.warn(
          '[i18n] Ambiguous keyed container: ' +
          resolvedKey.key +
          ' (' +
          resolvedKey.descendantCount +
          ' text descendants). Rename the target text layer directly with *key.'
        );
      }
      continue;
    }

    var key = resolvedKey.key;
    var entry = translations[key];
    if (!entry) {
      result.skippedMissingKey += 1;
      if (pushUniqueSample(missingKeySamples, key)) {
        console.warn('[i18n] Missing key in sheet: ' + key);
      }
      continue;
    }

    var nextText = entry[lang];
    if (!nextText) {
      result.skippedMissingValue += 1;
      if (pushUniqueSample(missingValueSamples, key)) {
        console.warn('[i18n] Missing value (' + lang + ') for key: ' + key);
      }
      continue;
    }

    if (node.characters === nextText) continue;
    updates.push({
      node: node,
      nextText: nextText,
      fonts: collectNodeFonts(node),
    });
  }

  result.changedNodeCount = updates.length;
  return { result: result, updates: updates };
}

async function preloadFontsForUpdates(updates) {
  var uniqueFonts = [];
  var seenFonts = new Set();

  for (var i = 0; i < updates.length; i += 1) {
    var fonts = updates[i].fonts;
    for (var j = 0; j < fonts.length; j += 1) {
      var font = fonts[j];
      var key = fontKey(font);
      if (seenFonts.has(key)) continue;
      seenFonts.add(key);
      uniqueFonts.push(font);
    }
  }

  var unavailableFonts = new Map();
  for (var fontIndex = 0; fontIndex < uniqueFonts.length; fontIndex += 1) {
    var nextFont = uniqueFonts[fontIndex];
    var nextFontKey = fontKey(nextFont);

    if (loadedFontCache.has(nextFontKey)) continue;
    if (unavailableFontCache.has(nextFontKey)) {
      unavailableFonts.set(nextFontKey, unavailableFontCache.get(nextFontKey));
      continue;
    }

    try {
      await figma.loadFontAsync(nextFont);
      loadedFontCache.add(nextFontKey);
    } catch (error) {
      var unavailableFont = {
        font: nextFont,
        message: getErrorMessage(error),
      };
      unavailableFontCache.set(nextFontKey, unavailableFont);
      unavailableFonts.set(nextFontKey, unavailableFont);
    }

    if ((fontIndex + 1) % APPLY_CHUNK_SIZE === 0) {
      await yieldToMainThread();
    }
  }

  return unavailableFonts;
}

function excludeUpdatesWithUnavailableFonts(updates, unavailableFonts, result) {
  var applicableUpdates = [];
  var warnedFontKeys = new Set();

  for (var i = 0; i < updates.length; i += 1) {
    var update = updates[i];
    var unavailableFont = null;

    for (var j = 0; j < update.fonts.length; j += 1) {
      var key = fontKey(update.fonts[j]);
      if (unavailableFonts.has(key)) {
        unavailableFont = unavailableFonts.get(key);
        break;
      }
    }

    if (!unavailableFont) {
      applicableUpdates.push(update);
      continue;
    }

    result.skippedFontLoad += 1;
    var failedFontKey = fontKey(unavailableFont.font);
    if (!warnedFontKeys.has(failedFontKey)) {
      warnedFontKeys.add(failedFontKey);
      result.fontLoadErrors.push(fontLabel(unavailableFont.font));
      console.warn(
        '[i18n] Skipped text node due to unavailable font: ' +
        fontLabel(unavailableFont.font) +
        '. ' +
        unavailableFont.message
      );
    }
  }

  return applicableUpdates;
}

async function commitTextUpdates(updates, result) {
  for (var i = 0; i < updates.length; i += 1) {
    updates[i].node.characters = updates[i].nextText;
    result.appliedCount += 1;

    if ((i + 1) % APPLY_CHUNK_SIZE === 0) {
      await yieldToMainThread();
    }
  }
}

async function applyTranslations(lang, options) {
  var applyTargets = resolveApplyTargets(options && options.scope);
  if (applyTargets.type === 'empty-selection') {
    throw new Error('Select a frame, group, or text layer to use selection scope.');
  }
  if (applyTargets.type === 'selection-without-text') {
    throw new Error('The current selection does not include any text nodes.');
  }

  var applyPlan = buildApplyPlan(
    applyTargets.textNodes,
    lang,
    applyTargets.scope,
    applyTargets.selectionInfo
  );
  if (applyPlan.updates.length === 0) return applyPlan.result;

  var unavailableFonts = await preloadFontsForUpdates(applyPlan.updates);
  var applicableUpdates = excludeUpdatesWithUnavailableFonts(
    applyPlan.updates,
    unavailableFonts,
    applyPlan.result
  );

  await commitTextUpdates(applicableUpdates, applyPlan.result);
  return applyPlan.result;
}

function getErrorMessage(error) {
  if (!error) return 'Unknown plugin error';
  if (typeof error === 'string') return error;

  if (typeof error.message === 'string' && error.message) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch (jsonError) {
    return String(error);
  }
}

figma.on('selectionchange', postSelectionInfo);
figma.on('currentpagechange', postSelectionInfo);

figma.ui.onmessage = async function (msg) {
  try {

    if (msg.type === 'get-selection-info') {
      postSelectionInfo();
      return;
    }

    if (msg.type === 'get-history') {
      var list = await figma.clientStorage.getAsync(HISTORY_KEY);
      if (!Array.isArray(list)) list = [];
      figma.ui.postMessage({ type: 'history-loaded', payload: { history: list } });
      return;
    }

    if (msg.type === 'save-history') {
      var historyPayload = msg && msg.payload ? msg.payload : {};
      var nextHistory = Array.isArray(historyPayload.history) ? historyPayload.history : [];
      await figma.clientStorage.setAsync(HISTORY_KEY, nextHistory);
      figma.ui.postMessage({ type: 'history-loaded', payload: { history: nextHistory } });
      return;
    }

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
      var scope = normalizeApplyScope(applyPayload.scope);
      if (!lang) {
        figma.ui.postMessage({ type: 'error', payload: 'Please select a language.' });
        return;
      }

      var applyResult = await applyTranslations(lang, { scope: scope });
      var notifyMessage =
        'Applied ' +
        applyResult.appliedCount +
        ' / ' +
        applyResult.changedNodeCount +
        ' change(s) (' +
        lang +
        ').';
      if (applyResult.applyScope === APPLY_SCOPE_SELECTION) {
        notifyMessage += ' Selection scope.';
      }
      if (applyResult.skippedFontLoad > 0) {
        notifyMessage += ' Skipped ' + applyResult.skippedFontLoad + ' due to unavailable fonts.';
      }
      figma.notify(notifyMessage);
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
    console.error('[i18n] Plugin error', error);
    var message = getErrorMessage(error);
    figma.ui.postMessage({ type: 'error', payload: message });
  }
};

postSelectionInfo();
