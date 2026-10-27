const encoder = new TextEncoder();
export function createLanguageJson(translations, lang) {
  const result = Object.create(null);
  for (const [key, values] of Object.entries(translations)) {
    const value = values[lang];
    if (!value) continue;
    const parts = key.split('.').filter(Boolean);
    if (!parts.length) continue;
    let cursor = result;
    for (const part of parts.slice(0, -1)) {
      if (typeof cursor[part] !== 'object' || cursor[part] === null) cursor[part] = Object.create(null);
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = value;
  }
  return JSON.stringify(result, null, 2);
}
export function safeFilename(lang) {
  return String(lang).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|[. ]+$/g, '') || 'language';
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// Stored ZIP entries: no dependency or network request is needed to create downloads.
export function createZip(files) {
  const localParts = [], centralParts = [];
  let offset = 0, centralSize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), data = encoder.encode(file.text), crc = crc32(data);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(12, 33, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); cv.setUint16(14, 33, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
    localParts.push(local, data); centralParts.push(central);
    offset += local.length + data.length; centralSize += central.length;
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
export function exportFiles(data, languages) {
  const used = new Set();
  return languages.map(lang => {
    const base = safeFilename(lang);
    let name = base + '.json', index = 2;
    while (used.has(name.toLowerCase())) name = base + '-' + index++ + '.json';
    used.add(name.toLowerCase());
    return { name, text: createLanguageJson(data.translations, lang) };
  });
}
