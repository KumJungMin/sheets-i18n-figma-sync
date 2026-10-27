import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { parseTranslationTableRows } from './dist/xlsx.mjs';
import { createLanguageJson, createZip, exportFiles } from './dist/export.mjs';
const rows = [['번역 목록'], [], ['key','KO','en','ja'], ['home.title','안녕하세요','Hello','こんにちは'], ['home.empty','','',''], ['home.title','반갑습니다','Welcome','ようこそ'], ['key','ko','en','ja'], ['zero','0','0','0'], ['unsafe.__proto__.value','안전','safe','安全']];
const parsed = parseTranslationTableRows(rows);
assert.deepEqual(parsed.languages, ['ko','en','ja']);
assert.equal(parsed.translations['home.title'].ko, '반갑습니다');
assert.equal(Object.keys(parsed.translations).length, 4);
assert.equal(JSON.parse(createLanguageJson(parsed.translations, 'ko')).home.empty, undefined);
assert.equal(JSON.parse(createLanguageJson(parsed.translations, 'en')).zero, '0');
assert.equal({}.value, undefined);
assert.throws(() => parseTranslationTableRows([['wrong','en'],['a','b']]), /key/);
// Compare output with the original plugin's export implementation for normal keys.
const original = readFileSync(new URL('../code.js', import.meta.url), 'utf8');
const start = original.indexOf('function ensureNestedValue');
const end = original.indexOf('function normalizeInput');
const ctx = vm.createContext({}); vm.runInContext(original.slice(start, end), ctx);
const normal = parseTranslationTableRows(rows.slice(0,-1));
for (const lang of normal.languages) assert.equal(createLanguageJson(normal.translations, lang), JSON.stringify(ctx.createNestedLanguageJson(normal.translations, lang), null, 2));
assert.equal(new Set(exportFiles({ translations: {}, languages:[] }, ['en/a','en:a']).map(f=>f.name)).size, 2);
const files = exportFiles(parsed, ['ko','en']);
const zip = new Uint8Array(await createZip(files).arrayBuffer());
assert.equal(new DataView(zip.buffer).getUint32(0,true), 0x04034b50);
mkdirSync(new URL('./fixtures/', import.meta.url), { recursive:true });
writeFileSync(new URL('./fixtures/export.zip', import.meta.url), zip);
const xml = (text) => text.replaceAll('&','&amp;').replaceAll('<','&lt;');
const sheet = (table) => '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + table.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>'<c r="'+String.fromCharCode(65+j)+(i+1)+'" t="inlineStr"><is><t>'+xml(v)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';
const entries = [
  { name:'[Content_Types].xml', text:'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
  { name:'xl/workbook.xml', text:'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+['공통','안내','추가','네 번째','빈 시트','숨김'].map((name,i)=>`<sheet name="${name}" sheetId="${i+1}" r:id="rId${i+1}"${i===5?' state="hidden"':''}/>`).join('')+'</sheets></workbook>' },
  { name:'xl/_rels/workbook.xml.rels', text:'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+Array.from({length:6},(_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+'</Relationships>' },
  ...Array.from({length:6},(_,i)=>({ name:`xl/worksheets/sheet${i+1}.xml`, text:sheet(i===4 ? [['not translations']] : [['key','ko','en','ja'],['home.title','안녕하세요','Hello','こんにちは'],['home.body','줄바꿈\n번역','Line one\nLine two','テスト'],['home.empty','','','']]) }))
];
writeFileSync(new URL('./fixtures/translations.xlsx', import.meta.url), new Uint8Array(await createZip(entries).arrayBuffer()));
console.log('Passed: parser rules, plugin JSON parity, empty values, Unicode, prototype keys, filename collisions, ZIP creation. Browser fixture created.');
