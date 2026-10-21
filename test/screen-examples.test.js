import test from 'node:test';
import assert from 'node:assert/strict';
import {screenExamples} from '../src/screen-examples.js';
import {validateDraft} from '../src/generation.js';
test('Repeated decoded output can anchor an example despite OCR misspelling its input call',()=>{
 const content='enc.encode("hil there")\n[71,4178,612]\nenc.decode([71,4178,612])\n\'hii there\'';
 const frames=[1,2].map(n=>({id:'e'+n,at:n,kind:'frame',content,image:'original'}));
 const anchors=screenExamples(frames);assert.equal(anchors.length,1);assert.equal(anchors[0].decoded,'hii there');assert.deepEqual(anchors[0].encoded,[71,4178,612]);assert.deepEqual(anchors[0].frameIds,['e1','e2']);
 assert.deepEqual(screenExamples(frames.slice(0,1)),[]);
 const source=[{id:'s1',start:0,end:30,text:'Use GPT-2 to encode the same string as three integers.'}];
 const draft=text=>({title:'Tokens',sections:[{heading:'Example',segment_ids:['s1'],markdown:text,uncertainties:[]}]});
 assert.throws(()=>validateDraft(draft('Encoding "hi there" produces [71, 4178, 612].'),source,anchors),/screen_example_mismatch/);
 assert.doesNotThrow(()=>validateDraft(draft('Encoding "hii there" produces [71, 4178, 612].'),source,anchors));
});
test('Observed alternative decoded states remain distinct rather than becoming one invented canonical result',()=>{
 const frames=['first','first','second','second'].map((text,i)=>({id:'e'+i,at:i,image:'original',content:'encode(x)\n[1,2]\ndecode([1,2])\n\''+text+'\''}));
 assert.deepEqual(screenExamples(frames).map(item=>item.decoded),['first','second']);
});
