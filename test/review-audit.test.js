import test from 'node:test';
import assert from 'node:assert/strict';
import {auditReview} from '../src/review.js';
import {validateDraft,generate} from '../src/generation.js';
import {generateLocally} from '../src/local-model.js';
const chapter={start:0,end:30,segments:[{id:'s1',start:0,end:30,text:'Encode all the text into a tensor. Display the first 1000 elements.'}]};
const draft={title:'Tensor',sections:[{heading:'Data',segment_ids:['s1'],markdown:'The tensor contains the entire text. Inspect its first 1000 elements.',uncertainties:[]}]};
const review={status:'issues_found',issues:[{segment_id:'s1',problem:'The entire text contradicts all the text.',source_quote:'all the text',draft_quote:'the entire text'}],ungroundedIssues:0};
test('Reviewer claims are audited against the complete passage before they can replace correct prose',async()=>{
 const result=await auditReview(review,chapter,[],draft,{model:'local',fetcher:async(url,options)=>{
  assert.equal(url,'http://127.0.0.1:11434/api/chat');const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content);
  assert.equal(payload.section.markdown,draft.sections[0].markdown);assert.equal(payload.source.text,chapter.segments[0].text);assert.equal(request.messages[1].images,undefined);
  return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify({decisions:[{issue_index:0,supported:false,reason:'The phrases express the same fact; only the displayed subset is limited.'}]})}})};
 }});assert.equal(result.status,'passed');assert.equal(result.issues.length,0);assert.equal(result.dismissedIssues.length,1);
});
test('An unavailable audit never turns an unconfirmed criticism into a pass or destructive source replacement',async()=>{
 const result=await auditReview(review,chapter,[],draft,{model:'local',fetcher:async()=>{throw new Error('Offline');}});
 assert.equal(result.status,'unavailable');assert.equal(result.issues.length,0);assert.equal(result.pendingIssues.length,1);assert.equal(result.auditIncomplete,true);
});
test('A dismissed paraphrase criticism cannot trigger source recovery in the actual generation flow',async()=>{
 const result=await generate(chapter,[],{useModel:true,env:{},fetcher:async(url,options)=>{
  if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local'}]})};
  const system=JSON.parse(options.body).messages[0].content;
  const output=system.startsWith('Compare written')?{issues:review.issues}:system.startsWith('Audit these')?{decisions:[{issue_index:0,supported:false,reason:'All and entire are equivalent here.'}]}:draft;
  return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify(output)}})};
 }});assert.equal(result.mode,'model');assert.deepEqual(result.sourceFallbackSegments,[]);assert.equal(result.draft.sections[0].markdown,draft.sections[0].markdown);assert.equal(result.review.dismissedIssues.length,1);
});
test('The highest GPT-2 token ID cannot replace its displayed vocabulary count',()=>{
 const source=[{id:'s1',start:0,end:30,text:'Compare the GPT-2 vocabulary and the integer range.'}],examples=[{decoded:'hii there',encoded:[71,4178,612],vocabSize:50257}];
 const make=markdown=>({title:'Tokens',sections:[{heading:'Count',segment_ids:['s1'],markdown,uncertainties:[]}]});
 assert.throws(()=>validateDraft(make('This encoding uses a vocabulary of 50,256 tokens.'),source,examples),/screen_vocabulary_off_by_one/);
 assert.doesNotThrow(()=>validateDraft(make('The vocabulary size is 50,257; IDs range from 0 to 50,256.'),source,examples));
 assert.doesNotThrow(()=>validateDraft(make('There are about 50,000 tokens, with IDs between 0 and 50,256.'),source,examples));
});
test('A targeted repair receives the existing prose rather than regenerating from an issue quote alone',async()=>{
 await generateLocally(chapter,[],{},'Correct the supported issue.',{repairDraft:draft.sections,fetcher:async(url,options)=>{
  if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local'}]})};
  const payload=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(payload.existing_passage.markdown,draft.sections[0].markdown);assert.match(payload.instruction,/Do not regenerate/);
  return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify(draft)}})};
 }});
});
test('A repeated example shortly after a spoken passage remains available to resolve its spelling',async()=>{
 const segments=[{id:'s1',start:0,end:30,text:'Encode and decode the same string.'}],content='encode(x)\n[1,2]\ndecode([1,2])\n\'ab\'';
 await generateLocally({start:0,end:30,segments},[35,40].map((at,i)=>({id:'e'+i,at,image:'original',content})),{},'Edit the source.',{fetcher:async(url,options)=>{
  if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local'}]})};
  const payload=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(payload.screen_examples[0].decoded,'ab');
  return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify({title:'Text',sections:[{heading:'Round trip',segment_ids:['s1'],markdown:segments[0].text,uncertainties:[]}]})}})};
 }});
});
