import { inspectXlsxWorkbook } from './xlsx.mjs';
import { createZip, exportFiles, safeFilename } from './export.mjs';
const $ = id => document.getElementById(id);
let session = null, data = null, selected = new Set(), generation = 0, busy = false;
const names = { ko:'한국어', en:'영어', ja:'일본어', zh:'중국어', 'zh-cn':'중국어 (간체)', 'zh-tw':'중국어 (번체)', fr:'프랑스어', de:'독일어', es:'스페인어', vi:'베트남어', th:'태국어', id:'인도네시아어', pt:'포르투갈어', ru:'러시아어', ar:'아랍어' };
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
  $('download').textContent = busy ? '파일을 읽고 있습니다…' : selected.size ? `선택한 ${selected.size}개 언어 다운로드` : '다운로드할 언어를 선택하세요';
  $('all').textContent = data && selected.size === data.languages.length ? '전체 해제' : '전체 선택';
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
  $('key-count').textContent = keys.length + '개 키';
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
  $('sheet-info').textContent = `${Object.keys(data.translations).length}개 키 · ${data.languages.length}개 언어`;
  $('preview').open = false; renderLanguages(); renderPreview();
}
async function load(file) {
  if (!file || busy) return;
  const token = ++generation; setBusy(true); status('엑셀 파일과 워크시트를 확인하고 있습니다…');
  try {
    const next = await inspectXlsxWorkbook(file);
    if (token !== generation) return;
    const valid = next.sheets.filter(sheet => sheet.status === 'valid');
    if (!valid.length) throw new Error('사용할 수 있는 워크시트가 없습니다. ' + next.sheets.map(sheet => `${sheet.name}: ${sheet.error}`).join(' / '));
    session = next; $('sheets').replaceChildren();
    for (const sheet of session.sheets) {
      const option = document.createElement('option'); option.value = sheet.id;
      option.textContent = sheet.name + (sheet.status !== 'valid' ? ` — ${sheet.error}` : '');
      option.disabled = sheet.status !== 'valid'; $('sheets').append(option);
    }
    $('filename').textContent = file.name; $('filesize').textContent = `${(file.size / 1024).toFixed(1)} KB · ${valid.length}개 사용 가능한 시트`;
    activate(valid[0].id); $('drop').hidden = true; $('editor').hidden = false;
    const invalid = next.sheets.length - valid.length;
    status(invalid ? `${invalid}개 시트는 번역 형식이 맞지 않아 선택에서 제외했습니다.` : '파일을 불러왔습니다. 다운로드할 언어를 선택하세요.');
  } catch (error) { status(error.message || '파일을 읽지 못했습니다.', true); }
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
    status(`${files.length}개 언어의 다운로드를 시작했습니다.`);
  } catch (error) { status('다운로드 파일을 생성하지 못했습니다. ' + error.message, true); }
});
