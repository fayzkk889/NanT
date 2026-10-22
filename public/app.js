import {bundleForExport,MAX_BUNDLE_BYTES} from './course-bundle.js';
import { renderMarkdown } from './markdown-view.js';

const $ = id => document.getElementById(id);
const phases = [ ['ingestion', 'Source'], ['transcript', 'Captions'], ['chapter-planning', 'Chapter'], ['visual-evidence', 'Visuals'], ['generation', 'Writing'], ['verification', 'Review'] ];
let evidence = [], current = null, busy = false, lastInput = null, jobId = null, pdfStyle = 'textbook', healthState = null;
let boundVideo = null;
let mediaId=null,uploadController=null;
function node(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
function time(value) { const n = Math.floor(value); return `${n >= 3600 ? `${Math.floor(n / 3600)}:` : ''}${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
function rememberJob(id) { sessionStorage.setItem('course-zero-last-job',id); localStorage.setItem('course-zero-last-job',id); }
function status(text, good = false) { $('status').textContent = text; $('status').className = `status${good ? ' success' : ''}`; }
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = node('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The local server could not complete this request.');
  return data;
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('#source-form input, #source-form textarea, #source-form select, #convert, #demo, #regenerate-demo, #publisher-example, .chapter-link').forEach(e => e.disabled = value || (e.classList.contains('chapter-link') && !lastInput && !e.dataset.completed));
  $('convert').textContent = value ? 'Writing…' : $('scope').value === 'full-video' ? 'Write the full video ↗' : 'Write this chapter ↗';
  $('export-pdf').disabled = value || !current;
  $('cancel-job').classList.toggle('hidden', !value);
  $('cancel-job').disabled = !value || (!jobId && !uploadController);
  $('start').disabled=value || $('scope').value==='full-video';
  $('retry-job').classList.add('hidden');
}
function showPipeline(job) {
  $('pipeline').classList.remove('hidden'); $('pipeline').replaceChildren();
  for (const [key, name] of phases) {
    const done = job.stages.some(s => s.stage === key) && key !== job.stage;
    const blocked = key === job.stage && ['needs_input', 'failed'].includes(job.status);
    $('pipeline').append(node('span', `${blocked ? '! ' : done ? '✓ ' : ''}${name}`, `stage ${blocked ? 'blocked' : job.stage === key ? 'current' : done ? 'done' : ''}`));
  }
}
function view(name) {
  for (const tab of ['read', 'markdown', 'evidence']) $(`${tab}-view`).classList.toggle('hidden', tab !== name);
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => view(button.dataset.view)));

function openScreen(event){
  const dialog=node('dialog',null,'screen-dialog'),close=node('button','Close screen ×'),image=node('img');
  close.type='button';close.addEventListener('click',()=>dialog.close());
  image.src=event.image;image.alt=`Original source screen at ${time(event.at)}`;
  dialog.append(close,node('h3',`${event.title} · ${time(event.at)}`),image);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
}
function screenButton(event){const button=node('button','Open full-size screen ↗','screen-open');button.type='button';button.addEventListener('click',()=>openScreen(event));return button;}

function showEvidence(result) {
  const target = $('evidence-view'); target.replaceChildren();
  const { report, chapter } = result;
  const metrics = node('div', null, 'metrics');
  for (const [value, label] of [ [`${report.segmentCoverage.covered}/${report.segmentCoverage.total}`, 'Source IDs retained'], [report.codeStates, 'Exact supplied code states'], ['Review', 'Teaching fidelity unverified'] ]) {
    const metric = node('div', null, 'metric'); metric.append(node('strong', String(value)), node('span', label)); metrics.append(metric);
  }
  target.append(metrics, node('p', result.provenance), node('p', report.limits));
  target.append(node('h3', 'What needs a closer look'));
  const warnings = node('ul');
  for (const message of [...result.generated.warnings, ...report.warnings]) warnings.append(node('li', message));
  target.append(warnings, node('h3', 'Screen-check plan'), node('p', result.evidence.some(e=>e.image && /Extracted automatically/.test(e.origin)) ? 'This video was captured at periodic and speech-linked moments, then read by the local vision model. Actual frames are retained below. Brief states can be missed and transcriptions need checking.' : 'These are suggested capture times. Supplied records do not establish that the whole screen was captured. Local speech transcription is available for uploaded recordings.'));
  for (const f of result.framePlan) {
    const row = node('div', null, 'frame-row'); row.append(node('strong', time(f.at)), node('span', f.reason), node('span', f.status === 'capture-needed' ? 'Capture needed' : 'Record supplied', f.status === 'capture-needed' ? 'missing' : '')); target.append(row);
  }
  target.append(node('h3', 'Supplied visual records'));
  if (!result.evidence.length) target.append(node('p', 'No visual records supplied. Code and unspoken screen details cannot be recovered from a URL alone.'));
  for (const event of result.evidence) {
    const card = node('details', null, 'evidence-card'); card.append(node('summary', `${time(event.at)} · ${event.title} · ${event.kind}`), node('p', event.origin), node('pre', event.content));
    if (event.image) { const img = node('img'); img.src = event.image; img.alt = `Captured screen at ${time(event.at)}`; card.append(img,screenButton(event)); }
    target.append(card);
  }
  target.append(node('h3', 'Complete source wording'), node('p', 'Check the prose against these original cues. ID coverage alone cannot tell whether every concept survived.'));
  for (const s of chapter.segments) {
    const card = node('details', null, 'evidence-card'); card.append(node('summary', `${s.id} · ${time(s.start)}–${time(s.end)}`), node('pre', s.text)); target.append(card);
  }
}
function showResult(result, book = null) {
  if (result.conversionScope === 'full-video' && result.chapters) { showResult(result.chapters[0],result); return; }
  current = book || result;
  $('welcome').classList.add('hidden'); $('result').classList.remove('hidden');
  $('result-kicker').textContent = book ? `FULL VIDEO / CHAPTER ${book.chapters.indexOf(result)+1} OF ${book.chapters.length}` : result.source.synthetic ? 'ORIGINAL SAMPLE / SIMULATED TIMELINE' : 'ONE CHAPTER / WRITTEN EDITION';
  $('source-title').textContent = result.source.title;
  $('source-meta').textContent = `${result.source.author} · ${time(result.chapter.start)}–${time(result.chapter.end)} · ${result.generated.mode === 'model' ? `Written locally${result.generated.cached ? ' · saved sample' : ''}` : 'Original source text; no rewriting'}`;
  const report = result.report;
  $('review-strip').textContent = `${report.segmentCoverage.covered}/${report.segmentCoverage.total} teaching passages included · ${result.evidence.filter(e=>e.image).length} captured screens${result.generated.sourceFallbackSegments?.length ? ` · ${result.generated.sourceFallbackSegments.length} original explanations retained` : ''} · Please review before relying on the lesson.`;
  // The reading surface starts with the lesson. Full provenance, warnings, and
  // source wording remain available in the evidence view and Markdown export.
  const lessonStart = result.markdown.indexOf('\n## ');
  const lessonEnd = result.markdown.indexOf('\n## Source wording for comparison');
  const reportStart = result.markdown.lastIndexOf('\n## Fidelity report');
  renderMarkdown(result.markdown.slice(lessonStart < 0 ? 0 : lessonStart + 1, lessonEnd < 0 ? reportStart : lessonEnd), $('read-view'));
  for (const event of result.evidence.filter(e=>e.image)) {
    const anchor = [...$('read-view').querySelectorAll('p')].find(p=>p.textContent.includes(`· ${event.id} ·`));
    if (anchor) {
      const observation=anchor.nextElementSibling;
      if(event.kind==='frame' && /Extracted automatically/.test(event.origin || '') && observation?.tagName==='PRE'){
        const details=node('details'),summary=node('summary','Machine screen reading · approximate');
        observation.before(details);details.append(summary,observation);
      }
      const image = node('img'); image.src = event.image; image.alt = `Original screen at ${time(event.at)}. ${event.origin}`; image.loading = 'lazy'; image.style.maxWidth = '100%'; anchor.insertAdjacentElement('afterend',image);image.insertAdjacentElement('afterend',screenButton(event));
    } else {
      const card=node('details',null,'evidence-card'),image=node('img');
      image.src=event.image;image.alt=`Additional original screen at ${time(event.at)}`;image.loading='lazy';
      card.append(node('summary',`${time(event.at)} · ${event.title}`),image,screenButton(event),node('pre',event.content));$('read-view').append(card);
    }
  }
  $('markdown-text').value = current.markdown;
  showEvidence(result); view('read');
  const nav = $('chapter-nav'); nav.replaceChildren(); nav.classList.remove('hidden'); nav.append(node('h3', book ? 'Completed chapters' : 'Windows in this transcript'));
  for (const c of (book?.chapterPlan || result.chapterPlan)) {
    const button = node('button', `${time(c.start)}–${time(c.end)}`, `chapter-link${c.start === result.chapter.start ? ' active' : ''}`);
    button.type = 'button'; button.disabled = !book && !lastInput; button.append(node('span', book ? 'Read →' : 'Create ↗'));
    if (book) button.dataset.completed = 'true';
    button.addEventListener('click', () => { if (!busy) { if (book) { showResult(book.chapters[c.index],book); return; } $('start').value = time(c.start); submit({ ...lastInput, scope:'chapter', start: c.start }); } }); nav.append(button);
  }
  if (!lastInput) nav.append(node('p', 'This result was restored after a refresh. Reimport the original source to create another window.', 'hint'));
  $('state-badge').textContent = result.generated.generationFailed ? 'Source only · writing unavailable' : result.generated.mode === 'model' ? book ? 'Book ready for review' : 'Chapter ready for review' : 'Source edition ready';
  $('export-pdf').disabled = false; applyStyle(pdfStyle);
  $('pdf-hint').textContent = result.generated.mode==='model'?'Choose Full lesson or Study notes for a clean PDF. Original screens stay available in Source review.':'This PDF will contain the source transcript edition. No AI rewriting has taken place.';
}
async function poll(id) {
  const job = await request(`/api/jobs/${id}?progress=1`);
  if (id !== jobId) return;
  showPipeline(job);
  if (job.status === 'running') {
    $('state-badge').textContent = 'Creating chapter';
    status(`${job.progress?.message || `Working through ${phases.find(([key]) => key === job.stage)?.[1].toLowerCase() || 'the source'}`}… Local writing can take a few minutes. You can stop it without accepting a partial chapter.`);
    setTimeout(() => poll(id).catch(fail), 650); return;
  }
  sessionStorage.removeItem('course-zero-job');
  if (job.input && !lastInput) restoreInput(job.input);
  if (job.status === 'ready') { showResult(job.result); status(job.result.generated.generationFailed ? job.result.generated.warnings[0] : job.result.generated.mode === 'source' ? 'Source edition ready. No model rewriting was requested. You can review the supplied wording or export it.' : 'Chapter ready. Review the manuscript, choose a layout, and download your PDF.', !job.result.generated.generationFailed); }
  else {
    $('state-badge').textContent = job.status === 'needs_input' ? 'Source material needed' : 'Check the source'; status(job.input?.access === 'google' ? 'This saved attempt used cloud video access, which is disabled in this local-only build. Use accessible publisher material or an authorized source import.' : job.message);
    if (job.status === 'needs_input') { $('source-details').open = true; $('import-badge').textContent = 'needed'; }
  }
  setBusy(false);
  if (['failed', 'interrupted', 'cancelled'].includes(job.status) || job.result?.generated?.generationFailed) $('retry-job').classList.remove('hidden');
  if (job.storageWarning) status(job.storageWarning);
  refreshHistory();
}
function fail(error) { setBusy(false); sessionStorage.removeItem('course-zero-job'); $('state-badge').textContent = 'Needs attention'; status(error.message || 'Could not reach the local server. Start it again and retry.'); }
async function submit(input) {
  if (busy) return;
  // Keep the open manuscript/export until the server accepts the next job.
  const previousJob=jobId;let accepted=false;jobId=null;setBusy(true); status('Opening the source and preparing a chapter…');
  try {
    const job = await request('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    accepted=true;lastInput=input;current=null;$('result').classList.add('hidden');$('welcome').classList.remove('hidden');$('chapter-nav').classList.add('hidden');
    jobId = job.id; $('cancel-job').disabled = false; sessionStorage.setItem('course-zero-job', job.id); rememberJob(job.id); await poll(job.id);
  } catch (error) { if(!accepted)jobId=previousJob;fail(error); }
}
$('source-form').addEventListener('submit', async event => {
  event.preventDefault();
  if(busy)return;
  if($('source-kind').value==='media' && !mediaId){
    const file=$('media-file').files[0];if(!file){status('Choose an audio or video recording first.');return;}
    if(file.size>1_000_000_000){status('Choose a recording under 1 GB.');return;}
    uploadController=new AbortController();setBusy(true);status(`Saving recording on this device (${Math.ceil(file.size/1e6)} MB)…`);
    try{const saved=await request('/api/media',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file,signal:uploadController.signal});mediaId=saved.id;$('media-name').textContent=`${saved.title} · saved on this device`;}
    catch(error){status(error.name==='AbortError'?'Recording upload stopped.':error.message);return;}
    finally{uploadController=null;setBusy(false);}
  }
  const formInput = { sourceType: $('source-kind').value,mediaId:mediaId || undefined, scope:$('scope').value, title: $('local-title').value.trim(), url: $('url').value.trim(), start: $('start').value.trim(), duration: Number($('duration').value), transcript: $('transcript').value, evidence, useModel: $('engine').value !== 'source', provider:'local' };
  boundVideo = videoIdentity(formInput.url); submit(formInput);
});
$('demo').addEventListener('click', () => submit({ demo: true, sample: true, start: 0, duration: 480 }));
$('regenerate-demo').addEventListener('click', () => submit({ demo: true, force: true, start: 0, duration: 480, useModel: true, provider: 'local' }));
$('publisher-example').addEventListener('click', () => {
  if (busy) return;
  evidence=[]; $('transcript').value=''; $('transcript-file').value=''; $('evidence-file').value=''; $('import-badge').textContent='Fetch automatically'; $('evidence-name').textContent='Screens will be extracted from the publisher video.';
  $('source-kind').value = 'youtube'; showSourceKind();
  $('url').value = 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/lecture-12-searching-and-sorting/'; handleVideoChange();
  $('start').value = '10:00'; $('duration').value = '300'; $('scope').value = 'chapter'; $('engine').value = 'local'; updateEngineStatus();
  updateAccess();
  status('Real publisher source selected: MIT OpenCourseWare, CC BY-NC-SA 4.0. This run is for noncommercial use. Choose Write this chapter to fetch the source and screens.',true);
});
$('cancel-job').addEventListener('click', async () => {
  if(uploadController){uploadController.abort();return;}
  if (!jobId || !busy) return;
  $('cancel-job').disabled = true;
  try { await request(`/api/jobs/${jobId}/cancel`, { method: 'POST' }); await poll(jobId); } catch (error) { fail(error); }
});
$('retry-job').addEventListener('click', () => { if (lastInput && !busy) submit({ ...lastInput, force: true, resumeJobId:jobId }); });
function restoreInput(input) {
  lastInput = input.imported ? null : input;
  if (input.imported) {
    $('url').value = ''; $('transcript').value = ''; $('transcript-file').value = ''; $('evidence-file').value = ''; evidence = []; boundVideo = null;
    $('source-kind').value = 'youtube'; $('local-title').value = ''; showSourceKind();
    $('import-badge').textContent = 'Add source'; $('evidence-name').textContent = 'Add new sources only when starting another conversion.';
    return;
  }
  if (input.url) $('url').value = input.url;
  $('source-kind').value = input.sourceType || 'youtube'; $('local-title').value = input.title || ''; showSourceKind();
  mediaId=input.mediaId || null;if(mediaId)$('media-name').textContent='Saved recording selected. Upload the original again if it is missing on this device.';
  if (input.start != null) $('start').value = typeof input.start === 'number' ? time(input.start) : input.start;
  if (input.duration) $('duration').value = String(input.duration);
  $('scope').value = input.scope || 'chapter';
  updateAccess();
  if (input.transcript) $('transcript').value = typeof input.transcript === 'string' ? input.transcript : JSON.stringify(input.transcript, null, 2);
  evidence = input.evidence || [];
  $('evidence-name').textContent = `${evidence.length} saved visual records restored with this source.`;
  $('engine').value = input.useModel === false ? 'source' : 'local';
  boundVideo = videoIdentity($('url').value);
  if ($('transcript').value) $('import-badge').textContent = 'saved source';
  updateEngineStatus();
}
async function refreshHistory() {
  try {
    const history = await request('/api/history'); $('history-list').replaceChildren();
    if (!history.length) $('history-list').append(node('p', 'No saved chapters yet.', 'hint'));
    for (const item of history) {
      const button = node('button', `${item.title} · ${item.status}`, 'history-item'); button.type = 'button';
      button.addEventListener('click', async () => {
        if (busy) return;
        jobId = item.id; lastInput = null; rememberJob(item.id);
        const saved = await request(`/api/jobs/${item.id}`).catch(error => { fail(error); return null; });
        if (!saved) return; restoreInput(saved.input || {}); await poll(item.id).catch(fail);
      }); $('history-list').append(button);
    }
  } catch { /* The active chapter still works when history is unavailable. */ }
}
function videoIdentity(value) {
  try { const url = new URL(/^https?:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`); return url.hostname === 'youtu.be' ? url.pathname.split('/')[1] : url.searchParams.get('v') || url.pathname; }
  catch { return value.trim(); }
}
function showSourceKind() {
  const local = $('source-kind').value === 'local',media=$('source-kind').value==='media';
  $('video-fields').classList.toggle('hidden', local || media); $('local-source-fields').classList.toggle('hidden', !(local || media));
  $('media-source-fields').classList.toggle('hidden',!media);
  $('url').required = !(local || media); $('local-title').required = local;
  if (local) $('source-details').open = true;
}
$('source-kind').addEventListener('change', () => {
  $('start').value = '00:00';
  mediaId=null;$('media-file').value='';$('local-title').value='';$('media-name').textContent='Choose a recording. Speech transcription and screen reading run on this device.';
  evidence=[]; $('transcript').value=''; $('transcript-file').value=''; $('evidence-file').value=''; boundVideo=null;
  lastInput=null;$('chapter-nav').classList.add('hidden');
  $('import-badge').textContent='Add source'; $('evidence-name').textContent='Previous source records cleared for the new source type.'; showSourceKind();
});
$('media-file').addEventListener('change',()=>{mediaId=null;const file=$('media-file').files[0];$('local-title').value=file?.name || '';$('media-name').textContent=file ? `${file.name} · ${Math.ceil(file.size/1e6)} MB · ready for local processing` : 'Choose a recording.';});
function updateAccess() {
  const whole = $('scope').value === 'full-video';
  $('start').disabled = busy || whole;
  if (!busy) $('convert').textContent = whole ? 'Write the full video ↗' : 'Write this chapter ↗';
}
$('scope').addEventListener('change',updateAccess);
function handleVideoChange() {
  const next = videoIdentity($('url').value);
  if (boundVideo && boundVideo !== next) {
    evidence = []; $('transcript').value = ''; $('transcript-file').value = ''; $('evidence-file').value = '';
    $('evidence-name').textContent = 'Old visual records cleared for the new video.'; $('import-badge').textContent = 'Add source';
    lastInput = null;$('chapter-nav').classList.add('hidden');
    status('New video selected. Previous source attachments were cleared. Your open chapter is still available until the next conversion starts.');
  }
  boundVideo = next;
  try {
    const url = new URL(/^https?:/i.test($('url').value) ? $('url').value : `https://${$('url').value}`);
    const value = url.searchParams.get('t') || url.searchParams.get('start') || '';
    const n = /^\d+s?$/.test(value) ? Number(value.replace('s', '')) : Number(value.match(/(\d+)h/)?.[1] || 0) * 3600 + Number(value.match(/(\d+)m/)?.[1] || 0) * 60 + Number(value.match(/(\d+)s/)?.[1] || 0);
    if (value && Number.isFinite(n) && n <= 85800) $('start').value = time(n);
  } catch { /* Server validation supplies the URL error. */ }
}
$('url').addEventListener('input', handleVideoChange);
$('url').addEventListener('change', handleVideoChange);
$('transcript').addEventListener('input', () => { if ($('transcript').value.trim() && !boundVideo) boundVideo = videoIdentity($('url').value); });
function updateEngineStatus() {
  const local = healthState?.local;
  $('model-status').textContent = $('engine').value === 'source' ? 'Source text is retained without model rewriting.' : (local?.available ? `${local.model} · runs through local Ollama` : 'Local model unavailable. Start Ollama; the connection is checked automatically.');
}
$('engine').addEventListener('change', updateEngineStatus);
function applyStyle(style) {
  if (!['textbook', 'companion', 'classic'].includes(style)) style = 'textbook';
  pdfStyle = style; $('result').classList.remove('layout-textbook', 'layout-companion', 'layout-classic'); $('result').classList.add(`layout-${style}`);
  $('mobile-style').value = style;
  localStorage.setItem('course-zero-pdf-style', style);
  document.querySelectorAll('[data-pdf-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pdfStyle === style)));
}
document.querySelectorAll('[data-pdf-style]').forEach(button => button.addEventListener('click', () => applyStyle(button.dataset.pdfStyle)));
$('mobile-style').addEventListener('change', () => applyStyle($('mobile-style').value));
$('mobile-pdf').addEventListener('click', () => $('export-pdf').click());
function applyEdition(){
  const edition=$('pdf-edition').value;
  $('edition-hint').textContent=edition==='source'?'Original screens, detailed timestamps, raw source and review notes.':edition==='notes'?'Compact study notes with every explanation and code step retained. No video screenshots.':'Complete explanations and readable code. No video screenshots or repeated timestamps.';
  $('pdf-content-label').textContent=edition==='source'?'Source & review records':edition==='notes'?'Complete study notes':'Full written lesson';
  $('pdf-timestamps').disabled=edition==='source';
  localStorage.setItem('course-zero-pdf-edition',edition);
}
$('pdf-edition').value=['lesson','notes','source'].includes(localStorage.getItem('course-zero-pdf-edition'))?localStorage.getItem('course-zero-pdf-edition'):'lesson';
$('pdf-edition').addEventListener('change',applyEdition);applyEdition();
$('export-pdf').addEventListener('click', async () => {
  if (!current || !jobId) return;
  const chosenStyle = pdfStyle,edition=$('pdf-edition').value,timestamps=$('pdf-timestamps').checked,exportJob=jobId,exportStart=Math.floor(current.chapter.start); $('export-pdf').disabled = true; $('mobile-pdf').disabled = true; $('pdf-hint').textContent = edition==='source'?'Typesetting the source review…':'Preparing readable code and typesetting the chapter locally. The first clean export may take a few minutes…';
  try {
    const response = await fetch(`/api/jobs/${exportJob}/pdf?style=${chosenStyle}&edition=${edition}&timestamps=${timestamps}`);
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'PDF export failed.'); }
    download(`nant-${exportStart}-${edition}-${chosenStyle}.pdf`, await response.arrayBuffer(), 'application/pdf');
    try{const refreshed=await request(`/api/jobs/${exportJob}`);if(jobId===exportJob && refreshed.result)current=refreshed.result;}catch{/* The downloaded PDF remains usable if refreshing its saved metadata fails. */}
    $('pdf-hint').textContent = edition==='source'?'PDF downloaded with source screens and review records.':'PDF downloaded. Full teaching content, readable code, and no video screenshots.';
  } catch (error) { $('pdf-hint').textContent = error.message; }
  finally { $('export-pdf').disabled = !current; $('mobile-pdf').disabled = !current; }
});
async function readImport(file, maximum) {
  if (!file) return null;
  if (file.size > maximum) throw new Error(`The selected file is too large (limit ${maximum / 1_000_000} MB).`);
  return file.text();
}
async function openChapter(data) {
  const restored = await request('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  jobId = restored.id; lastInput = null; rememberJob(jobId);
  await poll(jobId);
}
$('open-chapter').addEventListener('change', async event => {
  if (busy) return;
  if(!event.target.files[0])return;setBusy(true);status('Opening the saved course…');
  try { const text = await readImport(event.target.files[0], MAX_BUNDLE_BYTES); if (text) await openChapter(JSON.parse(text)); }
  catch (error) { setBusy(false);status(error instanceof SyntaxError ? 'The saved chapter JSON is invalid.' : error.message); }
});
$('transcript-file').addEventListener('change', async event => {
  try {
    const text = await readImport(event.target.files[0], 2_000_000); if (!text) return;
    let imported;
    if (/^[\s\uFEFF]*[\[{]/.test(text)) { try { imported = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('The transcript JSON could not be read.'); } }
    if (imported?.schemaVersion === 1 && imported.chapter && imported.generated) { await openChapter(imported); return; }
    evidence = Array.isArray(imported?.evidence) ? imported.evidence : [];
    $('evidence-name').textContent = `${evidence.length} visual records loaded with this source. Previous visual records were replaced.`;
    const importedTranscript = imported?.segments ?? imported?.transcript;
    $('transcript').value = importedTranscript ? (typeof importedTranscript === 'string' ? importedTranscript : JSON.stringify(importedTranscript, null, 2)) : text;
    if (imported?.sourceType === 'local') { $('source-kind').value = 'local'; $('local-title').value = typeof imported.title === 'string' ? imported.title.slice(0, 300) : ''; showSourceKind(); }
    const sourceStart = imported?.start ?? (Array.isArray(importedTranscript) ? importedTranscript[0]?.start : Array.isArray(imported) ? imported[0]?.start : null);
    $('start').value = sourceStart == null ? '00:00' : typeof sourceStart === 'number' && Number.isFinite(sourceStart) && sourceStart >= 0 ? time(sourceStart) : String(sourceStart);
    if ([300, 480, 600].includes(Number(imported?.duration))) $('duration').value = String(imported.duration);
    boundVideo = $('source-kind').value === 'youtube' ? videoIdentity($('url').value) : null; $('import-badge').textContent = 'supplied'; status('Source loaded. Check the title and chapter window before writing.', true);
  } catch (error) { status(error.message); }
});
$('evidence-file').addEventListener('change', async event => {
  try {
    const text = await readImport(event.target.files[0], 4_500_000); if (!text) return;
    let imported; try { imported = JSON.parse(text); } catch { throw new Error('Visual records must be valid JSON.'); }
    const rows = Array.isArray(imported) ? imported : imported.evidence;
    if (!Array.isArray(rows)) throw new Error('Use a JSON array of visual records or an object with an evidence array.');
    evidence = rows; boundVideo = videoIdentity($('url').value); $('evidence-name').textContent = `${rows.length} visual records loaded. Their timestamps must match this video.`; status('Visual records loaded. They will be preserved in the selected chapter.', true);
  } catch (error) { status(error.message); }
});
$('schema-download').addEventListener('click', () => download('visual-records-example.json', JSON.stringify([
  { at: 125, kind: 'code', title: 'Version 1', language: 'python', content: "print('hello')", origin: 'Transcribed from my authorized recording at 02:05' },
  { at: 130, kind: 'terminal', title: 'Program output', content: 'hello' },
  { at: 140, kind: 'diagram', title: 'Data flow', content: 'Describe the visible labels, arrows, dimensions, and their meaning.' }
], null, 2), 'application/json'));
$('clear-source').addEventListener('click', () => {
  if (busy) return;
  evidence = []; $('transcript').value = ''; $('transcript-file').value = ''; $('evidence-file').value = '';
  sessionStorage.removeItem('course-zero-last-job'); localStorage.removeItem('course-zero-last-job');
  $('evidence-name').textContent = 'Code versions, terminal output, diagrams, or frames, with timestamps.';
  $('import-badge').textContent = 'optional'; status('Imported captions and visual records cleared.');
});
$('export-md').addEventListener('click', () => { if (current) download(`chapter-${Math.floor(current.chapter.start)}.md`, current.markdown, 'text/markdown'); });
$('export-json').addEventListener('click', () => { if (current) download(`chapter-${Math.floor(current.chapter.start)}.evidence.json`, JSON.stringify(bundleForExport(current), null, 2), 'application/json'); });
async function refreshHealth(){
  try{const health=await request('/api/health');healthState=health;updateEngineStatus();updateAccess();$('connection-badge').textContent=health.local?.available?'LOCAL MODEL CONNECTED':'LOCAL MODEL NOT CONNECTED';}
  catch{$('model-status').textContent='Server unavailable';$('connection-badge').textContent='SERVER NOT CONNECTED';}
}
refreshHealth();setInterval(refreshHealth,15000);
applyStyle(localStorage.getItem('course-zero-pdf-style') || 'textbook'); refreshHistory();
const savedJob = sessionStorage.getItem('course-zero-job') || sessionStorage.getItem('course-zero-last-job') || localStorage.getItem('course-zero-last-job');
if (savedJob) { sessionStorage.setItem('course-zero-last-job',savedJob); jobId = savedJob; setBusy(true); poll(savedJob).catch(fail); }

document.getElementById('hero-demo').addEventListener('click',()=>{document.getElementById('demo').click();document.getElementById('study-desk').scrollIntoView({behavior:'smooth'});});
