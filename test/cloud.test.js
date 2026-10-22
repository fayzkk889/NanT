import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCloudHandler} from '../api/cloud.js';
import {extractVideo,validateExtract,writeCloudPart} from '../src/cloud-model.js';
import {reserveCloudRequest} from '../src/cloud-quota.js';
import {assembleCloudCourse} from '../src/cloud-course.js';
import {chapterParts,cleanLessonMarkdown,writingBatches,applyWritingBatch} from '../public/cloud-course.js';
import {cloudRequest,cancellableDelay} from '../public/cloud-request.js';
const env={GEMINI_API_KEY:'test-not-a-real-key',GEMINI_FREE_TIER_CONFIRMED:'true',UPSTASH_REDIS_REST_URL:'https://example.upstash.io',UPSTASH_REDIS_REST_TOKEN:'test-quota-secret'};
const response=data=>({ok:true,json:async()=>data});
const modelResponse=data=>response({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]});
const cue={id:'s00001',start:0,end:25,text:'We map each character to an integer. Decoding uses the inverse mapping to recover the same text. Keep both mappings so the transformation can be reversed.',heading:'A reversible mapping'};
const draft={title:'A reversible mapping',sections:[{heading:cue.heading,segment_ids:[cue.id],markdown:cue.text,uncertainties:[]}]};
async function api(body,options={},method='POST',headers={}){let status,buffer;const request={method,body,headers:{host:'nant.example','content-type':'application/json',...headers}},res={headers:{},setHeader(k,v){this.headers[k]=v;},set statusCode(v){status=v;},end(value){buffer=value;}};await createCloudHandler(options)(request,res);return {status,headers:res.headers,body:Buffer.isBuffer(buffer)?buffer:JSON.parse(buffer)};}
test('Public config never exposes keys and shared writing stays off without persistent quotas',async()=>{
  const result=await api(null,{env:{GEMINI_API_KEY:'secret',GEMINI_FREE_TIER_CONFIRMED:'true'}},'GET');assert.equal(result.body.ready,false);assert.doesNotMatch(JSON.stringify(result.body),/secret/);
  await assert.rejects(reserveCloudRequest('127.0.0.1',{env:{},fetcher:()=>{throw new Error('unexpected request');}}),/being connected/);
});
test('Quota reservation is atomic, persistent and hashes the visitor connection',async()=>{
  let command;const usage=await reserveCloudRequest('203.0.113.12',{env,now:new Date('2026-10-22T12:00:00Z'),fetcher:async(_url,options)=>{command=JSON.parse(options.body);return response({result:['ok',3,2]});}});
  assert.equal(command[0],'EVAL');assert.match(command[1],/INCR/);assert.equal(command[2],'3');assert.ok(command.some(v=>String(v).includes('2026-10-22')));assert.doesNotMatch(JSON.stringify(command),/203\.0\.113/);assert.equal(usage.visitorRemaining,18);
  await assert.rejects(reserveCloudRequest('ip',{env,fetcher:async()=>response({result:['global',80,3]})}),e=>e.status===429&&e.retryAfter>0);
  await assert.rejects(reserveCloudRequest('ip',{env,fetcher:async()=>({ok:false})}),e=>e.status===503);
});
test('Gemini receives a clipped public YouTube URL and no unbounded video request',async()=>{
  let body;const data={title:'Test',author:'Creator',segments:[{...cue,start:480,end:505}],evidence:[{at:500,kind:'code',title:'Mapping',content:'stoi = {ch:i for i,ch in enumerate(chars)}',language:'python',complete:true}],uncertainties:[]};
  const result=await extractVideo('https://www.youtube.com/watch?v=kCc8FmEb1nY',480,570,{env,fetcher:async(url,options)=>{assert.match(url,/gemini-3\.6-flash:generateContent$/);body=JSON.parse(options.body);return modelResponse(data);}});
  assert.equal(body.generationConfig.mediaResolution,'MEDIA_RESOLUTION_HIGH');assert.deepEqual(body.generationConfig.responseSchema.properties.evidence.items.properties.kind.enum,['code','terminal','diagram']);assert.equal(body.contents[0].parts[0].videoMetadata.startOffset,'478s');assert.equal(body.contents[0].parts[0].videoMetadata.endOffset,'573s');assert.equal(result.evidence[0].content,data.evidence[0].content);
  await assert.rejects(extractVideo('url',0,600,{env}),/at most 90/);
  assert.throws(()=>validateExtract({...data,evidence:[{...data.evidence[0],complete:false}]},480,570),/not silently accepted/);
  assert.throws(()=>validateExtract({...data,segments:[{...cue,start:0,end:25}]},480,570),/inconsistent timestamps/);
  assert.equal(validateExtract({...data,segments:[{...cue,start:478,end:505}]},480,570).segments[0].start,478);
  assert.throws(()=>validateExtract({...data,uncertainties:['The audio explanation is missing.']},480,570),/not accepted/);
});
test('Free model adapters reject paid choices and never retry a quota error on a paid model',async()=>{
  await assert.rejects(writeCloudPart([cue],[],{env:{...env,GEMINI_WRITER_MODEL:'paid-model'},fetcher:()=>{throw new Error('must not run');}}),/free-tier allowlist/);
  let calls=0;await assert.rejects(writeCloudPart([cue],[],{env,fetcher:async()=>{calls++;return {ok:false,status:429};}}),e=>e.status===429);assert.equal(calls,1);
  const result=await writeCloudPart([cue],[],{env:{OPENROUTER_API_KEY:'test'},fetcher:async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.model,'openrouter/free');assert.equal(body.provider.max_price.prompt,0);assert.equal(body.models,undefined);return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(draft)}}]});}});assert.equal(result.provider,'openrouter');
});
test('A missing explanation in cloud writing retains every original passage with an explicit label',async()=>{
  const written=await writeCloudPart([cue],[],{env,fetcher:async()=>modelResponse({...draft,sections:[]})});assert.deepEqual(written.retained,[cue.id]);assert.equal(written.draft.sections[0].markdown,cue.text);assert.match(written.draft.sections[0].uncertainties[0],/failed validation/);
});
test('A failed cue rewrite does not discard correct teaching prose elsewhere in its batch',async()=>{
  const next={...cue,id:'s00002',start:25,end:50,text:'The decoder must use an empty separator. A space separator adds characters that were never present and breaks the round trip.'};
  const written=await writeCloudPart([cue,next],[],{env,fetcher:async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseSchema.properties.sections.minItems,2);return modelResponse({title:draft.title,sections:[{...draft.sections[0],markdown:'Map each character to an integer, and keep the inverse mapping. Decoding then recovers the original text, so the transformation is reversible.'},{heading:'Decode',segment_ids:[next.id],markdown:'Join the characters with',uncertainties:[]}]});}});
  assert.deepEqual(written.retained,['s00002']);assert.match(written.draft.sections[0].markdown,/Map each character/);assert.equal(written.draft.sections[1].markdown,next.text);
});
test('Hosted endpoints reject cross-origin work and malformed sources before spending model quota',async()=>{
  const reserve=()=>{throw new Error('must not reserve quota');};assert.equal((await api({action:'extract',url:'https://evil.example',start:0,end:90},{env,reserve})).status,400);
  assert.equal((await api({action:'write',segments:[cue]},{env,reserve},'POST',{origin:'https://evil.example'})).status,403);
  assert.equal((await api({action:'extract',url:'https://youtu.be/kCc8FmEb1nY',start:0,end:600},{env,reserve})).status,400);
});
function completeParts(){let offset=0;return chapterParts(0,300).map(window=>{const segment={...cue,id:`s${String(++offset).padStart(5,'0')}`,start:window.start,end:window.end};return {...window,title:'Test course',author:'Creator',segments:[segment],evidence:[],uncertainties:[],writing:{draft:{title:draft.title,sections:[{...draft.sections[0],segment_ids:[segment.id]}]},retained:[]}};});}
test('Cloud assembly rejects missing timeline parts and source IDs; clean reading retains all ordered explanations',()=>{
  const input={url:'https://youtu.be/kCc8FmEb1nY',start:0,duration:300,parts:completeParts()};const result=assembleCloudCourse(input);assert.equal(result.report.segmentCoverage.covered,4);assert.equal(result.report.semanticFidelity,'not_verified');const markdown=cleanLessonMarkdown(result);assert.equal(markdown.split(cue.text).length-1,4);assert.doesNotMatch(markdown,/Source s000/);
  assert.equal(assembleCloudCourse({...input,useModel:false}).generated.mode,'source');
  assert.throws(()=>assembleCloudCourse({...input,parts:input.parts.slice(1)}),/missing|source IDs/);
  assert.throws(()=>assembleCloudCourse({...input,parts:input.parts.slice(0,-1)}),/incomplete/);
  const invalid=structuredClone(input);invalid.parts[1].segments[0].id='s00001';assert.throws(()=>assembleCloudCourse(invalid),/source IDs/);
});
test('Hosted sample, restore and real PDF export work without any cloud key',async()=>{
  const sample=await api({action:'sample'},{env:{}});assert.equal(sample.status,200);assert.equal(sample.body.source.synthetic,true);
  const pdf=await api({action:'pdf',result:sample.body,style:'companion',edition:'notes'},{env:{}});assert.equal(pdf.status,200);assert.equal(pdf.headers['Content-Type'],'application/pdf');assert.equal(pdf.body.subarray(0,5).toString(),'%PDF-');
  const tampered=structuredClone(sample.body);tampered.generated.draft.sections.pop();assert.equal((await api({action:'restore',result:tampered},{env:{}})).status,400);
});
test('Public build explicitly excludes local settings, models and source recordings',async()=>{
  const builder=await readFile(new URL('../scripts/build-web.js',import.meta.url),'utf8');assert.match(builder,/Explicit public allowlist/);assert.doesNotMatch(builder,/recursive:\s*true[^\n]*copy/);
  const index=await readFile(new URL('../public/index.html',import.meta.url),'utf8');assert.match(index,/logo\.svg/);assert.match(index,/brand\.css/);assert.match(index,/id="hero-demo"/);
});
test('A short free-service throttle resumes automatically, while daily exhaustion stops and waiting is cancellable',async()=>{
  for(const status of [429,503]){let requests=0,waited=0;const result=await cloudRequest('extract',{}, {fetcher:async()=>++requests===1?{ok:false,status,headers:new Headers({'Retry-After':'60'}),json:async()=>({error:'Short breather'})}:response({part:'saved'}),wait:async ms=>{waited=ms;}});assert.equal(result.part,'saved');assert.equal(requests,2);assert.equal(waited,60000);}
  await assert.rejects(cloudRequest('extract',{}, {fetcher:async()=>({ok:false,status:429,headers:new Headers({'Retry-After':'86400'}),json:async()=>({error:'Daily allowance exhausted'})}),wait:()=>assert.fail('Must not retry daily limits')}),/Daily allowance/);
  const controller=new AbortController(),pending=cancellableDelay(60000,controller.signal);controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');
});
test('Batched writing saves free requests without rewriting completed parts or dropping ordered source cues',()=>{
  const parts=completeParts();for(const part of parts)delete part.writing;
  assert.deepEqual(writingBatches(parts),[[0,1,2,3]]);
  const sections=parts.flatMap(p=>p.segments).map(s=>({...draft.sections[0],segment_ids:[s.id]}));applyWritingBatch(parts,[0,1,2,3],{draft:{title:'Lesson',sections},retained:['s00002']});
  assert.deepEqual(parts.flatMap(p=>p.writing.draft.sections.flatMap(s=>s.segment_ids)),['s00001','s00002','s00003','s00004']);assert.deepEqual(parts[1].writing.retained,['s00002']);
  delete parts[0].writing;delete parts[2].writing;assert.deepEqual(writingBatches(parts),[[0],[2]]);
});
