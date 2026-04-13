figma.showUI(__html__, { width: 440, height: 460 });

/** @typedef {Record<string, string>} TranslationValue */
/** @typedef {Record<string, TranslationValue>} TranslationMap */

/** @type {TranslationMap} */
let translations = {};
/** @type {string[]} */
let availableLanguages = [];

function keyFromNodeName(name) {
  if (!name || name[0] !== '*') return null;
  const key = name.slice(1).trim();
  return key.length > 0 ? key : null;
}

function ensureNestedValue(target, dotKey, value) {
  if (!value) return;
  const parts = dotKey.split('.').filter(Boolean);
  if (parts.length === 0) return;

  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (typeof cursor[part] !== 'object' || cursor[part] === null || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function createNestedLanguageJson(map, lang) {
  const result = {};
  for (const [key, values] of Object.entries(map)) {
    const value = values[lang];
    if (!value) continue;
    ensureNestedValue(result, key, value);
  }
  return result;
}

async function loadFontsForNode(node) {
  if (node.fontName !== figma.mixed) {
    await figma.loadFontAsync(node.fontName);
    return;
  }

  const loaded = new Set();
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  for (const font of fonts) {
    const key = `${font.family}__${font.style}`;
    if (loaded.has(key)) continue;
    loaded.add(key);
    await figma.loadFontAsync(font);
  }
}

async function applyTranslations(lang) {
  const textNodes = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] });

  let appliedCount = 0;
  let skippedMissingKey = 0;
  let skippedMissingValue = 0;

  for (const node of textNodes) {
    const key = keyFromNodeName(node.name);
    if (!key) continue;

    const entry = translations[key];
    if (!entry) {
      skippedMissingKey += 1;
      console.warn(`[i18n] Missing key in sheet: ${key}`);
      continue;
    }

    const nextText = entry[lang];
    if (!nextText) {
      skippedMissingValue += 1;
      console.warn(`[i18n] Missing value (${lang}) for key: ${key}`);
      continue;
    }

    if (node.characters === nextText) continue;
    await loadFontsForNode(node);
    node.characters = nextText;
    appliedCount += 1;
  }

  return { totalTextNodes: textNodes.length, appliedCount, skippedMissingKey, skippedMissingValue };
}

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'set-translations') {
      translations = msg.payload?.translations || {};
      availableLanguages = Array.isArray(msg.payload?.languages)
        ? msg.payload.languages.filter((x) => typeof x === 'string' && x.trim())
        : [];

      if (availableLanguages.length === 0) {
        const first = Object.values(translations)[0] || {};
        availableLanguages = Object.keys(first);
      }

      figma.notify(`Loaded ${Object.keys(translations).length} i18n keys (${availableLanguages.join(', ') || 'no languages'}).`);
      figma.ui.postMessage({
        type: 'set-translations-success',
        payload: { count: Object.keys(translations).length, languages: availableLanguages },
      });
      return;
    }

    if (msg.type === 'apply-translations') {
      if (Object.keys(translations).length === 0) {
        figma.ui.postMessage({ type: 'error', payload: 'No translation data loaded. Click Fetch first.' });
        return;
      }

      const lang = String(msg.payload?.lang || '').trim();
      if (!lang) {
        figma.ui.postMessage({ type: 'error', payload: 'Please select a language.' });
        return;
      }

      const result = await applyTranslations(lang);
      figma.notify(`Applied ${result.appliedCount} layer(s) (${lang}).`);
      figma.ui.postMessage({ type: 'apply-result', payload: result });
      return;
    }

    if (msg.type === 'export-json') {
      if (Object.keys(translations).length === 0) {
        figma.ui.postMessage({ type: 'error', payload: 'No translation data loaded. Click Fetch first.' });
        return;
      }

      const langs = availableLanguages.length > 0 ? availableLanguages : Object.keys(Object.values(translations)[0] || {});
      const files = {};
      for (const lang of langs) {
        files[`${lang}.json`] = JSON.stringify(createNestedLanguageJson(translations, lang), null, 2);
      }

      figma.ui.postMessage({ type: 'export-json-result', payload: { files, languages: langs } });
      figma.notify(`Prepared ${langs.length} language JSON file(s).`);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown plugin error';
    figma.ui.postMessage({ type: 'error', payload: message });
  }
};
