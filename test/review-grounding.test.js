import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewLocally} from '../src/review.js';
test('Review criticism must quote actual source and draft before it can replace prose',async()=>{
 const chapter={segments:[{id:'s1',start:0,end:30,text:'Set the flag to false before the pass.'}]};
 const draft={title:'Flags',sections:[{segment_ids:['s1'],markdown:'Initialize the flag to false before starting the pass.'}]};
 for(const issue of [{segment_id:'s1',problem:'Invented issue',source_quote:'The vocabulary contains 99 tokens.',draft_quote:''},{segment_id:'s1',problem:'Invented draft quote',source_quote:'Set the flag to false',draft_quote:'Initialize the flag to true'}]){
  const result=await reviewLocally(chapter,[],draft,{model:'test',fetcher:async()=>({ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify({issues:[issue]})}})})});
  assert.equal(result.status,'unavailable');assert.equal(result.issues.length,0);assert.equal(result.ungroundedIssues,1);
 }
});

test('The local visual reviewer receives original frames without treating raw README OCR as prose requirements',async()=>{
 const chapter={segments:[{id:'s1',start:0,end:15,text:'Compare adjacent items.'},{id:'s2',start:15,end:30,text:'Exchange the pair if needed.'}]};
 const draft={title:'Comparison',sections:chapter.segments.map(s=>({segment_ids:[s.id],markdown:s.text}))};
 const evidence=chapter.segments.map((row,i)=>({id:'e'+i,at:row.start+1,kind:'frame',content:'Unspoken background README about unrelated topics.',image:'data:image/jpeg;base64,YQ=='}));
 const result=await reviewLocally(chapter,evidence,draft,{model:'local-test',vision:true,fetcher:async(url,options)=>{
  const message=JSON.parse(options.body).messages[1];assert.equal(message.images.length,2);assert.doesNotMatch(message.content,/Unspoken background README/);
  return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify({issues:[]})}})};
 }});
 assert.equal(result.status,'passed');assert.deepEqual(result.inspectedFrameIds,['e0','e1']);
});
