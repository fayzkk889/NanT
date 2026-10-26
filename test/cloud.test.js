import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCloudHandler} from '../api/cloud.js';
import {extractVideo,validateExtract,validateSpeechCells,writeCloudPart} from '../src/cloud-model.js';
import {reserveCloudRequest} from '../src/cloud-quota.js';
import {assembleCloudCourse} from '../src/cloud-course.js';
import {chapterParts,cleanLessonMarkdown,writingBatches,applyWritingBatch} from '../public/cloud-course.js';
import {cloudRequest,cancellableDelay} from '../public/cloud-request.js';
import {freeRoutes,providerError,withFreeFallback} from '../src/cloud-routing.js';
import {createCloudCapacity,pacificResetSeconds} from '../src/cloud-capacity.js';
const env={GEMINI_API_KEY:'test-not-a-real-key',GEMINI_FREE_TIER_CONFIRMED:'true',UPSTASH_REDIS_REST_URL:'https://example.upstash.io',UPSTASH_REDIS_REST_TOKEN:'test-quota-secret'};
const response=data=>({ok:true,json:async()=>data});
const modelResponse=data=>response({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]});
const sourceResponse=data=>modelResponse({...data,evidence:data.evidence.map(e=>({...e,cell_index:Math.floor((e.at-data.segments[0].start)/10)})),cells:Object.fromEntries([0,1,2].map(index=>[`c${index}`,{kind:'speech',text:data.segments[0].text,heading:data.segments[0].heading||'Explanation'}]))});
const cue={id:'s00001',start:0,end:25,text:'We map each character to an integer. Decoding uses the inverse mapping to recover the same text. Keep both mappings so the transformation can be reversed.',heading:'A reversible mapping'};
const draft={title:'A reversible mapping',sections:[{heading:cue.heading,segment_ids:[cue.id],markdown:cue.text,uncertainties:[]}]};
async function api(body,options={},method='POST',headers={}){let status,buffer;const request={method,body,headers:{host:'nant.example','content-type':'application/json',...headers}},res={headers:{},setHeader(k,v){this.headers[k]=v;},set statusCode(v){status=v;},end(value){buffer=value;}};await createCloudHandler(options)(request,res);return {status,headers:res.headers,body:Buffer.isBuffer(buffer)?buffer:JSON.parse(buffer)};}
test('Public config never exposes keys and shared writing stays off without persistent quotas',async()=>{
  const result=await api(null,{env:{GEMINI_API_KEY:'secret',GEMINI_FREE_TIER_CONFIRMED:'true'}},'GET');assert.equal(result.body.ready,false);assert.doesNotMatch(JSON.stringify(result.body),/secret/);
  await assert.rejects(reserveCloudRequest('127.0.0.1',{env:{},fetcher:()=>{throw new Error('unexpected request');}}),/being connected/);
});
test('Quota reservation is atomic, persistent and hashes the visitor connection',async()=>{
  let command;const usage=await reserveCloudRequest('203.0.113.12',{env:{...env,CLOUD_VISITOR_DAILY_REQUESTS:'20'},now:new Date('2026-10-22T12:00:00Z'),fetcher:async(_url,options)=>{command=JSON.parse(options.body);return response({result:['ok',3,2]});}});
  assert.equal(command[0],'EVAL');assert.match(command[1],/INCR/);assert.equal(command[2],'3');assert.ok(command.some(v=>String(v).includes('2026-10-22')));assert.doesNotMatch(JSON.stringify(command),/203\.0\.113/);assert.equal(usage.visitorRemaining,18);
  await assert.rejects(reserveCloudRequest('ip',{env,fetcher:async()=>response({result:['global',80,3]})}),e=>e.status===429&&e.retryAfter>0);
  await assert.rejects(reserveCloudRequest('ip',{env,fetcher:async()=>({ok:false})}),e=>e.status===503);
});
test('Gemini receives a clipped public YouTube URL and no unbounded video request',async()=>{
  let body;const data={title:'Test',author:'Creator',segments:[{...cue,start:480,end:505}],evidence:[{at:500,kind:'code',title:'Mapping',content:'stoi = {ch:i for i,ch in enumerate(chars)}',language:'python',complete:true}],uncertainties:[]};
  const result=await extractVideo('https://www.youtube.com/watch?v=kCc8FmEb1nY',480,510,{env,fetcher:async(url,options)=>{assert.match(url,/gemini-3\.6-flash:generateContent$/);body=JSON.parse(options.body);return sourceResponse(data);}});
  assert.equal(body.generationConfig.mediaResolution,'MEDIA_RESOLUTION_HIGH');assert.deepEqual(body.generationConfig.responseSchema.properties.evidence.items.properties.kind.enum,['code','terminal','diagram']);assert.equal(body.contents[0].parts[0].videoMetadata.startOffset,'478s');assert.equal(body.contents[0].parts[0].videoMetadata.endOffset,'513s');assert.equal(result.evidence[0].content,data.evidence[0].content);
  await assert.rejects(extractVideo('url',0,600,{env}),/at most 30/);
  assert.throws(()=>validateExtract({...data,evidence:[{...data.evidence[0],complete:false}]},480,510),/not silently accepted/);
  assert.throws(()=>validateExtract({...data,segments:[{...cue,start:0,end:25}]},480,510),/inconsistent timestamps/);
  assert.equal(validateExtract({...data,segments:[{...cue,start:478,end:505}]},480,510).segments[0].start,478);
  assert.throws(()=>validateExtract({...data,uncertainties:['The audio explanation is missing.']},480,510),/not accepted/);
  assert.equal(validateExtract({...data,evidence:[{...data.evidence[0],at:513}]},480,510).evidence[0].at,513);
  assert.throws(()=>validateExtract({...data,evidence:[{...data.evidence[0],at:514}]},480,510),/invalid visual/);
});
test('Free model adapters reject paid choices and never retry a quota error on a paid model',async()=>{
  await assert.rejects(writeCloudPart([cue],[],{env:{...env,GEMINI_WRITER_MODEL:'paid-model'},fetcher:()=>{throw new Error('must not run');}}),/free-tier allowlist/);
  let calls=0;const recovered=await writeCloudPart([cue],[],{env,fetcher:async()=>{calls++;return {ok:false,status:429};}});assert.equal(calls,1);assert.equal(recovered.provider,'source');assert.equal(recovered.draft.sections[0].markdown,cue.text);
  const result=await writeCloudPart([cue],[],{env:{OPENROUTER_API_KEY:'test'},fetcher:async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.model,'openrouter/free');assert.equal(body.provider.max_price.prompt,0);assert.equal(body.models,undefined);return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(draft)}}]});}});assert.equal(result.provider,'openrouter');
});
test('A missing explanation in cloud writing retains every original passage with an explicit label',async()=>{
  const written=await writeCloudPart([cue],[],{env,fetcher:async()=>modelResponse({...draft,sections:[]})});assert.deepEqual(written.retained,[cue.id]);assert.equal(written.draft.sections[0].markdown,cue.text);assert.match(written.draft.sections[0].uncertainties[0],/failed validation/);
});
test('A failed cue rewrite does not discard correct teaching prose elsewhere in its batch',async()=>{
  const next={...cue,id:'s00002',start:25,end:50,text:'The decoder must use an empty separator. A space separator adds characters that were never present and breaks the round trip.'};
  const written=await writeCloudPart([cue,next],[],{env,fetcher:async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseSchema.properties.sections.maxItems,2);return modelResponse({title:draft.title,sections:[{...draft.sections[0],markdown:'Map each character to an integer, and keep the inverse mapping. Decoding then recovers the original text, so the transformation is reversible.'},{heading:'Decode',segment_ids:[next.id],markdown:'Join the characters with',uncertainties:[]}]});}});
  assert.deepEqual(written.retained,['s00002']);assert.match(written.draft.sections[0].markdown,/Map each character/);assert.equal(written.draft.sections[1].markdown,next.text);
});
test('Hosted endpoints reject cross-origin work and malformed sources before spending model quota',async()=>{
  const reserve=()=>{throw new Error('must not reserve quota');};assert.equal((await api({action:'extract',url:'https://evil.example',start:0,end:90},{env,reserve})).status,400);
  assert.equal((await api({action:'write',segments:[cue]},{env,reserve},'POST',{origin:'https://evil.example'})).status,403);
  assert.equal((await api({action:'extract',url:'https://youtu.be/kCc8FmEb1nY',start:0,end:600},{env,reserve})).status,400);
});
function completeParts(){let offset=0;return chapterParts(0,300).map(window=>{const segment={...cue,id:`s${String(++offset).padStart(5,'0')}`,start:window.start,end:window.end};return {...window,title:'Test course',author:'Creator',segments:[segment],evidence:[],uncertainties:[],writing:{draft:{title:draft.title,sections:[{...draft.sections[0],segment_ids:[segment.id]}]},retained:[]}};});}
test('Cloud assembly rejects missing timeline parts and source IDs; clean reading retains all ordered explanations',()=>{
  const input={url:'https://youtu.be/kCc8FmEb1nY',start:0,duration:300,parts:completeParts()};const result=assembleCloudCourse(input);assert.equal(result.report.segmentCoverage.covered,10);assert.equal(result.report.semanticFidelity,'not_verified');const markdown=cleanLessonMarkdown(result);assert.equal(markdown.split(cue.text).length-1,10);assert.doesNotMatch(markdown,/Source s000/);
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
  assert.deepEqual(writingBatches(parts),[parts.map((_,i)=>i)]);
  const sections=parts.flatMap(p=>p.segments).map(s=>({...draft.sections[0],segment_ids:[s.id]}));applyWritingBatch(parts,parts.map((_,i)=>i),{draft:{title:'Lesson',sections},retained:['s00002']});
  assert.deepEqual(parts.flatMap(p=>p.writing.draft.sections.flatMap(s=>s.segment_ids)),parts.flatMap(p=>p.segments.map(s=>s.id)));assert.deepEqual(parts[1].writing.retained,['s00002']);
  delete parts[0].writing;delete parts[2].writing;assert.deepEqual(writingBatches(parts),[[0],[2]]);
});

test('Daily visitor caps are disabled by default while shared and short-term protection remain',async()=>{
  let command;const usage=await reserveCloudRequest('campus-wifi',{env,fetcher:async(_url,options)=>{command=JSON.parse(options.body);return response({result:['ok',30,25]});}});
  assert.equal(command.at(-1),'0');assert.match(command[1],/tonumber\(ARGV\[2\]\)>0/);assert.match(command[1],/minute>=6/);assert.equal(usage.visitorRemaining,null);assert.equal(usage.sharedRemaining,50);
});

test('Video quota failover keeps clipped high-resolution source input on another free Gemini model',async()=>{
  const calls=[],reservations=[];const data={title:'Course',author:'Teacher',segments:[{...cue,start:480,end:505}],evidence:[],uncertainties:[]};
  const part=await extractVideo('https://www.youtube.com/watch?v=kCc8FmEb1nY',480,510,{env,beforeAttempt:async r=>reservations.push(r.model),fetcher:async(url,options)=>{calls.push(url);const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[0].videoMetadata.startOffset,'478s');assert.equal(body.generationConfig.mediaResolution,'MEDIA_RESOLUTION_HIGH');return calls.length===1?{ok:false,status:429,json:async()=>({error:{message:'Requests per day exhausted'}})}:sourceResponse(data);}});
  assert.deepEqual(reservations,['gemini-3.6-flash','gemini-3.5-flash-lite']);assert.equal(calls.length,2);assert.equal(part.model,'gemini-3.5-flash-lite');
});

test('Gemini writer exhaustion switches to real OpenRouter request format with zero-price routing',async()=>{
  const urls=[];const written=await writeCloudPart([cue],[],{env:{...env,OPENROUTER_API_KEY:'test-router'},fetcher:async(url,options)=>{urls.push(url);const body=JSON.parse(options.body);if(url.includes('googleapis'))return {ok:false,status:429,json:async()=>({})};assert.equal(body.model,'openrouter/free');assert.deepEqual(body.provider.max_price,{prompt:0,completion:0});assert.equal(body.models,undefined);assert.equal(body.provider.require_parameters,true);assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.schema.type,'object');assert.equal(body.response_format.json_schema.schema.additionalProperties,false);return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify(draft)}}]});}});
  assert.equal(written.provider,'openrouter');assert.equal(urls.length,2);assert.deepEqual(written.retained,[]);
});

test('All exhausted writers still produce an explicitly labelled complete source draft',async()=>{
  let calls=0;const written=await writeCloudPart([cue],[],{env:{...env,OPENROUTER_API_KEY:'test-router'},fetcher:async()=>{calls++;return {ok:false,status:503,json:async()=>({})};}});
  assert.equal(calls,2);assert.equal(written.provider,'source');assert.deepEqual(written.retained,[cue.id]);assert.equal(written.draft.sections[0].markdown,cue.text);assert.match(written.draft.sections[0].uncertainties[0],/unavailable/);
});

test('An unreadable source is rejected, without accepting a weaker text-only video fallback',async()=>{
  let calls=0;await assert.rejects(extractVideo('https://www.youtube.com/watch?v=kCc8FmEb1nY',0,30,{env:{...env,OPENROUTER_API_KEY:'router'},fetcher:async()=>{calls++;return sourceResponse({title:'Course',author:'Teacher',segments:[cue],evidence:[{at:10,kind:'code',content:'unreadable',complete:false}],uncertainties:[]});}}),/not silently accepted/);assert.equal(calls,2);
  assert.ok(freeRoutes({...env,OPENROUTER_API_KEY:'router'},'video').every(r=>r.provider==='gemini'));
});

test('Known exhausted routes are skipped without spending requests and cancellation stops fallback',async()=>{
  let attempts=0;const result=await withFreeFallback('writer',async r=>r.provider,{env:{...env,OPENROUTER_API_KEY:'router'},capacity:{cooldown:async r=>r.provider==='gemini'?3600:0},beforeAttempt:async()=>attempts++});assert.equal(result.data,'openrouter');assert.equal(attempts,1);
  const control=new AbortController();await assert.rejects(withFreeFallback('video',async()=>{control.abort();throw providerError(503);},{env,signal:control.signal}),e=>e.name==='AbortError');
});

test('An individual video provider timeout can fail over within the overall request deadline',async()=>{
  let calls=0;const part=await extractVideo('https://www.youtube.com/watch?v=kCc8FmEb1nY',0,30,{env,fetcher:async(_url,options)=>{assert.ok(options.signal);if(++calls===1)throw new DOMException('Slow provider','TimeoutError');return sourceResponse({title:'Test',author:'Teacher',segments:[cue],evidence:[],uncertainties:[]});}});assert.equal(calls,2);assert.equal(part.model,'gemini-3.5-flash-lite');
});

test('Provider daily cooldowns follow Pacific midnight, including DST, and errors never echo provider bodies',()=>{
  assert.equal(pacificResetSeconds(new Date('2026-07-01T06:00:00Z')),3600);
  assert.equal(pacificResetSeconds(new Date('2026-01-01T07:00:00Z')),3600);
  const error=providerError(429,{error:{message:'secret-provider-data',details:[{quotaMetric:'requestsPerDayPerProject'}]}},undefined,'gemini',new Date('2026-07-01T00:00:00Z'));assert.equal(error.retryAfter,7*3600);assert.doesNotMatch(error.message,/secret-provider-data/);
  assert.equal(providerError(429,{error:{details:[{retryDelay:'32s'}]}}).retryAfter,32);
  assert.equal(providerError(429,{error:{message:'Daily free allowance exhausted'}},undefined,'openrouter',new Date('2026-01-01T23:59:30Z')).retryAfter,30);
});

test('Public source cache and provider cooldowns are persistent, bounded and expire',async()=>{
  const records=new Map(),commands=[];let time=100000;const store=createCloudCapacity({env,now:()=>time,fetcher:async(_url,options)=>{const command=JSON.parse(options.body);commands.push(command);if(command[0]==='GET')return response({result:records.get(command[1])??null});records.set(command[1],command[2]);return response({result:'OK'});}});
  const route={provider:'gemini',model:'gemini-3.6-flash'},part={start:0,end:30,segments:[cue],evidence:[]};
  await store.saveSource('https://www.youtube.com/watch?v=kCc8FmEb1nY',0,30,part);assert.deepEqual(await store.source('https://www.youtube.com/watch?v=kCc8FmEb1nY',0,30),part);assert.equal(await store.source('https://www.youtube.com/watch?v=kCc8FmEb1nY',90,180),null);
  await store.pause(route,45);assert.equal(await store.cooldown(route),45);time+=46000;assert.equal(await store.cooldown(route),0);assert.ok(commands.some(c=>c.at(-1)==='86400'));assert.doesNotMatch(JSON.stringify([...records.keys()]),/test-quota-secret/);
});

test('Cached source reads are returned across equivalent YouTube URLs without a provider or quota request',async()=>{
  let reads=0;const part={start:0,end:30,segments:[cue],evidence:[]};const capacity={source:async(url)=>{reads++;assert.equal(url,'https://www.youtube.com/watch?v=kCc8FmEb1nY');return part;}};
  const result=await api({action:'extract',url:'https://youtu.be/kCc8FmEb1nY',start:0,end:30},{env,capacity,reserve:()=>assert.fail('cache must not reserve'),fetcher:()=>assert.fail('cache must not call a model')});assert.equal(result.status,200);assert.equal(result.body.reused,true);assert.equal(reads,1);
});

test('Malformed and empty writer outputs recover source instead of stranding a completed video read',async()=>{
  for(const content of ['not JSON',null,'{"sections":[null]}']){
    const written=await writeCloudPart([cue],[],{env:{OPENROUTER_API_KEY:'test'},fetcher:async()=>response({choices:[{finish_reason:'stop',message:{content}}]})});
    assert.deepEqual(written.retained,[cue.id]);assert.equal(written.draft.sections[0].markdown,cue.text);
  }
});

test('A fully recovered source chapter remains exportable and is not labelled an AI-written lesson',async()=>{
  const parts=completeParts();for(const part of parts)part.writing={...part.writing,provider:'source',retained:part.segments.map(s=>s.id),recoveryReason:'capacity'};
  const result=assembleCloudCourse({url:'https://youtu.be/kCc8FmEb1nY',start:0,duration:300,parts});assert.equal(result.generated.mode,'source');assert.ok(result.generated.warnings.some(w=>/providers were unavailable/.test(w)));assert.equal(result.report.segmentCoverage.covered,10);
  const pdf=await api({action:'pdf',result},{env:{}});assert.equal(pdf.status,200);assert.equal(pdf.body.subarray(0,5).toString(),'%PDF-');
});
test('A source cell ending mid-sentence survives mixed rewriting, assembly, reopening and PDF export',async()=>{
  const parts=completeParts(),first=parts[0];first.segments[0].text='We insert the variable into the';
  first.writing={provider:'source',retained:[first.segments[0].id],recoveryReason:'validation',draft:{title:'A variable story',sections:[{heading:'Insert the variable',segment_ids:[first.segments[0].id],markdown:first.segments[0].text,uncertainties:['Source interval continues in the next passage.']}]}};
  const result=assembleCloudCourse({url:'https://youtu.be/kCc8FmEb1nY',start:0,duration:300,parts});
  assert.equal(result.generated.mode,'model');assert.equal(result.generated.draft.sections[0].markdown,first.segments[0].text);
  const reopened=await api({action:'restore',result},{env:{}});assert.equal(reopened.status,200);
  const pdf=await api({action:'pdf',result},{env:{}});assert.equal(pdf.status,200);
  const altered=structuredClone(result);altered.generated.draft.sections[0].markdown='We insert the variable into';
  assert.equal((await api({action:'restore',result:altered},{env:{}})).status,400);
});
test('Paragraphs can span source parts without dropping IDs during saving, assembly or reopening',async()=>{
  const parts=completeParts(),segments=parts.flatMap(p=>p.segments);
  const sections=[];for(let i=0;i<segments.length;i+=2)sections.push({heading:'A reversible mapping',segment_ids:segments.slice(i,i+2).map(s=>s.id),markdown:segments.slice(i,i+2).map(s=>s.text).join(' '),uncertainties:[]});
  const writing=await writeCloudPart(segments,[],{env,fetcher:async()=>modelResponse({title:'A coherent lesson',sections})});
  assert.equal(writing.draft.sections.length,5);assert.deepEqual(writing.retained,[]);
  applyWritingBatch(parts,parts.map((_,i)=>i),writing);
  const result=assembleCloudCourse({url:'https://youtu.be/kCc8FmEb1nY',start:0,duration:300,parts});
  assert.equal(result.generated.draft.sections.length,5);assert.equal(result.report.segmentCoverage.covered,10);
  assert.equal((await api({action:'restore',result},{env:{}})).status,200);
});
test('Grouped rewriting cannot silently discard a numeric example or a code identifier',async()=>{
  const rows=[{...cue,text:'Store the age 35 in character_age. The same value is reused throughout the story.'},{...cue,id:'s00002',start:25,end:50,text:'Change that value in the variable to update the repeated age wherever it is referenced.'}];
  for(const markdown of ['Store the age in character_age. The same value is reused throughout the story. Change the variable to update the repeated age wherever it is referenced.','Store the age 35 in the age variable. The same value is reused throughout the story. Change the variable to update the repeated age wherever it is referenced.']){
    const writing=await writeCloudPart(rows,[],{env,fetcher:async()=>modelResponse({title:'Variables',sections:[{heading:'Reuse the age',segment_ids:rows.map(s=>s.id),markdown,uncertainties:[]}]})});
    assert.deepEqual(writing.retained,rows.map(s=>s.id));assert.equal(writing.draft.sections[0].markdown,rows.map(s=>s.text).join(' '));
  }
});
test('An application throttle waits at the writing step instead of downgrading prose to raw source',async()=>{
  let requests=0;
  await assert.rejects(writeCloudPart([cue],[],{env,beforeAttempt:async()=>{throw Object.assign(new Error('A quick breather'),{status:429,retryAfter:60});},fetcher:async()=>{requests++;return modelResponse(draft);}}),e=>e.status===429&&e.retryAfter===60);
  assert.equal(requests,0);
});
test('A larger chapter is divided into accepted writing batches while retaining every source ID',()=>{
  const parts=completeParts().map((part,i)=>({...part,writing:undefined,segments:[0,1,2].map(j=>({...part.segments[0],id:`s${String(i*3+j+1).padStart(5,'0')}`,start:part.start+j*10,end:part.start+(j+1)*10}))}));
  const batches=writingBatches(parts);assert.ok(batches.length>1);
  for(const indices of batches){const rows=indices.flatMap(i=>parts[i].segments);assert.ok(rows.length<=12);applyWritingBatch(parts,indices,{draft:{title:'Lesson',sections:rows.map(s=>({...draft.sections[0],segment_ids:[s.id]}))},retained:[]});}
  assert.deepEqual(parts.flatMap(p=>p.writing.draft.sections.flatMap(s=>s.segment_ids)),parts.flatMap(p=>p.segments.map(s=>s.id)));
  const error=providerError(400,{error:{message:'Invalid argument'}});assert.equal(error.invalidOutput,true);assert.equal(error.capacityExhausted,undefined);
});
