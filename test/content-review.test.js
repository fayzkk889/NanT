import test from 'node:test';
import assert from 'node:assert/strict';
import {generate, preserveUnverifiedExplanations,validateDraft} from '../src/generation.js';
import {runPipeline} from '../src/pipeline.js';
import {generateLocally} from '../src/local-model.js';

test('A character-level encoded list cannot silently acquire a different input string',()=>{
 const source=[{id:'s1',start:0,end:30,text:'Our character-level encoder returns one integer for each character.'}];
 const make=markdown=>({title:'Encoding',sections:[{heading:'Round trip',segment_ids:['s1'],markdown,uncertainties:[]}]});
 assert.throws(()=>validateDraft(make('The character-level encoder translates "hi there" to [46, 47, 47, 1, 58, 46, 43, 56, 43].'),source),/character_example_mismatch/);
 assert.doesNotThrow(()=>validateDraft(make('The character-level encoder translates "hii there" to [46, 47, 47, 1, 58, 46, 43, 56, 43].'),source));
 assert.doesNotThrow(()=>validateDraft(make('The subword encoder translates "hii there" to [71, 4178, 612].'),source));
});

test('Valid JSON cannot conceal a sentence cut inside inline code or at a conjunction',()=>{
 const source=[{id:'s1',start:0,end:30,text:'Define encode and decode functions.'}];
 for(const markdown of ['Define two functions: `encode` and `','Define both encode and'])assert.throws(()=>validateDraft({title:'Functions',sections:[{heading:'Functions',segment_ids:['s1'],markdown,uncertainties:[]}]},source),/unfinished_passage/);
});
test('A near-matching speech spelling cannot replace the repeated displayed round-trip input',()=>{
 const segments=[{id:'s1',start:0,end:30,text:'Encode hi there and decode it to get the exact same string.'}],examples=[{decoded:'hii there',encoded:[46,47,47,1,58,46,43,56,43]}];
 const make=markdown=>({title:'Encoding',sections:[{heading:'Round trip',segment_ids:['s1'],markdown,uncertainties:[]}]});
 assert.throws(()=>validateDraft(make('Encode an arbitrary piece of text, such as "hi there", then decode it back.'),segments,examples),/screen_example_mismatch/);
 assert.doesNotThrow(()=>validateDraft(make('Encode the displayed example, then decode the list back to its original string.'),segments,examples));
});
test('A short mention of BPE cannot turn into an ungrounded background lecture',()=>{
 const segments=[{id:'s1',start:0,end:30,text:'Use the GPT-2 encoding from tiktoken. It produces three integers for the displayed string.'}];
 const draft={title:'Tokens',sections:[{heading:'BPE',segment_ids:['s1'],markdown:'Build a vocabulary by repeatedly merging the most frequent character pairs in training data. '.repeat(8),uncertainties:[]}]};
 assert.throws(()=>validateDraft(draft,segments),/unsupported_expansion/);
});

test('Repairing separated passages uses their actual source neighbors rather than neighboring repair targets',async()=>{
 const full=[{id:'s1',start:0,end:15,text:'Create the vocabulary.'},{id:'s2',start:15,end:30,text:'Next, define the encoder and decoder.'},{id:'s3',start:30,end:45,text:'Use those functions on the dataset.'}];
 const result=await generateLocally({start:0,end:45,segments:[full[0],full[2]]},[],{},'Write these passages.',{contextSegments:full,fetcher:async(url,options)=>{
  if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local-test'}]})};
  const payload=JSON.parse(JSON.parse(options.body).messages[1].content),row=payload.segments[0];
  if(row.id==='s3')assert.equal(payload.boundary_context.find(item=>item.boundary==='previous ending').text,full[1].text);
  return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify({title:'Lesson',sections:[{heading:'Step',segment_ids:[row.id],markdown:row.text,uncertainties:[]}]})}})};
 }});
 assert.equal(result.retained.length,0);
});

test('A writer that repeats an earlier passage is retried and recovered without accepting the repetition',async()=>{
  const first='Construct a vocabulary by collecting unique characters, sorting the resulting list, and assigning a distinct integer to every character. Retain both mappings so an encoder can translate the input and a decoder can restore the original string.';
  const second='Import torch and encode the entire training dataset. Wrap those integer values in a torch tensor with the long integer dtype.';
  const segments=[{id:'s1',start:0,end:30,text:first},{id:'s2',start:30,end:60,text:second}];let calls=0;
  const result=await generateLocally({segments,start:0,end:60},[],{},'Write only this passage.',{fetcher:async(url,options)=>{
    if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local-test'}]})};
    calls++;const payload=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(payload.previous_context,undefined);
    return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify({title:'Lesson',sections:[{heading:'Vocabulary',segment_ids:[payload.segments[0].id],markdown:first,uncertainties:[]}]})}})};
  }});
  assert.equal(calls,3);assert.deepEqual(result.retained,['s2']);assert.equal(result.draft.sections[1].markdown,second);
});

test('Persistent content differences retain labeled source wording instead of the flawed rewrite',async()=>{
  const segment={id:'s00001',start:0,end:300,text:'Set swap to false, compare the next pair, and change the flag after swapping. '.repeat(12)};
  const result=await generate({start:0,end:300,segments:[segment]},[],{provider:'local',useModel:true,env:{},fetcher:async(url,options)=>{
    if (url.endsWith('/tags')) return {ok:true,json:async()=>({models:[{name:'test-local'}]})};
    const body=JSON.parse(options.body), review=body.messages[0].content.startsWith('Compare written');
    if(body.messages[0].content.startsWith('Audit these'))return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify({decisions:[{issue_index:0,supported:true,reason:'The flag initialization is absent.'}]})}})};
    const output=review ? {issues:[{segment_id:'s00001',problem:'The flag setup is omitted.',source_quote:'Set swap to false',draft_quote:''}]} : {title:'Lesson',sections:[{heading:'The flag',segment_ids:['s00001'],markdown:'Generic swapping explanation. '.repeat(30),uncertainties:[]}]};
    return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify(output)}})};
  }});
  assert.equal(result.mode,'source'); assert.equal(result.generationFailed,true); assert.equal(result.failureReason,'all_passages_retained'); assert.equal(result.review.status,'source_retained'); assert.deepEqual(result.sourceFallbackSegments,['s00001']); assert.equal(result.draft.sections[0].markdown,segment.text); assert.match(result.draft.sections[0].heading,/Original explanation/);
});
test('A falsely reassuring model review cannot drop a literal zero or flag value',async()=>{
  const segment={id:'s00001',start:0,end:30,text:'Initialize total to 0 and keep the flag false until the next comparison.'};
  const result=await generate({start:0,end:300,segments:[segment]},[],{provider:'local',useModel:true,env:{},fetcher:async(url,options)=>{
    if (url.endsWith('/tags')) return {ok:true,json:async()=>({models:[{name:'test-local'}]})};
    const reviewing=JSON.parse(options.body).messages[0].content.startsWith('Compare written');
    const output=reviewing ? {issues:[]} : {title:'Lesson',sections:[{heading:'Initialize',segment_ids:['s00001'],markdown:'Initialize the total to 1, then make the next comparison.',uncertainties:[]}]};
    return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify(output)}})};
  }});
  assert.equal(result.draft.sections[0].markdown,segment.text); assert.equal(result.review.status,'source_retained'); assert.deepEqual(result.sourceFallbackSegments,['s00001']);
});


test('Local-only policy rejects cloud source or writing requests before any network activity',async()=>{
  for (const input of [{access:'google'},{useModel:true,provider:'openai'}]) {
    let calls=0;
    await assert.rejects(runPipeline(input,{fetcher:async()=>{calls++;throw new Error('Unexpected network');}}),/locally|local writing/);
    assert.equal(calls,0);
  }
});

test('Untrusted automatic code interpretation and cost relations retain the original explanation',()=>{
  const rows=[{id:'math',start:0,end:15,text:'The cost of k searches is k log n.'},{id:'flag',start:15,end:30,text:'Set swap initially to false. Repeat while not swap.'},{id:'plain',start:30,end:45,text:'Compare adjacent pairs.'}];
  const draft={title:'Sorting',sections:rows.map(s=>({heading:s.id,segment_ids:[s.id],markdown:'An invented explanation.',uncertainties:[]}))};
  const result=preserveUnverifiedExplanations({segments:rows},[{at:20,kind:'frame',content:'```python\ndef bubble_sort(L):\n    swap = False\n```'}],draft);
  assert.deepEqual(result.retained,['math','flag']);
  assert.equal(result.draft.sections[0].markdown,rows[0].text);
  assert.equal(result.draft.sections[1].markdown,rows[1].text);
  assert.equal(result.draft.sections[2].markdown,'An invented explanation.');
});

test('A physical card demonstration is not rewritten as adjusting audio volume',()=>{
  const text="I'll turn these up so you can see them. Start at the front of the list and compare the numbers pairwise.";
  const result=preserveUnverifiedExplanations({segments:[{id:'cards',start:0,end:30,text}]},[],{title:'Sorting',sections:[{heading:'Compare pairs',segment_ids:['cards'],markdown:'The instructor turns up the volume so the audience can see the materials.',uncertainties:[]}]});
  assert.deepEqual(result.retained,['cards']);
  assert.equal(result.draft.sections[0].markdown,text);
});

test('Relevant code screens do not blanket-replace sound written explanations with captions',()=>{
  const text='Set swap initially to false. Repeat while not swap.';
  const written='Initialize swap to false, then repeat the pass while not swap.';
  const result=preserveUnverifiedExplanations({segments:[{id:'flag',start:0,end:30,text}]},[{at:15,kind:'frame',content:'```python\ndef bubble_sort(L):\n    swap = False\n```'}],{title:'Sorting',sections:[{heading:'The flag',segment_ids:['flag'],markdown:written,uncertainties:[]}]});
  assert.deepEqual(result.retained,[]);assert.equal(result.draft.sections[0].markdown,written);
});

test('Machine-caption number corrections can follow the screen without enforcing corrupt speech recognition',async()=>{
  const segments=[{id:'s00001',start:0,end:30,text:'GPT two has five 256 vocabulary tokens.'}];
  const result=await generate({start:0,end:300,segments},[{at:10,kind:'terminal',content:'enc.n_vocab\n50257'}],{provider:'local',useModel:true,machineTranscript:true,env:{},fetcher:async(url,options)=>{
    if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local-test'}]})};
    const reviewing=JSON.parse(options.body).messages[0].content.startsWith('Compare written');
    const output=reviewing?{issues:[]}:{title:'Tokenization',sections:[{heading:'Vocabulary',segment_ids:['s00001'],markdown:'The GPT-2 tokenizer has 50,257 vocabulary entries, as shown by enc.n_vocab.',uncertainties:[]}]};
    return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify(output)}})};
  }});
  assert.equal(result.mode,'model');assert.deepEqual(result.sourceFallbackSegments,[]);assert.match(result.draft.sections[0].markdown,/50,257/);
});

test('An invalid passage cannot discard valid writing from the rest of the chapter',async()=>{
  const segments=[{id:'s00001',start:0,end:15,text:'Compare adjacent items and keep walking through the list.'},{id:'s00002',start:15,end:30,text:'Exchange the pair if the left item is greater.'}];
  const result=await generate({start:0,end:300,segments},[],{provider:'local',useModel:true,env:{},fetcher:async(url,options)=>{
    if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local-test'}]})};
    const body=JSON.parse(options.body),review=body.messages[0].content.startsWith('Compare written');
    const row=review ? null : JSON.parse(body.messages[1].content).segments[0];
    const output=review ? {issues:[]} : {title:'Sorting',sections:[{heading:'Compare pairs',segment_ids:[row.id],markdown:row.id==='s00002'?'```python\ninvented()\n```':row.text,uncertainties:[]}]};
    return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify(output)}})};
  }});
  assert.equal(result.mode,'model');assert.deepEqual(result.sourceFallbackSegments,['s00002']);
  assert.equal(result.draft.sections[0].markdown,segments[0].text);assert.equal(result.draft.sections[1].markdown,segments[1].text);
  assert.match(result.draft.sections[1].heading,/Original explanation/);
});

test('A failed repair preserves the valid draft and retains the flagged source passage',async()=>{
  const segments=[{id:'s00001',start:0,end:15,text:'Compare the adjacent pair.'},{id:'s00002',start:15,end:30,text:'Continue until the pass makes no exchanges.'}];let writes=0;
  const result=await generate({start:0,end:300,segments},[],{provider:'local',useModel:true,env:{},fetcher:async(url,options)=>{
    if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local-test'}]})};
    const body=JSON.parse(options.body),review=body.messages[0].content.startsWith('Compare written');
    if(body.messages[0].content.startsWith('Audit these'))return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify({decisions:[{issue_index:0,supported:true,reason:'The stopping condition is absent.'}]})}})};
    if(!review && ++writes>2)return {ok:false};
    const row=review ? null : JSON.parse(body.messages[1].content).segments[0];
    const output=review ? {issues:[{segment_id:'s00002',problem:'The stopping condition is missing.',source_quote:'Continue until the pass makes no exchanges.',draft_quote:''}]} : {title:'Sorting',sections:[{heading:'Step',segment_ids:[row.id],markdown:row.id==='s00001'?'Inspect the adjacent pair before continuing.':'Keep exchanging items.',uncertainties:[]}]};
    return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify(output)}})};
  }});
  assert.equal(result.mode,'model');assert.equal(result.review.repairFailed,true);
  assert.equal(result.draft.sections[0].markdown,'Inspect the adjacent pair before continuing.');
  assert.equal(result.draft.sections[1].markdown,segments[1].text);
});

test('Completed spoken sentences cannot pull unrelated facts from the next passage into writing context',async()=>{
 const context=[{id:'s1',start:0,end:15,text:'Earlier setup. Keep the existing mapping.'},{id:'s2',start:15,end:30,text:'SentencePiece uses subword units.'},{id:'s3',start:30,end:45,text:'GPT-2 has about 50,000 vocabulary entries.'}];
 await generateLocally({segments:[context[1]],start:15,end:30},[],{},'Write this point.',{contextSegments:context,fetcher:async(url,options)=>{
  if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local-test'}]})};
  const payload=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(payload.boundary_context.some(item=>item.boundary==='next opening'),false);assert.doesNotMatch(JSON.stringify(payload),/50,000|Earlier setup/);
  return {ok:true,json:async()=>({done:true,done_reason:'stop',message:{content:JSON.stringify({title:'Subwords',sections:[{heading:'Units',segment_ids:['s2'],markdown:context[1].text,uncertainties:[]}]})}})};
 }});
});
