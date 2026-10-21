import {renderMarkdown} from '../src/markdown.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTranscript, seconds, selectChapter, planChapters } from '../src/transcript.js';
import { parseYouTubeURL, officialCaptions, timestampURL } from '../src/youtube.js';
import { normalizeEvidence, selectEvidence } from '../src/evidence.js';
import { generate, validateDraft } from '../src/generation.js';
import { runPipeline } from '../src/pipeline.js';
import { safeLink } from '../public/markdown-view.js';
import { SourceNeeded } from '../src/errors.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/original-lesson.json', import.meta.url), 'utf8'));
const offline = async () => { throw new Error('Network unavailable'); };
const keyEnv = { OPENAI_API_KEY: 'test-secret', OPENAI_MODEL: 'test-model' };
const segments = parseTranscript(fixture.segments);
const chapter = selectChapter(segments, 0, 480);
const validDraft = () => ({ title: 'A lesson', sections: segments.map(s => ({ heading: s.heading, segment_ids: [s.id], markdown: s.text, uncertainties: [] })) });
function apiResponse(draft, extra = {}) { return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(draft) }] }], ...extra }) }; }

test('YouTube links are canonicalized and unrelated hosts or unsafe URLs rejected', () => {
  for (const url of ['https://youtu.be/kCc8FmEb1nY?t=10', 'https://www.youtube.com/watch?v=kCc8FmEb1nY&list=abc', 'https://m.youtube.com/embed/kCc8FmEb1nY']) assert.equal(parseYouTubeURL(url).id, 'kCc8FmEb1nY');
  for (const url of ['https://youtube.com.evil.test/watch?v=kCc8FmEb1nY', 'http://127.0.0.1/', 'file:///tmp/a', 'https://u:p@youtube.com/watch?v=kCc8FmEb1nY', 'https://youtube.com:8000/watch?v=kCc8FmEb1nY', 'https://youtu.be/no', 'https://youtube.com/playlist?list=abc']) assert.throws(() => parseYouTubeURL(url));
  assert.equal(timestampURL(parseYouTubeURL('https://youtu.be/kCc8FmEb1nY'), 135.9), 'https://www.youtube.com/watch?v=kCc8FmEb1nY&t=135s');
});
test('VTT/SRT timestamps, settings, multiline captions and entities parse without losing text', () => {
  const vtt = '\uFEFFWEBVTT\n\nNOTE source note\nnot a cue\n\ncue-1\n00:01.200 --> 00:03.400 align:start\n<v Teacher>hello &amp; goodbye</v>\n<c.green>second line</c>\n\n00:03.400 --> 00:04.000\nnext';
  const result = parseTranscript(vtt);
  assert.equal(result[0].start, 1.2); assert.equal(result[0].end, 3.4);
  assert.equal(result[0].text, 'hello & goodbye\nsecond line'); assert.equal(result.length, 2);
  const srt = parseTranscript('1\r\n01:02:03,045 --> 01:02:05,100\r\nhello\r\n\r\n2\r\n01:02:05,100 --> 01:02:06,000\r\nworld');
  assert.equal(srt[0].start, 3723.045); assert.equal(srt[1].text, 'world');
  assert.equal(seconds('08:00'), 480); assert.equal(seconds('01:02:03'), 3723); assert.ok(Number.isNaN(seconds('00:99')));
});
test('Malformed, missing, invalid and reordered captions fail explicitly', () => {
  for (const input of ['', 'ordinary transcript without times', '[bad json]', [], [{ start: 0, end: 0, text: 'bad' }], [{ start: 'wat', end: 10, text: 'bad' }], [{ start: 5, end: 6, text: 'a' }, { start: 1, end: 2, text: 'b' }], [{ start: 0, end: 1, text: '' }]]) assert.throws(() => parseTranscript(input));
  assert.equal(parseTranscript(JSON.stringify({ segments: [{ start: 0, duration: 5, text: 'hello' }] }))[0].end, 5);
});
test('Chapter planning scales beyond a slice without dropping or duplicating any cue', () => {
  const long = parseTranscript(Array.from({ length: 120 }, (_, i) => ({ start: i * 60, end: i * 60 + 60, text: `point ${i}` })));
  const plan = planChapters(long, 480);
  assert.equal(plan.length, 15);
  assert.deepEqual(plan.flatMap(c => c.segmentIds), long.map(s => s.id));
  assert.equal(new Set(plan.flatMap(c => c.segmentIds)).size, 120);
});
test('Window selection preserves crossing cues whole and excludes the next boundary', () => {
  const cues = parseTranscript([{ start: 295, end: 305, text: 'crosses start' }, { start: 600, end: 605, text: 'crosses end' }, { start: 601, end: 610, text: 'outside' }]);
  const picked = selectChapter(cues, 300, 300);
  assert.deepEqual(picked.segments.map(s => s.text), ['crosses start']);
  assert.equal(picked.actualStart, 295); assert.throws(() => selectChapter(cues, 700, 300));
});
test('All code versions, outputs and visual notes survive the offline end-to-end slice', async () => {
  const stages = [];
  const result = await runPipeline({ start: 0, duration: 480 }, { fixture, fetcher: offline, onStage: s => stages.push(s) });
  assert.equal(result.generated.mode, 'source'); assert.equal(result.chapter.segments.length, 8);
  assert.equal(result.report.segmentCoverage.covered, 8); assert.equal(result.report.chronologicalOrder, true);
  assert.equal(result.report.codeStates, 6); assert.equal(result.report.terminalRecords, 3);
  assert.equal(result.report.semanticFidelity, 'not_verified'); assert.equal(result.report.status, 'needs_review');
  assert.match(result.markdown, /ORIGINAL TEST FIXTURE/); assert.doesNotMatch(result.markdown, /watch\?v=/);
  for (const s of segments) assert.ok(result.markdown.includes(s.text));
  for (const event of result.evidence) if (event.kind === 'code' || event.kind === 'terminal') assert.ok(result.markdown.includes(event.content));
  assert.ok(result.markdown.indexOf('Version 1') < result.markdown.indexOf('Version 2'));
  assert.ok(result.markdown.indexOf('Version 2') < result.markdown.indexOf('Version 3'));
  assert.ok(result.report.missingFrameChecks > 0); assert.equal(stages.length, 6);
});
test('Missing caption access is an integration failure; private transcript imports need no permission gate', async () => {
  await assert.rejects(runPipeline({ url: 'https://youtu.be/kCc8FmEb1nY', rightsConfirmed: true }, { env: {}, fetcher: offline }), error => error instanceof SourceNeeded && /no token/.test(error.message));
  const imported=await runPipeline({ url: 'https://youtu.be/kCc8FmEb1nY', transcript: fixture.segments }, { env: {}, fetcher: offline });
  assert.equal(imported.chapter.segments.length,8);
  assert.equal(imported.generated.mode,'source');
});
test('Imported chapter produces real timestamp links even if metadata lookup fails', async () => {
  const result = await runPipeline({ url: 'https://youtu.be/kCc8FmEb1nY', rightsConfirmed: true, transcript: fixture.segments, evidence: fixture.evidence, start: 120, duration: 300 }, { env: {}, fetcher: offline });
  assert.match(result.markdown, /watch\?v=kCc8FmEb1nY&t=120s/);
  assert.match(result.provenance, /not independently verified/);
  assert.equal(result.chapter.segments.length, 5);
  assert.ok(result.generated.warnings.some(w => /metadata/.test(w)));
});
test('YouTube authorized captions use official API and return actionable failures', async () => {
  const urls = [];
  const result = await officialCaptions('kCc8FmEb1nY', { token: 'not-real', fetcher: async (url, options) => {
    urls.push(url); assert.equal(options.headers.Authorization, 'Bearer not-real');
    return urls.length === 1 ? { ok: true, json: async () => ({ items: [{ id: 'track1', snippet: { language: 'en', status: 'serving' } }] }) } : { ok: true, text: async () => 'WEBVTT' };
  } });
  assert.equal(result.text, 'WEBVTT'); assert.ok(urls.every(u => u.startsWith('https://www.googleapis.com/youtube/v3/captions')));
  await assert.rejects(officialCaptions('kCc8FmEb1nY', { token: 'not-real', fetcher: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
});
test('Evidence keeps exact text, selects chronologically and rejects active or remote images', () => {
  const events = normalizeEvidence([{ at: 30, kind: 'code', content: '```\nprint(1)' }, { at: 5, kind: 'diagram', content: 'x -> y' }, { at: 600, kind: 'terminal', content: 'out' }]);
  assert.deepEqual(selectEvidence(events, chapter).map(e => e.at), [5, 30]);
  assert.equal(events[1].content, '```\nprint(1)');
  for (const image of ['https://example.com/screen.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)']) assert.throws(() => normalizeEvidence([{ at: 0, kind: 'frame', content: 'screen', image }]));
});
test('Hosted model credentials cannot activate a cloud writing route', async () => {
  let calls=0;
  const result=await generate(chapter,[],{useModel:true,provider:'openai',env:keyEnv,fetcher:async()=>{calls++;throw new Error('Unexpected hosted request');}});
  assert.equal(calls,0);assert.equal(result.mode,'source');assert.match(result.warnings[0],/local models only/);assert.doesNotMatch(JSON.stringify(result),/test-secret/);
});

test('Invalid source assignments, code fences and incomplete local responses fall back honestly', async () => {
  const reordered=validDraft();reordered.sections.reverse();
  const missing=validDraft();missing.sections.pop();
  const extra=validDraft();extra.sections.push(extra.sections[0]);
  const code=validDraft();code.sections[0].markdown='```python\ninvented\n```';
  for(const draft of [reordered,missing,extra,code])assert.throws(()=>validateDraft(draft,segments));
  for(const response of [{ok:false,status:429},{ok:true,json:async()=>({done:true,done_reason:'length',message:{content:'{}'}})},{ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:'not JSON'}})}]){
    const result=await generate(chapter,[],{useModel:true,provider:'local',env:keyEnv,fetcher:async url=>url.endsWith('/tags')?{ok:true,json:async()=>({models:[{name:'local-test'}]})}:response});
    assert.equal(result.mode,'source');assert.equal(result.generationFailed,true);assert.ok(result.draft.sections[0].markdown.includes(fixture.segments[0].text));assert.doesNotMatch(JSON.stringify(result),/test-secret/);
  }
});

test('Caption gaps and compressed model prose are flagged; an ID match is not semantic proof', async () => {
  const draft = validDraft(); draft.sections.forEach(s => s.markdown = 'A short recap.');
  assert.throws(()=>validateDraft(draft,segments),/summary_like_compression/);
  const result = await runPipeline({ start: 0, duration: 480, useModel: true }, { fixture, env: keyEnv, fetcher: async (url,options) => {
    if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local-test'}]})};
    const ids=JSON.parse(JSON.parse(options.body).messages[1].content).required_segment_ids;
    return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify({...draft,sections:draft.sections.filter(s=>ids.includes(s.segment_ids[0]))})}})};
  } });
  assert.equal(result.generated.mode, 'source'); assert.equal(result.generated.generationFailed, true);
  assert.ok(result.markdown.includes(fixture.segments[0].text.split('\n')[0]));
  const gapFixture = { ...fixture, segments: [{ start: 0, end: 20, text: 'a' }, { start: 60, end: 70, text: 'b' }], evidence: [] };
  const gapResult = await runPipeline({ start: 0, duration: 300 }, { fixture: gapFixture });
  assert.equal(gapResult.report.captionGaps.length, 2); assert.match(gapResult.report.warnings[0], /lack captions/);
});
test('Equal-time cues retain their source order in exported Markdown', async () => {
  const sameTime = { ...fixture, segments: [{ start: 0, end: 20, text: 'FIRST' }, { start: 0, end: 20, text: 'SECOND' }], evidence: [] };
  const result = await runPipeline({ start: 0, duration: 300 }, { fixture: sameTime });
  assert.ok(result.markdown.indexOf('FIRST') < result.markdown.indexOf('SECOND'));
});
test('Browser Markdown links reject active schemes and credentials', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///secret', 'https://user:pass@example.com']) assert.equal(safeLink(value), null);
  assert.equal(safeLink('https://www.youtube.com/watch?v=kCc8FmEb1nY&t=60s'), 'https://www.youtube.com/watch?v=kCc8FmEb1nY&t=60s');
});

test('Observed example values render independently of the model prose',async()=>{
 const result=await runPipeline({demo:true},{fixture});
 result.generated.screenExamples=[{segment_id:result.chapter.segments[0].id,at:10,decoded:'hii there',encoded:[71,4178,612],vocabSize:50257}];
 const text=renderMarkdown(result);assert.match(text,/Displayed example/);assert.match(text,/Decoded text: "hii there"/);assert.match(text,/\[71,4178,612\]/);assert.match(text,/Visible n_vocab: 50257/);
});
