import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { discoverLocalModel } from '../src/local-model.js';
import {generateLocally,screenIdentifiers} from '../src/local-model.js';
import { generate } from '../src/generation.js';
import { parseTranscript, selectChapter } from '../src/transcript.js';
import { runPipeline } from '../src/pipeline.js';
import { createChapterPDF, PDF_STYLES } from '../src/pdf.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/original-lesson.json', import.meta.url), 'utf8'));
const chapter = selectChapter(parseTranscript(fixture.segments), 0, 480);
test('Repeated screen identifiers supply spelling anchors without exposing background prose',()=>{
 const frames=[1,2].map(n=>({image:'data:image/jpeg;base64,YQ==',content:'Unrelated background paragraph. player_choice = "rock"; console.log(player_choice); tiktoken; this;'}));
 assert.deepEqual(screenIdentifiers(frames),['player_choice','console.log','tiktoken','this']);
 assert.deepEqual(screenIdentifiers(frames.slice(0,1)),[]);
});

test('Quoted example strings and bare console output are not programming identifiers',()=>{
 const frames=[1,2].map(()=>({image:'original',content:'console.log("HelloWorld");\nHelloWorld\nplayer_choice = "rock"'}));
 assert.deepEqual(screenIdentifiers(frames),['console.log','player_choice']);
});
test('Repeated observations survive a passage boundary with only one screen in each passage',async()=>{
 const segments=[{id:'s1',start:0,end:15,text:'Encode the input.'},{id:'s2',start:15,end:30,text:'Decode it back to the same string.'}],content='encode(x)\n[1,2]\ndecode([1,2])\n\'ab\'';
 const evidence=[5,20].map((at,i)=>({id:'e'+i,at,image:'data:image/jpeg;base64,YQ==',content}));let writes=0;
 const result=await generateLocally({segments,start:0,end:30},evidence,{},'Edit the source.',{fetcher:async(url,options)=>{
  if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'test'}]})};
  const payload=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(payload.screen_examples[0].decoded,'ab');writes++;
  return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify({title:'Encoding',sections:[{heading:'Step',segment_ids:[payload.segments[0].id],markdown:payload.segments[0].text,uncertainties:[]}]})}})};
 }});assert.equal(writes,2);assert.equal(result.screenExamples.length,1);
});

test('Writing uses spoken source and repeated literal examples without background screen text',async()=>{
 const segments=[{id:'s1',start:0,end:30,text:'Encode the input text, then decode the result back to the same string.'}];
 const content='Background README about an unrelated concept.\nenc.encode("hil there")\n[71,4178,612]\nenc.decode([71,4178,612])\n\'hii there\'';
 const evidence=[1,2,3].map(n=>({id:'e'+n,at:n*5,kind:'frame',content,image:'data:image/jpeg;base64,YQ=='}));
 const result=await generateLocally({segments,start:0,end:30},evidence,{},'Preserve the example.',{fetcher:async(url,options)=>{
  if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'vision-local',capabilities:['vision']}]})};
  const message=JSON.parse(options.body).messages[1];assert.equal(message.images,undefined);assert.doesNotMatch(message.content,/Background README/);
  const payload=JSON.parse(message.content);assert.equal(payload.screen_examples[0].decoded,'hii there');assert.deepEqual(payload.screen_examples[0].encoded,[71,4178,612]);
  return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify({title:'Encoding',sections:[{heading:'Round trip',segment_ids:['s1'],markdown:segments[0].text,uncertainties:[]}]})}})};
 }});
 assert.deepEqual(result.inspectedFrameIds,[]);assert.equal(result.screenExamples.length,1);assert.equal(evidence.length,3);
});

test('Local discovery finds downloaded models, prefers the long-context variant, and ignores cloud tags', async () => {
  const info = await discoverLocalModel({ env: {}, fetcher: async () => ({ ok: true, json: async () => ({ models: [{ name: 'x:cloud' },{name:'qwen3.5:397b-cloud'},{name:'remote',remote_host:'cloud.invalid'}, { name: 'qwen3.5:4b' }, { name: 'qwen3.5-4b-64k:latest' }] }) }) });
  assert.equal(info.model, 'qwen3.5-4b-64k:latest'); assert.equal(info.available, true); assert.equal(info.models.length, 2);
  const none = await discoverLocalModel({ env: {}, fetcher: async () => { throw new Error(); } }); assert.equal(none.available, false);
});
test('Local generation uses only loopback, no cloud key, and accepts complete ordered prose', async () => {
  const draft = { title: 'Tokenizer', sections: chapter.segments.map(s => ({ heading: s.heading, segment_ids: [s.id], markdown: s.text, uncertainties: [] })) };
  const calls = [];
  const result = await generate(chapter, [], { useModel: true, provider: 'local', env: {}, fetcher: async (url, options) => {
    calls.push(url); assert.ok(url.startsWith('http://127.0.0.1:11434/'));
    if (url.endsWith('/tags')) return { ok: true, json: async () => ({ models: [{ name: 'local-test' }] }) };
    const body = JSON.parse(options.body); assert.equal(body.stream, false); assert.equal(body.think, false); assert.equal(body.model, 'local-test');
    assert.equal(options.headers.Authorization, undefined);
    const reviewing=body.messages[0].content.startsWith('Compare written');
    const selected=reviewing ? [] : JSON.parse(body.messages[1].content).segments.map(s=>s.id);
    const output = reviewing ? {issues:[]} : {...draft,sections:draft.sections.filter(s=>selected.includes(s.segment_ids[0]))};
    return { ok: true, json: async () => ({ done: true, done_reason: 'stop', message: { content: JSON.stringify(output) } }) };
  } });
  assert.ok(calls.length >= 3); assert.equal(result.mode, 'model'); assert.equal(result.provider, 'local'); assert.equal(result.review.status,'passed');
});
test('A missing local model never silently switches to paid cloud generation', async () => {
  const urls = [];
  const result = await generate(chapter, [], { useModel: true, provider: 'local', env: { OPENAI_API_KEY: 'must-not-use', OPENAI_MODEL: 'cloud' }, fetcher: async url => { urls.push(url); throw new Error(); } });
  assert.equal(result.generationFailed, true); assert.equal(result.mode, 'source'); assert.ok(urls.every(u => u.startsWith('http://127.0.0.1:11434')));
});
test('Every PDF style produces a valid multipage document; code and source-link records export', async () => {
  const result = await runPipeline({ demo: true }, { fixture });
  result.source = { ...result.source, url: 'https://www.youtube.com/watch?v=kCc8FmEb1nY' };
  for (const style of Object.keys(PDF_STYLES)) {
    const bytes = await createChapterPDF(result, style,{edition:'source'}); assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    const pdf = await PDFDocument.load(bytes); assert.ok(pdf.getPageCount() >= 4); assert.match(pdf.getSubject(), new RegExp(PDF_STYLES[style].name));
    assert.ok(pdf.getPages().some(p => p.node.Annots()?.size() > 0));
  }
  await assert.rejects(createChapterPDF(result, '../invalid'), /Choose Textbook/);
});
