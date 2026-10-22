import {MAX_BUNDLE_BYTES} from './public/course-bundle.js';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { runPipeline } from './src/pipeline.js';
import { InputError, SourceNeeded } from './src/errors.js';
import { discoverLocalModel } from './src/local-model.js';
import {holdLocalRuntime} from './src/local-runtime.js';
import { createChapterPDF,PDF_STYLES } from './src/pdf.js';
import {prepareReadingMaterials,hasReadingMaterials} from './src/reading-materials.js';
import { jobStore } from './src/job-store.js';
import { restoreChapter } from './src/restore.js';
import {createSourceTools} from './src/source-tools.js';
import {mediaStore} from './src/uploads.js';
import {renderMarkdown} from './src/markdown.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(path.join(root, 'fixtures/original-lesson.json'), 'utf8'));
const staticFiles = new Map([
  ['/brand.css', ['public/brand.css', 'text/css; charset=utf-8']],
  ['/logo.svg', ['public/logo.svg', 'image/svg+xml']],
  ['/boot.js', ['public/boot.js', 'text/javascript; charset=utf-8']],
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/markdown-view.js', ['public/markdown-view.js', 'text/javascript; charset=utf-8']],
  ['/course-bundle.js', ['public/course-bundle.js', 'text/javascript; charset=utf-8']],
  ['/fonts/DejaVuSans.ttf', ['assets/fonts/DejaVuSans.ttf', 'font/ttf']],
  ['/fonts/SourceCodePro-Regular.ttf', ['assets/fonts/SourceCodePro-Regular.ttf', 'font/ttf']]
]);
const LIMIT = 6_000_000;
function presentResult(result){
  if(!result?.generated?.draft || !result.chapter?.segments)return result;
  return {...result,...(result.chapters?{chapters:result.chapters.map(presentResult)}:{}),markdown:renderMarkdown(result)};
}
async function readJSON(request, limit = LIMIT) {
  let size = 0, chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new InputError(`Import is too large. Use a JSON request under ${Math.floor(limit/1e6)} MB.`, 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('Request body must be valid JSON.'); }
}
export function createApp({ env = process.env, fetcher = fetch, pipeline = runPipeline, dataDir = null, sourceTools = null } = {}) {
  const jobs = new Map();
  const preparingReading=new Map();
  let processingTail=Promise.resolve();
  const store = jobStore(dataDir);
  const recordings=mediaStore(dataDir ? path.join(dataDir,'uploads') : null);
  const loaded = store.loadAll().catch(() => []).then(saved => {
    for (const job of saved) {
      if (job.status === 'running') { job.status = 'interrupted'; job.message = 'The app restarted while this chapter was being written. Your source is saved; retry to continue.'; }
      jobs.set(job.id, job);
    }
  });
  const save = async job => { try { await store.save(job); delete job.storageWarning; } catch { job.storageWarning = 'Could not save this chapter on the device. Export it before closing the app.'; } };
  async function getJob(id) {
    await store.flush(id);
    const memory = jobs.get(id); if (memory) return memory;
    const saved = await store.get(id);
    if (saved?.status === 'running') { saved.status = 'interrupted'; saved.message = 'The app restarted during writing. Retry using the saved source.'; }
    return saved;
  }
  const server = http.createServer(async (request, response) => {
    const headers = {
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    };
    const send = (status, data, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { ...headers, 'Content-Type': type });
      response.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    try {
      await loaded;
      const actualHost = `127.0.0.1:${server.address().port}`;
      const allowedHosts = [actualHost, `localhost:${server.address().port}`];
      if (!allowedHosts.includes(request.headers.host)) throw new InputError('This app only accepts local requests.', 403);
      const origin = request.headers.origin;
      if (origin && !allowedHosts.some(host => origin === `http://${host}`)) throw new InputError('Cross-origin requests are not accepted.', 403);
      const url = new URL(request.url, `http://${actualHost}`);
      if (request.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, type] = staticFiles.get(url.pathname);
        return send(200, await readFile(path.join(root, file)), type);
      }
      if(request.method==='POST' && url.pathname==='/api/media')return send(201,await recordings.upload(request));
      if (request.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true, savedOnDevice: Boolean(dataDir), sourceProcessing: 'local', sourceToolsConfigured:Boolean(sourceTools), youtubeConfigured: Boolean(env.YOUTUBE_ACCESS_TOKEN), local: await discoverLocalModel({ env, fetcher }) });
      if (request.method === 'GET' && url.pathname === '/api/history') return send(200, [...jobs.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 20).map(j => ({ id: j.id, status: j.status, createdAt: j.createdAt, title: j.result?.source?.title || j.input?.url || 'Chapter in progress' })));
      if (request.method === 'GET' && url.pathname === '/api/fixture') return send(200, fixture);
      if (request.method === 'POST' && url.pathname === '/api/restore') {
        if (!(request.headers['content-type'] || '').startsWith('application/json')) throw new InputError('Use application/json.', 415);
        const result = restoreChapter(await readJSON(request,MAX_BUNDLE_BYTES));
        const input = result.source.url || ['local-import','local-media'].includes(result.source.kind) ? { sourceType: result.source.kind === 'local-import' ? 'local' : result.source.kind==='local-media' ? 'media' : 'youtube',mediaId:result.source.mediaId,url: result.source.url, title: result.source.title, author: result.source.author, transcript: result.chapter.segments, evidence: result.conversionScope === 'full-video' ? [] : result.evidence, scope:result.conversionScope === 'full-video' ? 'full-video' : 'chapter',start:result.chapter.start,duration:result.windowLength || result.chapter.end-result.chapter.start, provider: 'local', useModel: true } : { imported: true };
        const job = { id: randomUUID(), input, createdAt: new Date().toISOString(), status: 'ready', stage: 'complete', stages: [{ stage: 'imported', at: new Date().toISOString() }], result, message: 'Saved chapter opened without a model call.' };
        jobs.set(job.id, job); await save(job); return send(201, { id: job.id, status: job.status });
      }
      if (request.method === 'POST' && url.pathname === '/api/jobs') {
        if (!(request.headers['content-type'] || '').startsWith('application/json')) throw new InputError('Use application/json.', 415);
        const input = await readJSON(request);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Supply a conversion request.');
        const storedInput = Object.fromEntries(['sourceType', 'mediaId', 'title', 'author', 'url', 'transcript', 'evidence', 'start', 'duration', 'scope', 'visuals', 'access', 'useModel', 'provider', 'demo', 'sample'].filter(k => input[k] !== undefined).map(k => [k, input[k]]));
        const configuration={asrModel:env.ASR_MODEL || 'small.en',writingModel:env.OLLAMA_MODEL || 'automatic-local-selection',screenReader:env.SCREEN_READER || 'hybrid'};
        const hash = createHash('sha256').update(JSON.stringify({pipelineRevision:'0.5.0-small-speech-grounding',configuration,input:storedInput})).digest('hex');
        const resumeCandidate = typeof input.resumeJobId === 'string' ? await getJob(input.resumeJobId) : null;
        const resumeParts = resumeCandidate?.hash === hash && Array.isArray(resumeCandidate.partial) ? resumeCandidate.partial : [];
        if (input.force !== true) {
          const existing = [...jobs.values()].find(j => j.hash === hash && (j.status === 'running' || j.status === 'ready') && !j.result?.generated?.generationFailed);
          if (existing) return send(202, { id: existing.id, status: existing.status, reused: true });
        }
        if ([...jobs.values()].filter(j => j.status === 'running').length >= 2) throw new InputError('Two chapters are already processing. Wait for one to finish.', 429);
        while (jobs.size >= 20) {
          const old = [...jobs.values()].find(j => j.status !== 'running');
          if (!old) throw new InputError('The local job queue is full.', 429);
          jobs.delete(old.id);
        }
        const job = { id: randomUUID(), hash, input: storedInput, createdAt: new Date().toISOString(), status: 'running', stage: 'queued', stages: [], result: null, message: '', controller: new AbortController() };
        jobs.set(job.id, job);
        await save(job);
        send(202, { id: job.id, status: job.status });
        const previous=processingTail;let release;
        processingTail=new Promise(resolve=>release=resolve);
        job.progress={message:'Waiting for the current local conversion to finish'};
        // Only source inputs/results are stored locally; runtime credentials are never persisted.
        Promise.resolve().then(async () => {
          await previous;job.controller.signal.throwIfAborted();
          if (input.demo === true && input.sample === true) {
            job.stage = 'sample-loading'; job.stages.push({ stage: 'sample-loading', at: new Date().toISOString() });
            try {
              const saved = JSON.parse(await readFile(path.join(root, 'examples/local-lesson.evidence.json'), 'utf8'));
              if (saved.source.synthetic && saved.generated.mode === 'model') { saved.generated.cached = true; return saved; }
            } catch { /* Show a clear action instead of substituting transcript text for AI prose. */ }
            throw new SourceNeeded('The generated sample is unavailable. Choose Regenerate with my local model to create it.');
          }
          const mediaInput=input.sourceType==='media' ? await recordings.resolve(input.mediaId) : null;
          return pipeline(input, { env, fetcher, fixture: input.demo === true ? fixture : null, signal: job.controller.signal, resumeParts,sourceTools,mediaInput,
          async onCheckpoint(completed) { job.partial = [...completed]; await save(job); },
          onStage(stage) { job.stage = stage; job.progress = null; job.stages.push({ stage, at: new Date().toISOString() }); },
          onProgress(progress) { job.progress = progress; }
        });
        }).then(async result => { if (job.controller.signal.aborted) return; job.result = result; delete job.partial; job.status = 'ready'; job.stage = 'complete'; await save(job); })
          .catch(async error => {
            if (job.controller.signal.aborted) { job.status = 'cancelled'; job.message = 'Writing stopped. No partial model chapter was accepted.'; await save(job); return; }
            job.status = error instanceof SourceNeeded ? 'needs_input' : 'failed';
            job.message = error instanceof InputError || error instanceof SourceNeeded ? error.message : 'The conversion failed unexpectedly. Check the source format and try again.';
            await save(job);
            // Keep the last attempted stage visible; entering a stage does not
            // mean it succeeded when the job needs input or fails.
          }).finally(()=>release());
        return;
      }
      const cancelMatch = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/cancel$/);
      if (request.method === 'POST' && cancelMatch) {
        const job = jobs.get(cancelMatch[1]);
        if (!job) throw new InputError('This running chapter was not found.', 404);
        if (job.status === 'running') { job.controller.abort(); job.status = 'cancelled'; job.message = 'Writing stopped. Your source is retained for retry.'; await save(job); }
        return send(200, { id: job.id, status: job.status });
      }
      const pdfMatch = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/pdf$/);
      if (request.method === 'GET' && pdfMatch) {
        const job = await getJob(pdfMatch[1]);
        if (!job?.result || job.status !== 'ready') throw new InputError('Create a chapter before exporting PDF.', 404);
        const style = url.searchParams.get('style') || 'textbook';
        const edition=url.searchParams.get('edition') || 'lesson',timestamps=url.searchParams.get('timestamps')==='true';
        if(!Object.hasOwn(PDF_STYLES,style))throw new InputError('Choose Textbook, Code Companion, or Print Classic.');
        if(!['lesson','notes','source'].includes(edition))throw new InputError('Choose Full lesson, Study notes, or Source review.');
        if(edition!=='source' && !hasReadingMaterials(job.result)){
          if(!preparingReading.has(job.id)){
            const previous=processingTail;let release;processingTail=new Promise(resolve=>release=resolve);
            const pending=previous.then(()=>prepareReadingMaterials(job.result,{env,fetcher})).then(async result=>{job.result=result;await save(job);}).finally(()=>{release();preparingReading.delete(job.id);});
            preparingReading.set(job.id,pending);
          }
          await preparingReading.get(job.id);
        }
        const buffer = await createChapterPDF(job.result, style,{edition,timestamps});
        response.writeHead(200, { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="nant-${Math.floor(job.result.chapter.start)}-${edition}-${style}.pdf"` });
        response.end(buffer); return;
      }
      const match = url.pathname.match(/^\/api\/jobs\/([\w-]+)$/);
      if (request.method === 'GET' && match) {
        const job = await getJob(match[1]);
        if (!job) throw new InputError('This chapter could not be found. Open a saved chapter or create it again.', 404);
        if(url.searchParams.get('progress')==='1' && job.status==='running')return send(200,{id:job.id,status:job.status,stage:job.stage,stages:job.stages,progress:job.progress,message:job.message,completedChapters:job.partial?.length || 0,...(job.storageWarning?{storageWarning:job.storageWarning}:{})});
        const { controller, ...publicJob } = job;
        if(publicJob.result)publicJob.result=presentResult(publicJob.result);
        return send(200, publicJob);
      }
      send(404, { error: 'Not found.' });
    } catch (error) {
      send(error instanceof InputError ? error.status : 500, { error: error instanceof InputError ? error.message : 'The local server could not handle this request.' });
    }
  });
  server.requestTimeout = 600000;
  server.on('close',()=>{for(const job of jobs.values())if(job.status==='running')job.controller?.abort();});
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createApp({ dataDir: path.join(root, '.local-data'),sourceTools:createSourceTools() });
  const releaseRuntime=holdLocalRuntime({onWarning:message=>console.warn(message)});
  server.once('close',releaseRuntime);
  server.listen(port, '127.0.0.1', () => console.log(`NanT is ready at http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Set PORT in .env to another port.` : 'Could not start the local server.'); process.exitCode = 1; });
  process.once('SIGINT',()=>server.close());
  process.once('SIGTERM',()=>server.close());
}
