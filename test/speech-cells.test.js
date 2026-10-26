import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSpeechCells,extractVideo} from '../src/cloud-model.js';
import {chapterParts} from '../public/cloud-course.js';

// Original fixture: the transition matters even though earlier teaching already
// fills a valid-looking time interval. No third-party course transcript stored.
const source={title:'A variable story',author:'Test teacher',cells:{
  c0:{kind:'speech',text:'The label now holds the player name.',heading:'Set the variable'},
  c1:{kind:'speech',text:'Next replace the literal in the story with that variable.',heading:'Use the variable'},
  c2:{kind:'speech',text:'Close the quoted text before inserting the variable.',heading:'Join the string'}
},evidence:[],uncertainties:[]};
test('Missing, unknown or empty audio cells cannot pass structural source validation',()=>{
  for(const cells of [{c0:source.cells.c0,c2:source.cells.c2},{...source.cells,c3:source.cells.c0},{...source.cells,c1:{...source.cells.c1,text:''}}]){
    assert.throws(()=>validateSpeechCells({...source,cells},1189,1219),/interval/);
  }
  const result=validateSpeechCells(source,1189,1219);
  assert.deepEqual(result.segments.map(s=>[s.start,s.end]),[[1189,1199],[1199,1209],[1209,1219]]);
  assert.match(result.segments[1].text,/replace the literal/);
  assert.ok(result.segments.every(s=>s.endEstimated));
});
test('An explicit quiet cell stays quiet rather than copying earlier narration into it',()=>{
  const cells={...source.cells,c1:{...source.cells.c1,kind:'silence',text:''}};
  const result=validateSpeechCells({...source,cells},1189,1219);
  assert.equal(result.segments.length,2);assert.equal(result.segments[1].start,1209);
  assert.throws(()=>validateSpeechCells({...source,cells:Object.fromEntries(Object.entries(cells).map(([key,c])=>[key,{...c,kind:'silence',text:''}]))},1189,1219),/No speech/);
});
test('One fresh read can repair an unreadable response, but repeated failure never silently passes',async()=>{
  let requests=0,reservations=0;
  const env={GEMINI_API_KEY:'test',GEMINI_FREE_TIER_CONFIRMED:'true',GEMINI_VIDEO_FALLBACK_MODELS:''};
  const screen={cell_index:1,kind:'code',title:'Editing',content:'print("name: " +',language:'python',complete:true};
  const result=await extractVideo('https://www.youtube.com/watch?v=rfscVS0vtbw',1189,1219,{env,beforeAttempt:async()=>reservations++,fetcher:async()=>{
    requests++;const data={...source,evidence:[{...screen,complete:requests>1}]};
    return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]})};
  }});
  assert.equal(requests,2);assert.equal(reservations,2);assert.equal(result.sourceReads,2);
  assert.equal(result.evidence[0].content,screen.content);assert.equal(result.evidence[0].at,1199);
  assert.throws(()=>validateSpeechCells({...source,evidence:[{...screen,cell_index:20}]},1189,1219),/source interval/);
});
test('Short source reads cover a whole chapter exactly, including the final remainder',()=>{
  const parts=chapterParts(1129,300);assert.equal(parts.length,10);
  let cursor=1129;for(const part of parts){assert.equal(part.start,cursor);assert.ok(part.end-part.start<=30);cursor=part.end;}
  assert.equal(cursor,1429);assert.deepEqual(chapterParts(1,65),[{start:1,end:31},{start:31,end:61},{start:61,end:66}]);
});
