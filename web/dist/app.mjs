import { inspectXlsxWorkbook } from './xlsx.mjs';
import { createZip, exportFiles, safeFilename } from './export.mjs';
const $ = id => document.getElementById(id);
let session = null, data = null, selected = new Set(), generation = 0, busy = false;
const names = { ko:'Korean', en:'English', ja:'Japanese', zh:'Chinese', 'zh-cn':'Chinese (Simplified)', 'zh-tw':'Chinese (Traditional)', fr:'French', de:'German', es:'Spanish', vi:'Vietnamese', th:'Thai', id:'Indonesian', pt:'Portuguese', ru:'Russian', ar:'Arabic' };
function status(message = '', error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
function setBusy(value) {
  busy = value;
  for (const id of ['choose', 'replace', 'sheets', 'all']) $(id).disabled = value;
  document.querySelectorAll('#languages input').forEach(input => input.disabled = value);
  $('drop').setAttribute('aria-busy', String(value));
  updateDownload();
}
function updateDownload() {
  $('download').disabled = busy || !data || !selected.size;
  $('download').textContent = busy ? 'Reading your file…' : selected.size ? `Download ${selected.size} selected languages` : 'Select languages to download';
  $('all').textContent = data && selected.size === data.languages.length ? 'Deselect all' : 'Select all';
}
function renderLanguages() {
  $('languages').replaceChildren();
  for (const lang of data.languages) {
    const label = document.createElement('label'); label.className = 'language-card';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(lang); input.value = lang;
    const text = document.createElement('span'), name = document.createElement('strong'), code = document.createElement('small');
    name.textContent = names[lang] || lang; code.textContent = lang + '.json';
    text.append(name, code); label.append(input, text); $('languages').append(label);
    input.addEventListener('change', () => { input.checked ? selected.add(lang) : selected.delete(lang); updateDownload(); renderPreview(); });
  }
  updateDownload();
}
function renderPreview() {
  const langs = [...selected], keys = Object.keys(data.translations);
  $('key-count').textContent = keys.length + ' keys';
  $('thead').replaceChildren(); $('tbody').replaceChildren();
  const row = document.createElement('tr');
  for (const text of ['key', ...langs]) { const cell = document.createElement('th'); cell.textContent = text; row.append(cell); }
  $('thead').append(row);
  for (const key of keys.slice(0, 20)) {
    const tr = document.createElement('tr');
    for (const text of [key, ...langs.map(lang => data.translations[key][lang])]) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
    $('tbody').append(tr);
  }
}
function activate(id) {
  const sheet = session.sheets.find(sheet => sheet.id === id && sheet.status === 'valid');
  if (!sheet) return;
  data = sheet.data; selected = new Set(data.languages); $('sheets').value = id;
  $('sheet-info').textContent = `${Object.keys(data.translations).length} keys · ${data.languages.length} languages`;
  $('preview').open = false; renderLanguages(); renderPreview();
}
async function load(file) {
  if (!file || busy) return;
  const token = ++generation; setBusy(true); status('Inspecting your spreadsheet and worksheets…');
  try {
    const next = await inspectXlsxWorkbook(file);
    if (token !== generation) return;
    const valid = next.sheets.filter(sheet => sheet.status === 'valid');
    if (!valid.length) throw new Error('No usable worksheets were found. ' + next.sheets.map(sheet => `${sheet.name}: ${sheet.error}`).join(' / '));
    session = next; $('sheets').replaceChildren();
    for (const sheet of session.sheets) {
      const option = document.createElement('option'); option.value = sheet.id;
      option.textContent = sheet.name + (sheet.status !== 'valid' ? ` — ${sheet.error}` : '');
      option.disabled = sheet.status !== 'valid'; $('sheets').append(option);
    }
    $('filename').textContent = file.name; $('filesize').textContent = `${(file.size / 1024).toFixed(1)} KB · ${valid.length} usable worksheets`;
    activate(valid[0].id); $('drop').hidden = true; $('editor').hidden = false;
    const invalid = next.sheets.length - valid.length;
    status(invalid ? `${invalid} worksheets were excluded because their translation format is invalid.` : 'File loaded. Choose the languages to download.');
  } catch (error) { status(error.message || 'Could not read the file.', true); }
  finally { setBusy(false); $('file').value = ''; }
}
for (const id of ['choose', 'replace']) $(id).addEventListener('click', () => $('file').click());
$('file').addEventListener('change', event => load(event.target.files[0]));
for (const type of ['dragenter', 'dragover']) $('drop').addEventListener(type, event => { event.preventDefault(); $('drop').classList.add('drag'); });
for (const type of ['dragleave', 'drop']) $('drop').addEventListener(type, event => { event.preventDefault(); $('drop').classList.remove('drag'); });
$('drop').addEventListener('drop', event => load(event.dataTransfer.files[0]));
// Prevent the browser from navigating to a file dropped outside the drop zone.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('sheets').addEventListener('change', () => { activate($('sheets').value); status(); });
$('all').addEventListener('click', () => { selected = selected.size === data.languages.length ? new Set() : new Set(data.languages); renderLanguages(); renderPreview(); });
$('download').addEventListener('click', () => {
  if (!data || !selected.size || busy) return;
  try {
    const files = exportFiles(data, data.languages.filter(lang => selected.has(lang)));
    const blob = files.length === 1 ? new Blob([files[0].text], { type: 'application/json;charset=utf-8' }) : createZip(files);
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = files.length === 1 ? files[0].name : safeFilename(session.fileName.replace(/\.xlsx$/i, '')) + '-json.zip';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    status(`${files.length} language downloads started.`);
  } catch (error) { status('Could not create the download. ' + error.message, true); }
});
