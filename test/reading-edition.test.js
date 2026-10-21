import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName} from 'pdf-lib';
import {prepareReadingMaterials,readingFrames,alignReadingExamples,readingOutput} from '../src/reading-materials.js';
import {createChapterPDF} from '../src/pdf.js';
import {combineChapters} from '../src/book.js';
import {hasReadingMaterials} from '../src/reading-materials.js';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8msAAAAASUVORK5CYII=';
function result(){return {source:{id:'kCc8FmEb1nY',url:'https://www.youtube.com/watch?v=kCc8FmEb1nY',title:'A complete lesson',author:'Test creator'},provenance:'A test source',chapter:{start:0,end:300,segments:[{id:'s00001',start:0,end:30,text:'Define the function and print the result.'},{id:'s00002',start:30,end:60,text:'Change the value and print it again.'}]},evidence:[10,29,40,59].map((at,i)=>({id:'e'+i,at,kind:'frame',title:'Screen',content:'```python\nprint(value)\n```',image,origin:'Extracted automatically from the public YouTube video'})),generated:{mode:'model',warnings:[],draft:{title:'A complete lesson',sections:[{heading:'First step',segment_ids:['s00001'],markdown:'Define the function, then print the result. Keep this entire explanation.',uncertainties:[]},{heading:'Next step',segment_ids:['s00002'],markdown:'Change the value and print it again. Preserve this complete explanation too.',uncertainties:[]}]}},report:{warnings:[],segmentCoverage:{covered:2,total:2},codeStates:0,terminalRecords:0}};}
const response=value=>({ok:true,json:async()=>value});
function model(output,onCall=()=>{}){return async(url,options)=>{
 if(url.endsWith('/tags'))return response({models:[{name:'local',capabilities:['vision']}]});
 assert.equal(url,'http://127.0.0.1:11434/api/chat');const request=JSON.parse(options.body);assert.equal(request.messages[1].images.length,1);onCall(request);
 return response({done:true,message:{content:JSON.stringify(output)}});
};}
function links(pdf){return pdf.getPages().flatMap(page=>(page.node.Annots()?.asArray() || []).map(ref=>{const annotation=pdf.context.lookup(ref),action=pdf.context.lookup(annotation.get(PDFName.of('A')));return action?.get(PDFName.of('URI'))?.decodeText();}));}
function images(pdf){return [...pdf.context.enumerateIndirectObjects()].filter(([,value])=>(value?.dict || value)?.get?.(PDFName.of('Subtype'))===PDFName.of('Image')).length;}

test('Clean export transcribes original screens locally, deduplicates unchanged code, and preserves the entire lesson source',async()=>{
 const original=result(),before=JSON.stringify(original);let calls=0;
 assert.deepEqual(readingFrames(original).map(f=>f.id),['e1','e2','e3']);
 const prepared=await prepareReadingMaterials(original,{cache:false,fetcher:model({kind:'code',code:'print(value)',output:'3',description:'',language:'python',complete:true},()=>calls++)});
 assert.equal(calls,3);assert.equal(prepared.generated.readingMaterials.items.length,1);assert.deepEqual(prepared.generated.readingMaterials.items[0].sourceFrameIds,['e1','e2','e3']);assert.equal(JSON.stringify(original),before);assert.deepEqual(prepared.generated.draft,original.generated.draft);
 const pdf=await PDFDocument.load(await createChapterPDF(prepared));assert.equal(images(pdf),0);assert.equal(links(pdf).length,1);
 const notes=await PDFDocument.load(await createChapterPDF(prepared,'classic',{edition:'notes'}));assert.equal(images(notes),0);assert.match(notes.getSubject(),/Study notes/);
 const timestamped=await PDFDocument.load(await createChapterPDF(prepared,'textbook',{timestamps:true}));assert.ok(links(timestamped).length>1);
});

test('Source review remains available without a model; clean export cannot silently delete unreadable code',async()=>{
 const original=result();await assert.rejects(createChapterPDF(original),/Prepare readable code/);
 await assert.rejects(prepareReadingMaterials(original,{cache:false,fetcher:async()=>{throw new Error('offline');}}),/local vision model/);
 const source=await PDFDocument.load(await createChapterPDF(original,'textbook',{edition:'source'}));assert.equal(images(source),4);assert.ok(links(source).length>1);
 await assert.rejects(prepareReadingMaterials(original,{cache:false,fetcher:model({kind:'code',code:'',output:'',description:'',language:'python',complete:false})}),/could not be converted/);
});

test('Documentation browsing can be excluded without inventing code or changing prose',async()=>{
 const original=result(),prepared=await prepareReadingMaterials(original,{cache:false,fetcher:model({kind:'none',code:'',output:'',description:'',language:'',complete:true})});
 assert.equal(prepared.generated.readingMaterials.items.length,0);assert.deepEqual(prepared.generated.draft,original.generated.draft);
 await assert.rejects(createChapterPDF(prepared,'textbook',{edition:'summary'}),/Full lesson/);
});

test('A changed output survives even when the same code is executed again',async()=>{
 let value=0;const prepared=await prepareReadingMaterials(result(),{cache:false,fetcher:async(url,options)=>{
   if(url.endsWith('/tags'))return response({models:[{name:'local',capabilities:['vision']}]});
   return response({done:true,message:{content:JSON.stringify({kind:'code',code:'print(value)',output:String(++value),description:'',language:'python',complete:true})}});
 }});
 assert.deepEqual(prepared.generated.readingMaterials.items.map(item=>item.output),['1','2','3']);assert.equal(prepared.generated.readingMaterials.items[0].code,'print(value)');assert.equal(prepared.generated.readingMaterials.items[1].sourceCode,'print(value)');
});

test('Typed encoder examples preserve the exact input paired with a repeated screen observation',()=>{
 const original=result();original.generated.screenExamples=[{at:29,segment_id:'s00001',decoded:'hii there',encoded:[46,47,47,1,58,46,43,56,43],frameIds:['e1','e2']}];
 const value={kind:'code',code:'print(encode("hi there"))',output:'[46,47,47,1,58,46,43,56,43]\nhi there'};
 const aligned=alignReadingExamples(value,original,{at:29});assert.equal(aligned.code,'print(encode("hii there"))');assert.match(aligned.output,/hii there/);assert.equal(value.code,'print(encode("hi there"))');
 const missing=alignReadingExamples({...value,output:'[46,47,1,58,46,43,56,43]\nhi there'},original,{at:29});assert.match(missing.output,/\[46,47,47,1,58,46,43,56,43\]/);
});

test('Setup commands remain included even when the passage-end screen has scrolled past them',()=>{
 const original=result();original.evidence[0].content='!wget https://example.org/input.txt';assert.ok(readingFrames(original).some(frame=>frame.id==='e0'));
});

test('Long raw data displays become explicit excerpts without shortening the code or losing raw observations',()=>{
 const value={code:'print(data[:1000])',output:'torch.Size([1115394]) torch.int64\ntensor(['+Array.from({length:100},(_,i)=>i).join(', ')+'])'};
 const formatted=readingOutput(value);assert.equal(formatted.code,value.code);assert.equal(formatted.rawOutput,value.output);assert.match(formatted.output,/0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, \.\.\./);assert.match(formatted.output,/Display excerpt/);assert.match(formatted.output,/1115394/);
});

test('Reopening a book retains every chapter material and never treats a partial preparation as complete',()=>{
 const first={...result(),framePlan:[]},second=structuredClone(first);second.chapter={start:300,end:600,segments:second.chapter.segments.map((s,i)=>({...s,id:'s0000'+(i+3),start:s.start+300,end:s.end+300}))};second.evidence=second.evidence.map(e=>({...e,at:e.at+300}));second.generated.draft.sections=second.generated.draft.sections.map((s,i)=>({...s,segment_ids:['s0000'+(i+3)]}));
 first.generated.readingMaterials={version:'reading-materials-v1',machineRead:true,items:[{id:'e1',at:29,sourceFrameIds:['e1'],kind:'code',code:'print(1)',output:'1',description:''}]};
 assert.equal(hasReadingMaterials(combineChapters([first,second])),false);
 second.generated.readingMaterials={version:'reading-materials-v1',machineRead:true,items:[{...first.generated.readingMaterials.items[0],at:329,code:'print(2)',output:'2'}]};
 const book=combineChapters([first,second]);assert.equal(hasReadingMaterials(book),true);assert.deepEqual(book.generated.readingMaterials.items.map(item=>item.code),['print(1)','print(2)']);assert.deepEqual(book.generated.readingMaterials.items[1].sourceFrameIds,['c2-e1']);
});
