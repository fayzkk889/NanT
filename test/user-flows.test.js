import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';
import { parseTranscript, selectChapter } from '../src/transcript.js';
import { parseYouTubeURL } from '../src/youtube.js';
import { batchSegments, generateLocally } from '../src/local-model.js';
import { restoreChapter } from '../src/restore.js';
import { createChapterPDF } from '../src/pdf.js';
import { runPipeline } from '../src/pipeline.js';
import { jobStore } from '../src/job-store.js';
import { randomUUID } from 'node:crypto';

const fixture = JSON.parse(await readFile(new URL('../fixtures/original-lesson.json', import.meta.url), 'utf8'));
const offline = async () => { throw new Error('Offline'); };
test('Concurrent persistence updates keep the final state and omit runtime warnings', async () => {
  const scratch = fileURLToPath(new URL('../work/test-stores/', import.meta.url));
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'concurrent-'));
  const store = jobStore(directory), id = randomUUID();
  await Promise.all(Array.from({length: 12}, (_, index) => store.save({id, input: {}, status: index === 11 ? 'cancelled' : 'running', index, storageWarning: 'stale'})));
  const saved = await store.get(id); assert.equal(saved.index, 11); assert.equal(saved.status, 'cancelled'); assert.equal(saved.storageWarning, undefined);
});
async function listen(options = {}) {
  const app = createApp({ env: {}, fetcher: offline, ...options });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = async (route, input) => {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) });
    return { status: response.status, data: await response.json() };
  };
  const get = async route => (await fetch(base + route)).json();
  const finish = async id => {
    for (let n = 0; n < 100; n++) { const job = await get(`/api/jobs/${id}`); if (job.status !== 'running') return job; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('Job did not settle');
  };
  return { app, base, post, get, finish, close: () => new Promise(r => app.close(r)) };
}
test('A novice can paste a normal timestamp transcript or a scheme-less timestamped link', () => {
  const segments = parseTranscript('0:00\nFirst explanation.\n\n2:30 A correction.');
  assert.equal(segments.length, 2); assert.equal(segments[0].end, 150); assert.equal(segments[1].end, 155); assert.equal(segments[0].endEstimated, true);
  assert.equal(parseYouTubeURL('youtu.be/kCc8FmEb1nY/?t=1m20s').initialStart, 80);
  assert.equal(parseYouTubeURL('youtube.com/watch?v=kCc8FmEb1nY&t=600').initialStart, 600);
});
test('Dense ten-minute caption sources are accepted and batching preserves each source ID once', () => {
  const segments = parseTranscript(Array.from({ length: 600 }, (_, i) => ({ start: i, end: i + 1, text: `Explanation at second ${i}.` })));
  const chapter = selectChapter(segments, 0, 600); assert.equal(chapter.segments.length, 600);
  const batches = batchSegments(chapter.segments); assert.ok(batches.length > 1); assert.deepEqual(batches.flat().map(s => s.id), segments.map(s => s.id));
});
test('A public URL does not require an ownership checkbox just to discover missing sources', async () => {
  const app = await listen();
  try {
    const response = await app.post('/api/jobs', { url: 'https://youtu.be/kCc8FmEb1nY' });
    const job = await app.finish(response.data.id); assert.equal(job.status, 'needs_input'); assert.match(job.message, /Captions/);
  } finally { await app.close(); }
});
test('Double clicks reuse one running job; an explicit force action creates a new run', async () => {
  let release; const waiting = new Promise(r => release = r); let calls = 0;
  const app = await listen({ pipeline: async () => { calls++; await waiting; return { markdown: 'done' }; } });
  try {
    const first = await app.post('/api/jobs', { demo: true });
    const duplicate = await app.post('/api/jobs', { demo: true });
    assert.equal(first.data.id, duplicate.data.id); assert.equal(duplicate.data.reused, true); assert.equal(calls, 1);
    const forced = await app.post('/api/jobs', { demo: true, force: true }); assert.notEqual(first.data.id, forced.data.id);
  } finally { release(); await app.close(); }
});

test('Local conversions queue without running two inference pipelines together',async()=>{
  let release,active=0,peak=0,calls=0;const gate=new Promise(resolve=>release=resolve);
  const app=await listen({pipeline:async()=>{calls++;active++;peak=Math.max(peak,active);if(calls===1)await gate;active--;return {markdown:'Finished'};}});
  try{
    const first=await app.post('/api/jobs',{demo:true});const second=await app.post('/api/jobs',{demo:true,force:true});
    assert.equal(calls,1);assert.match((await app.get('/api/jobs/'+second.data.id)).progress.message,/Waiting/);
    release();await app.finish(first.data.id);await app.finish(second.data.id);assert.equal(calls,2);assert.equal(peak,1);
  }finally{release();await app.close();}
});
test('Book progress polling does not retransmit completed chapter images or imported source data',async()=>{
 let release,checkpointed;const gate=new Promise(r=>release=r),saved=new Promise(r=>checkpointed=r);
 const app=await listen({pipeline:async(input,{onCheckpoint})=>{await onCheckpoint([{evidence:[{image:'x'.repeat(100000)}]}]);checkpointed();await gate;return {markdown:'Completed book'};}});
 try{
  const started=await app.post('/api/jobs',{demo:true,evidence:[{image:'y'.repeat(100000)}]});await saved;
  const response=await fetch(app.base+'/api/jobs/'+started.data.id+'?progress=1'),text=await response.text(),progress=JSON.parse(text);
  assert.ok(text.length<2000);assert.equal(progress.completedChapters,1);assert.equal(progress.partial,undefined);assert.equal(progress.input,undefined);
  const full=await app.get('/api/jobs/'+started.data.id);assert.equal(full.partial[0].evidence[0].image.length,100000);
  release();await app.finish(started.data.id);assert.equal((await app.get('/api/jobs/'+started.data.id+'?progress=1')).result.markdown,'Completed book');
 }finally{release();await app.close();}
});
test('Saved books use the current presentation for the book and each readable chapter',async()=>{
 const book=await runPipeline({scope:'full-video',duration:300},{fixture});book.markdown='STALE PRESENTATION';book.chapters.forEach(part=>part.markdown='STALE PRESENTATION');
 const app=await listen({pipeline:async()=>book});try{const started=await app.post('/api/jobs',{demo:true});const job=await app.finish(started.data.id);assert.notEqual(job.result.markdown,'STALE PRESENTATION');assert.ok(job.result.chapters.every(part=>part.markdown!=='STALE PRESENTATION'));assert.match(job.result.chapters[0].markdown,/Source:/);}finally{await app.close();}
});
test('Stop cancels the active work and never accepts its later partial result', async () => {
  const app = await listen({ pipeline: async (_input, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }) });
  try {
    const started = await app.post('/api/jobs', { demo: true });
    const stopped = await app.post(`/api/jobs/${started.data.id}/cancel`);
    assert.equal(stopped.data.status, 'cancelled');
    const job = await app.finish(started.data.id); assert.equal(job.status, 'cancelled'); assert.equal(job.result, null);
  } finally { await app.close(); }
});
test('Completed chapters and PDF export survive a real server restart', async () => {
  const scratch = fileURLToPath(new URL('../work/test-stores/', import.meta.url));
  await mkdir(scratch, { recursive: true }); const directory = await mkdtemp(path.join(scratch, 'restart-'));
  const first = await listen({ dataDir: directory });
  let id;
  try { const response = await first.post('/api/jobs', { demo: true, sample: true }); id = response.data.id; assert.equal((await first.finish(id)).status, 'ready'); }
  finally { await first.close(); }
  const restarted = await listen({ dataDir: directory });
  try {
    const job = await restarted.get(`/api/jobs/${id}`); assert.equal(job.status, 'ready'); assert.equal(job.result.source.synthetic, true);
    assert.ok((await restarted.get('/api/history')).some(j => j.id === id));
    const response = await fetch(`${restarted.base}/api/jobs/${id}/pdf?style=classic`); assert.equal(response.status, 200); assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    assert.equal(JSON.stringify(job).includes('controller'), false);
  } finally { await restarted.close(); }
});
test('An exported chapter reopens without a model and tampered source IDs fail clearly', async () => {
  const saved = await runPipeline({ demo: true }, { fixture });
  const restored = restoreChapter(saved); assert.equal(restored.chapter.segments.length, 8); assert.match(restored.provenance, /Imported/);
  const app = await listen();
  try {
    const response = await app.post('/api/restore', saved); assert.equal(response.status, 201);
    const job = await app.get(`/api/jobs/${response.data.id}`); assert.equal(job.status, 'ready'); assert.equal(job.result.generated.mode, 'source');
    const tampered = structuredClone(saved); tampered.chapter.segments[1].id = tampered.chapter.segments[0].id;
    assert.equal((await app.post('/api/restore', tampered)).status, 400);
    assert.equal((await app.post('/api/restore', {})).status, 400);
  } finally { await app.close(); }
});
test('A very long code line exports with visible wrapping and its original source remains intact', async () => {
  const content = `const longValue = "${'abc'.repeat(150)}";`;
  const result = await runPipeline({ demo: true }, { fixture: { ...fixture, evidence: [{ at: 10, kind: 'code', content, language: 'javascript' }] } });
  const bytes = await createChapterPDF(result); assert.equal(bytes.subarray(0, 4).toString(), '%PDF'); assert.equal(result.evidence[0].content, content);
});
test('Cancellation propagates through the local model adapter', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generateLocally({ segments: [], start: 0, end: 300 }, [], {}, '', { signal: controller.signal, fetcher: offline }));
});
test('Long local writing is split into ordered parts with real progress events', async () => {
  const segments = parseTranscript(Array.from({ length: 8 }, (_, i) => ({ start: i * 30, end: (i + 1) * 30, text: `Point ${i}. ` + 'An explanation with reasoning. '.repeat(90) })));
  const progress = [];
  const output = await generateLocally({ segments, start: 0, end: 300 }, [], {}, 'Write a lesson.', { env: {}, onProgress: value => progress.push(value), fetcher: async (url, options) => {
    if (url.endsWith('/tags')) return { ok: true, json: async () => ({ models: [{ name: 'local-test' }] }) };
    const supplied = JSON.parse(JSON.parse(options.body).messages[1].content).segments;
    const draft = { title: 'Long lesson', sections: supplied.map(s => ({ heading: 'A step', segment_ids: [s.id], markdown: s.text, uncertainties: [] })) };
    return { ok: true, json: async () => ({ done: true, done_reason: 'stop', message: { content: JSON.stringify(draft) } }) };
  } });
  assert.deepEqual(output.draft.sections.flatMap(s => s.segment_ids), segments.map(s => s.id));
  assert.ok(progress.at(-1).total > 1); assert.equal(progress.at(-1).completed, progress.at(-1).total);
});
test('Local recording transcripts do not need a fake YouTube link or fabricated timestamp links', async () => {
  const result = await runPipeline({ sourceType: 'local', title: 'My original test recording', transcript: fixture.segments, evidence: fixture.evidence, rightsConfirmed: true, useModel: false }, { env: {}, fetcher: offline });
  assert.equal(result.source.kind, 'local-import'); assert.equal(result.source.url, null); assert.equal(result.source.synthetic, false);
  assert.match(result.markdown, /local source timestamp/); assert.doesNotMatch(result.markdown, /fixture time|watch\?v=/);
  assert.equal(restoreChapter(result).source.kind, 'local-import');
});
