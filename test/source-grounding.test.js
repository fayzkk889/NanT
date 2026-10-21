import test from 'node:test';
import assert from 'node:assert/strict';
import {groundSpeech,groundDraftFacts} from '../src/source-grounding.js';
import {generate,validateDraft} from '../src/generation.js';
const text='Encode hi there, then decode the integers back to the exact same string.';
const chapter={start:0,end:30,segments:[{id:'s1',start:0,end:30,text}]};
const content='encode(x)\n[71,4178,612]\ndecode([71,4178,612])\n\'hii there\'\nn_vocab\n50257';
const evidence=[10,35].map((at,i)=>({id:'e'+i,at,image:'original',content}));
test('Repeated decoded output corrects near-matching machine speech without changing the original transcript',()=>{
 const result=groundSpeech(chapter,evidence);assert.match(result.chapter.segments[0].text,/Encode hii there/);assert.equal(chapter.segments[0].text,text);assert.equal(result.corrections[0].before,'hi there');assert.equal(result.corrections[0].after,'hii there');assert.deepEqual(result.corrections[0].frameIds,['e0','e1']);
 assert.equal(groundSpeech(chapter,evidence.slice(0,1)).corrections.length,0);
 assert.equal(groundSpeech({...chapter,segments:[{...chapter.segments[0],text:'Discuss a different mathematical proof.'}]},evidence).corrections.length,0);
});
test('Ambiguous decoded observations never select an invented canonical input',()=>{
 const alternative=[12,25].map((at,i)=>({id:'alt'+i,at,image:'original',content:content.replace('hii there','hi there')}));
 assert.equal(groundSpeech(chapter,[...evidence,...alternative]).corrections.length,0);
});

test('Original screens plus an exact spoken occurrence resolve close technical-name errors with an audit trail',()=>{
 const source={segments:[{id:'s1',start:150,end:185,text:'ECMO script is a specification. The first version was released in 1997.'},{id:'s2',start:10,end:20,text:'Compare JavaScript with ECMAScript.'}]};
 const frames=[158,171].map((at,i)=>({id:'f'+i,at,image:'original',content:'ECMAScript  JavaScript'}));
 const result=groundSpeech(source,frames);assert.match(result.chapter.segments[0].text,/ECMAScript is/);assert.match(source.segments[0].text,/ECMO script/);assert.equal(result.corrections[0].after,'ECMAScript');assert.deepEqual(result.corrections[0].frameIds,['f0','f1']);
 assert.equal(groundSpeech({...source,segments:source.segments.slice(0,1)},frames).corrections.length,0);
 assert.equal(groundSpeech(source,frames.map(f=>({...f,at:500}))).corrections.length,0);
 assert.equal(groundSpeech({...source,segments:[{...source.segments[0],text:'The deliberate typo is ECMO script.'}]},frames).corrections.length,0);
});

test('OCR cannot silently remove spaces from a spoken string literal',()=>{
 const source={segments:[{id:'s1',start:0,end:30,text:'Type hello world, then print hello word.'}]};
 const frames=[10,20].map((at,i)=>({id:'f'+i,at,image:'original',content:'HelloWorld'}));
 assert.equal(groundSpeech(source,frames).corrections.length,0);
});

test('An unrecognized declaration keyword needs repeated matching loop syntax, never a guessed replacement',()=>{
 const source={segments:[{id:'s1',start:190,end:220,text:'When you declare a variable with the work keyword, that variable is accessible inside the function.'}]};
 const frames=[202,217].map((at,i)=>({id:'f'+i,at,image:'original',content:i?'for(var i=0;i<5;i++)':'for（vari=0;i<5;i++）'}));
 const result=groundSpeech(source,frames);assert.match(result.chapter.segments[0].text,/with the var keyword/);assert.equal(result.corrections[0].before,'work');assert.match(source.segments[0].text,/work keyword/);
 assert.equal(groundSpeech(source,frames.slice(0,1)).corrections.length,0);
 assert.equal(groundSpeech(source,[frames[0],{...frames[1],content:'for(let i=0;i<5;i++)'}]).corrections.length,0);
 assert.equal(groundSpeech({...source,segments:[{...source.segments[0],text:source.segments[0].text.replace('work','let')}]},frames).corrections.length,0);
});

test('String punctuation is grounded to repeated quoted calls while preserving the literal and raw transcript',()=>{
 const source={segments:[{id:'s1',start:230,end:260,text:'Type console.log, a single code, hello world, another single code to terminate.'}]};
 const frames=[246,257].map((at,i)=>({id:'f'+i,at,image:'original',content:"console.log('Hello World');"}));
 const result=groundSpeech(source,frames);assert.match(result.chapter.segments[0].text,/single quote/);assert.equal(result.corrections.length,2);assert.match(source.segments[0].text,/single code/);assert.equal(groundSpeech(source,frames.slice(0,1)).corrections.length,0);
 const draft={title:'Console',sections:[{heading:'Print',segment_ids:['s1'],markdown:'Type console.log followed by a single comma. Use another single comma to terminate the string argument.',uncertainties:[]}]};
 assert.throws(()=>validateDraft(draft,result.chapter.segments),/changed_string_delimiter/);
});

test('Spoken variable names keep the underscores actually present in repeated assignments',()=>{
 const source={segments:[{id:'s1',start:205,end:244,text:'Create a variable called player choice. We use an underscore in the name player choice.'}]};
 const frames=[238,245].map((at,i)=>({id:'f'+i,at,image:'original',content:'player_choice = "rock"'}));
 const result=groundSpeech(source,frames);assert.equal(result.corrections.length,2);assert.match(result.chapter.segments[0].text,/called player_choice/);assert.match(source.segments[0].text,/called player choice/);
 const draft={title:'Variables',sections:[{heading:'Name',segment_ids:['s1'],markdown:'Create a variable called `player choice`. Use an underscore in the variable name to separate these words.',uncertainties:[]}]};assert.throws(()=>validateDraft(draft,result.chapter.segments),/changed_identifier_spelling/);
 assert.equal(groundSpeech(source,frames.slice(0,1)).corrections.length,0);
 assert.equal(groundSpeech({...source,segments:[{...source.segments[0],text:'Discuss player choice in game design.'}]},frames).corrections.length,0);
});
test('Grounding preserves intentional mistakes and a decoder mismatch demonstration',()=>{
 const broken={...chapter,segments:[{...chapter.segments[0],text:'Encode hi there. The decoder returns a different string; this is a bug.'}]};assert.equal(groundSpeech(broken,evidence).corrections.length,0);
 const segments=[{id:'s1',text:'The vocabulary size is 50,256. This is a deliberate off-by-one mistake.'}],draft={title:'Debugging',sections:[{heading:'Incorrect count',segment_ids:['s1'],markdown:segments[0].text,uncertainties:[]}]};
 const result=groundDraftFacts(draft,[{vocabSize:50257}],segments);assert.equal(result.corrections.length,0);assert.equal(result.draft.sections[0].markdown,draft.sections[0].markdown);assert.doesNotThrow(()=>validateDraft(result.draft,segments,[{vocabSize:50257}]));
});
test('Displayed count binding fixes direct and parenthetical off-by-one counts while preserving ID bounds',()=>{
 const make=markdown=>({title:'GPT-2',sections:[{heading:'Vocabulary',segment_ids:['s1'],markdown,uncertainties:[]}]});
 for(const text of ['The vocabulary size is 50,256. IDs range from 0 to 50,256.','The vocabulary expands to approximately 50,000 tokens (specifically 50,256). IDs range from 0 to 50,256.']){
  const result=groundDraftFacts(make(text),[{vocabSize:50257,frameIds:['e0','e1']}]);assert.match(result.draft.sections[0].markdown,/50,257/);assert.match(result.draft.sections[0].markdown,/IDs range from 0 to 50,256/);assert.equal(result.corrections.length,1);
  assert.doesNotThrow(()=>validateDraft(result.draft,[{id:'s1',text:'Describe the vocabulary and its token ID range.'}],[{vocabSize:50257}]));
 }
});
test('Writing and review use screen-grounded speech while the exported chapter can retain raw speech for auditing',async()=>{
 const result=await generate(chapter,evidence,{useModel:true,machineTranscript:true,env:{},fetcher:async(url,options)=>{
  if(url.endsWith('/tags'))return {ok:true,json:async()=>({models:[{name:'local'}]})};
  const request=JSON.parse(options.body),payload=JSON.parse(request.messages[1].content),review=request.messages[0].content.startsWith('Compare written');
  assert.match((review?payload.sources:payload.segments)[0].text,/Encode hii there/);
  const output=review?{issues:[]}:{title:'Encoding',sections:[{heading:'Round trip',segment_ids:['s1'],markdown:payload.segments[0].text,uncertainties:[]}]};
  return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify(output)}})};
 }});assert.equal(result.mode,'model');assert.equal(result.groundingCorrections.length,1);assert.match(result.draft.sections[0].markdown,/hii there/);assert.equal(chapter.segments[0].text,text);
});
