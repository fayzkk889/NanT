import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parsePublisherPage,teachingBeats,findPublishedSource} from '../src/publishers.js';
import {runPipeline} from '../src/pipeline.js';
import {restoreChapter} from '../src/restore.js';
import {combineChapters} from '../src/book.js';
import {isContextFrame} from '../src/evidence.js';
import {batchSegments} from '../src/local-model.js';
import {bundleForExport,MAX_BOOK_CHAPTERS} from '../public/course-bundle.js';
const pageURL = 'https://ocw.mit.edu/courses/test/resources/lecture-one/';
const html = '<h1>Lecture: Search &amp; Sort</h1><iframe src="https://www.youtube.com/embed/6LOwPhPDwVc"></iframe><video data-downloadlink="https://archive.org/download/test/lecture.mp4"><track kind="captions" src="/courses/test/captions.vtt"></video>';
const fixture = JSON.parse(await readFile(new URL('../fixtures/original-lesson.json',import.meta.url)));
test('Publisher pages retain source identity, caption/download origin, and attribution obligations',()=>{
  const source = parsePublisherPage(html,pageURL);
  assert.equal(source.title,'Lecture: Search & Sort'); assert.equal(source.id,'6LOwPhPDwVc'); assert.equal(source.captionsURL,'https://ocw.mit.edu/courses/test/captions.vtt');
  assert.match(source.license.name,/BY-NC-SA/); assert.match(source.license.notice,/No MIT endorsement/);
  assert.throws(()=>parsePublisherPage(html.replace('/courses/test/captions.vtt','https://evil.example/captions.vtt'),pageURL));
  assert.throws(()=>parsePublisherPage(html.replace('https://archive.org/download/test/lecture.mp4','http://127.0.0.1/private.mp4'),pageURL));
});
test('Caption teaching beats preserve every word and measured times',()=>{
  const raw = [{start:0,end:2,text:'First line.'},{start:2,end:4,text:'Second line.'},{start:60,end:62,text:'After a gap.'}];
  const beats = teachingBeats(raw); assert.equal(beats.length,2); assert.equal(beats[0].text,'First line. Second line.'); assert.equal(beats[0].end,4); assert.equal(beats[1].start,60);
});
test('A teaching beat ends on a complete sentence before the next topic',()=>{
 const raw=[{start:0,end:26,text:'A variable declared with var is accessible inside the'},{start:26,end:31,text:'function in which it is defined.'},{start:31,end:50,text:'Next compare let with const.'}];
 const beats=teachingBeats(raw);assert.equal(beats.length,2);assert.equal(beats[0].end,31);assert.equal(beats[0].text,raw[0].text+' '+raw[1].text);assert.equal(beats[1].start,31);
});
test('Internal sentence punctuation prevents recognizer cues from forcing mid-sentence teaching cuts',()=>{
 const raw=[{start:0,end:29,text:'First explanation ends here. Now begin the next'},{start:29,end:50,text:'explanation and finish it.'},{start:50,end:65,text:'A final point.'}];
 const beats=teachingBeats(raw);assert.equal(beats.map(s=>s.text).join(' '),raw.map(s=>s.text).join(' '));assert.ok(beats.every(s=>/[.!?]$/.test(s.text)));assert.ok(beats.some(s=>s.endEstimated));
});
test('An unindexed YouTube URL does not crawl unrelated publishers',async()=>{
  let calls=0;
  assert.equal(await findPublishedSource('https://youtu.be/kCc8FmEb1nY',{youtubeId:'kCc8FmEb1nY',fetcher:async()=>{calls++;}}),null);
  assert.equal(calls,0);
});
test('A real-shaped publisher URL ingests captions without any pasted source or YouTube token',async()=>{
  const result = await runPipeline({url:pageURL,duration:300,visuals:false},{env:{},fetcher:async url=>({ok:true,headers:new Headers(),text:async()=>url.endsWith('.vtt')?'WEBVTT\n\n00:00.000 --> 00:10.000\nThe source explains a first attempt.':html})});
  assert.equal(result.source.kind,'publisher'); assert.equal(result.chapter.segments[0].text,'The source explains a first attempt.'); assert.match(result.provenance,/Publisher/); assert.match(result.markdown,/CC BY-NC-SA/);
  assert.ok(result.generated.warnings.some(w=>/Screen extraction was disabled/.test(w)));
});
test('Full-video processing assigns cues once, checkpoints each chapter, restores and exports one book',async()=>{
  const checkpoints=[];
  const book = await runPipeline({demo:true,scope:'full-video',duration:300},{fixture,onCheckpoint:async chapters=>checkpoints.push([...chapters])});
  assert.equal(book.schemaVersion,2); assert.equal(book.chapters.length,2); assert.equal(checkpoints.length,2);
  assert.deepEqual(book.chapter.segments.map(s=>s.id),fixture.segments.map((_,i)=>`s${String(i+1).padStart(5,'0')}`));
  assert.equal(new Set(book.evidence.map(e=>e.id)).size,book.evidence.length);
  assert.equal(restoreChapter(book).chapters.length,2);
  assert.throws(()=>combineChapters([book.chapters[0],book.chapters[0]]),/duplicate/);
  const parts=structuredClone(book.chapters);parts[0].generated.review={status:'passed',issues:[]};parts[1].generated.review={status:'unavailable',issues:[]};
  parts.forEach((part,i)=>{part.generated.model=`local-${i}`;part.generated.inspectedFrameIds=[part.evidence[0]?.id || 'e0001'];});
  const combined=combineChapters(parts);assert.equal(combined.generated.review.status,'unavailable');assert.equal(combined.generated.model,'local-0, local-1');assert.deepEqual(combined.generated.inspectedFrameIds,parts.map((part,i)=>`c${i+1}-${part.generated.inspectedFrameIds[0]}`));
});
test('Resume uses only matching completed chapter content and saves remaining work',async()=>{
  const book = await runPipeline({demo:true,scope:'full-video',duration:300},{fixture});
  let written = 0;
  await runPipeline({demo:true,scope:'full-video',duration:300},{fixture,resumeParts:[book.chapters[0]],onCheckpoint:async()=>written++});
  assert.equal(written,1);
  const changed = structuredClone(book.chapters[0]); changed.chapter.segments[0].text = 'Different lesson';
  written=0; await runPipeline({demo:true,scope:'full-video',duration:300},{fixture,resumeParts:[changed],onCheckpoint:async()=>written++}); assert.equal(written,2);
});
test('A ten-minute book chapter can reopen after preserving its final whole sentence',async()=>{
 const long=structuredClone(fixture);long.segments=[{start:0,end:590,text:'Begin this chapter.'},{start:590,end:650,text:'Preserve the complete final explanation.'}];long.evidence=[];
 const book=await runPipeline({scope:'full-video',duration:600},{fixture:long});
 assert.equal(book.chapters[0].chapter.end,650);assert.equal(restoreChapter(book).chapter.end,650);
});
test('A final short window stops at the known recording end and remains reopenable',async()=>{
 const short=structuredClone(fixture);short.source.duration=120;short.segments=[{start:0,end:115,text:'The complete short lesson.'}];short.evidence=[];
 const result=await runPipeline({duration:300},{fixture:short});assert.equal(result.chapter.end,120);assert.equal(result.chapter.planned,true);assert.deepEqual(result.report.captionGaps,[]);assert.equal(restoreChapter(result).chapter.end,120);
});

test('Exported books keep chapter images once and reconstruct the complete timeline on import',async()=>{
  const book=await runPipeline({demo:true,scope:'full-video',duration:300},{fixture});
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lY4AAAAASUVORK5CYII=';
  book.chapters[0].evidence[0].image=image;
  const combined=combineChapters(book.chapters),exported=bundleForExport(combined),json=JSON.stringify(exported);
  assert.equal(json.split(image).length-1,1);assert.equal(exported.evidence,undefined);
  const reopened=restoreChapter(JSON.parse(json));assert.equal(reopened.chapters.length,book.chapters.length);assert.ok(reopened.evidence.some(event=>event.image===image));assert.deepEqual(reopened.chapter.segments,combined.chapter.segments);
  assert.ok(MAX_BOOK_CHAPTERS>=Math.ceil(16799/300),'The selected four-hour Python course must fit the full-course chapter limit.');
});
test('Writing batches account for screen transcription text rather than captions alone',()=>{
  const segments = Array.from({length:4},(_,i)=>({id:`s${i}`,start:i*10,end:i*10+10,text:'A caption.'}));
  const evidence = segments.map(s=>({at:s.start,content:'x'.repeat(8000)}));
  const batches = batchSegments(segments,18000,evidence);
  assert.equal(batches.length,2); assert.deepEqual(batches.flat().map(s=>s.id),segments.map(s=>s.id));
});


test('Presentation selection keeps demonstrations in evidence and never hides user-supplied or unreadable code',async()=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lY4AAAAASUVORK5CYII=';
  const event={at:10,kind:'frame',content:'No teaching content is legible in this frame. The instructor holds cards.',origin:'Extracted automatically from the publisher-linked video; local vision.',image};
  assert.equal(isContextFrame(event),true);
  assert.equal(isContextFrame({...event,origin:'User-supplied frame'}),false);
  assert.equal(isContextFrame({...event,content:'Some code is [illegible]: def sort(L):'}),false);
  const supplied={...structuredClone(fixture),evidence:[event]};
  const result=await runPipeline({duration:300},{fixture:supplied});
  assert.equal(result.evidence.length,1);
  assert.equal(result.evidence[0].image,image);
  assert.equal(result.evidence[0].content,event.content);
  assert.match(result.markdown,/Additional captured frames/);
  assert.match(result.markdown,/e0001/);
  assert.equal(result.markdown.includes('The instructor holds cards.'),false);
});
