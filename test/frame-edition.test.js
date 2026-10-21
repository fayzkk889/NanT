import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionFrames} from '../src/evidence.js';
import {runPipeline} from '../src/pipeline.js';
import {renderMarkdown} from '../src/markdown.js';
import {createChapterPDF} from '../src/pdf.js';
import {PDFDocument,PDFName} from 'pdf-lib';
test('Reading selection retains correction endpoints and every original asset exactly once',()=>{
 const chapter={segments:[{start:0,end:30,text:'Start with the wrong initializer, then fix its type.'},{start:30,end:60,text:'Inspect the result.'}]};
 const frames=[1,10,20,35,50].map((at,i)=>({id:'e'+i,at,kind:'frame',image:'original '+i,origin:'Extracted automatically from the public YouTube video',content:'screen text'}));
 const authored={id:'code',at:42,kind:'code',content:'const sum = 0;',origin:'Supplied creator code'};
 const selected=partitionFrames(chapter,[...frames,authored]);
 assert.deepEqual(selected.primary.map(e=>e.id),['e0','e2','e4','code']);
 assert.deepEqual(selected.additional.map(e=>e.id),['e1','e3']);
 assert.equal(new Set([...selected.primary,...selected.additional].map(e=>e.id)).size,6);
 assert.equal(selected.additional[0].image,'original 1');
});
test('Late screen observations retain chronological positions in Markdown and PDF',async()=>{
 const fixture={source:{id:'kCc8FmEb1nY',url:'https://www.youtube.com/watch?v=kCc8FmEb1nY',title:'Timeline test',author:'Authored test',synthetic:true},provenance:'Authored timeline test, not a real course.',segments:[{start:0,end:100,text:'Introduce the encoder.'},{start:100,end:200,text:'Explain the mapping.'},{start:200,end:300,text:'Continue the lesson.'}],evidence:[{at:125,kind:'code',content:'encode(text)',title:'Encoder',language:'python',origin:'Authored test'}]};
 const result=await runPipeline({duration:300},{fixture});result.generated.screenExamples=[{at:150,segment_id:'s00001',decoded:'ab',encoded:[1,2],frameIds:[]}];
 const markdown=renderMarkdown(result),times=[...markdown.matchAll(/&t=(\d+)s/g)].map(match=>Number(match[1]));assert.deepEqual(times,[...times].sort((a,b)=>a-b));
 const pdf=await PDFDocument.load(await createChapterPDF(result,'textbook',{edition:'source'})),links=[];
 for(const page of pdf.getPages())for(const ref of page.node.Annots()?.asArray() || []){const annotation=pdf.context.lookup(ref),action=pdf.context.lookup(annotation.get(PDFName.of('A'))),uri=action?.get(PDFName.of('URI'))?.decodeText();const match=uri?.match(/&t=(\d+)s/);if(match)links.push(Number(match[1]));}
 assert.deepEqual(links,[0,100,125,150,200]);
});
