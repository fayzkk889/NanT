import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runPipeline} from '../src/pipeline.js';
import {SourceNeeded} from '../src/errors.js';
import {restoreChapter} from '../src/restore.js';
import {mediaStore} from '../src/uploads.js';
import {createSourceTools} from '../src/source-tools.js';
import {createApp} from '../server.js';
const offline=async()=>{throw new Error('No external request in this test');};
const rows=[{start:0,end:15,text:'Start with the list [1, 11, 5, 6, 2].'},{start:16,end:30,text:'Compare adjacent pairs and move the larger value right.'}];
const scratch=fileURLToPath(new URL('../work/test-stores/',import.meta.url));
async function temporary(){await mkdir(scratch,{recursive:true});return mkdtemp(path.join(scratch,'source-'));}

test('Public YouTube captions use the local adapter without editing tokens or pasted source',async()=>{
  let captions=0;
  const result=await runPipeline({url:'https://youtu.be/kCc8FmEb1nY',duration:300,visuals:false},{env:{},fetcher:offline,sourceTools:{captions:async id=>{captions++;assert.equal(id,'kCc8FmEb1nY');return {segments:rows,origin:'Public caption test'};}}});
  assert.equal(captions,1);assert.equal(result.source.publicYouTube,true);
  assert.ok(result.chapter.segments.map(s=>s.text).join(' ').includes(rows[1].text));
  assert.match(result.markdown,/watch\?v=kCc8FmEb1nY/);
});

test('Available local audio replaces corrupt automatic-caption numbers without losing source timing or navigation',async()=>{
  const corrupted=[{start:600,end:630,text:'The token limit is 5,256.'}];let checked=0;
  const sourceTools={captions:async()=>({segments:corrupted,isGenerated:true,origin:'YouTube automatic captions'}),video:async()=>({file:'internal.mp4',duration:1000}),probe:async()=>({duration:1000,hasAudio:true,hasVideo:true}),transcribe:async(file,window)=>{checked++;assert.equal(window.start,590);assert.equal(window.end,915);return {segments:[{start:600,end:630,text:'The bounds are zero through 50,256.'}],origin:'Local speech test'};}};
  const result=await runPipeline({url:'https://youtu.be/kCc8FmEb1nY',start:600,duration:300,visuals:false},{env:{},fetcher:offline,sourceTools});
  assert.equal(checked,1);assert.equal(result.source.transcriptionOrigin,'Local Whisper speech recognition');assert.match(result.chapter.segments[0].text,/50,256/);assert.equal(result.chapter.segments[0].start,600);assert.equal(result.chapterPlan.length,4);assert.equal(restoreChapter(result).chapterPlan.length,4);
  const fallback=await runPipeline({url:'https://youtu.be/kCc8FmEb1nY',start:600,duration:300,visuals:false},{env:{},fetcher:offline,sourceTools:{...sourceTools,transcribe:async()=>{throw new Error('Missing local speech weights');}}});
  assert.match(fallback.chapter.segments[0].text,/5,256/);assert.ok(fallback.generated.warnings.some(w=>w.includes('audio checking was unavailable')));
});

test('A manually flagged public caption track is checked against local audio too',async()=>{
  let checked=0;
  const sourceTools={captions:async()=>({segments:[{start:0,end:30,text:'Download note and yes code.'}],isGenerated:false,origin:'Public manual captions'}),video:async()=>({file:'internal.mp4',duration:1000}),probe:async()=>({duration:1000,hasAudio:true,hasVideo:true}),transcribe:async()=>{checked++;return {segments:[{start:0,end:30,text:'Download Node and VS Code.'}],origin:'Local speech test'};}};
  const result=await runPipeline({url:'https://youtu.be/W6NZfCO5SIk',duration:300,visuals:false},{env:{},fetcher:offline,sourceTools});
  assert.equal(checked,1);assert.equal(result.source.machineTranscript,true);assert.equal(result.source.transcriptionOrigin,'Local Whisper speech recognition');assert.match(result.chapter.segments[0].text,/Node and VS Code/);
  const fallback=await runPipeline({url:'https://youtu.be/W6NZfCO5SIk',duration:300,visuals:false},{env:{},fetcher:offline,sourceTools:{...sourceTools,transcribe:async()=>{throw new Error('Missing weights');}}});
  assert.equal(fallback.source.machineTranscript,true);assert.match(fallback.chapter.segments[0].text,/note and yes code/);assert.ok(fallback.generated.warnings.some(w=>/Unverified public YouTube captions/.test(w)));
});

test('Missing public captions fall back to local speech, keeping absolute timing and no fabricated video link',async()=>{
  const calls=[];
  const result=await runPipeline({sourceType:'media',mediaId:'recording',start:600,duration:300,visuals:false},{mediaInput:{id:'recording',path:'internal-recording.mp4',title:'My recording'},sourceTools:{
    probe:async file=>{assert.equal(file,'internal-recording.mp4');return {duration:1200,hasAudio:true,hasVideo:true};},
    transcribe:async(file,window)=>{calls.push(window);return {segments:rows.map(s=>({...s,start:s.start+600,end:s.end+600})),origin:'Local speech test'};}
  }});
  assert.equal(calls[0].start,600);assert.equal(calls[0].end,900);
  assert.equal(result.source.kind,'local-media');assert.equal(result.source.machineTranscript,true);
  assert.doesNotMatch(result.markdown,/watch\?v=/);assert.doesNotMatch(JSON.stringify(result),/internal-recording.mp4/);
  assert.equal(restoreChapter(result).source.synthetic,false);
});

test('Caption and video access failures report actual acquisition errors, without a creator-permission gate',async()=>{
  await assert.rejects(runPipeline({url:'https://youtu.be/kCc8FmEb1nY',duration:300},{env:{},fetcher:offline,sourceTools:{captions:async()=>{throw new SourceNeeded('Public caption request blocked.');},video:async()=>{throw new SourceNeeded('Public video request blocked.');}}}),error=>error instanceof SourceNeeded && /caption request blocked/.test(error.message) && /video request blocked/.test(error.message) && !/OAuth|permission|token/.test(error.message));
});

test('Missing video screens are disclosed even when public captions are available',async()=>{
  const result=await runPipeline({url:'https://youtu.be/kCc8FmEb1nY',duration:300},{env:{},fetcher:offline,sourceTools:{captions:async()=>({segments:rows,origin:'Test captions'}),video:async()=>{throw new SourceNeeded('Video unavailable.');}}});
  assert.equal(result.evidence.length,0);assert.ok(result.generated.warnings.some(w=>/cannot fulfill the visual/.test(w)));
});

test('Recording storage streams exact bytes, rejects traversal IDs and caps size before accepting a recording',async()=>{
  const directory=await temporary(),store=mediaStore(directory,{limit:20});
  const request=Readable.from([Buffer.from('recording-bytes')]);request.headers={'x-file-name':encodeURIComponent('../../My clip.mp4')};
  const saved=await store.upload(request),resolved=await store.resolve(saved.id);
  assert.equal(saved.title,'My clip.mp4');assert.equal(path.dirname(resolved.path),directory);
  assert.equal(await readFile(resolved.path,'utf8'),'recording-bytes');
  await assert.rejects(store.resolve('../../secret'),/filesystem paths/);
  const large=Readable.from(['too large']);large.headers={'x-file-name':'clip.mp4','content-length':'21'};await assert.rejects(store.upload(large),/1 GB/);
  const script=Readable.from(['alert(1)']);script.headers={'x-file-name':'clip.html'};await assert.rejects(store.upload(script),/Choose an MP4/);
});

test('HTTP recording uploads cannot inject a local path into a conversion',async()=>{
  const directory=await temporary();let received;
  const server=createApp({dataDir:directory,pipeline:async(input,options)=>{received=options.mediaInput;return {source:{title:'Uploaded'},generated:{},markdown:'Test result'};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetch(base+'/api/media',{method:'POST',headers:{'X-File-Name':'clip.mp4'},body:'media'});assert.equal(response.status,201);const saved=await response.json();
    const job=await (await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceType:'media',mediaId:saved.id,file:'C:/secret'})})).json();
    for(let i=0;i<50;i++){const data=await (await fetch(base+'/api/jobs/'+job.id)).json();if(data.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(await readFile(received.path,'utf8'),'media');assert.equal(received.path.includes('secret'),false);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Speech adapters reuse an identical local recording window without retranscribing it',async()=>{
  const directory=await temporary(),file=path.join(directory,'clip.wav');await writeFile(file,'fixture bytes');let calls=0;
  const adapters=createSourceTools({env:{ASR_MODEL:'base.en'},run:async request=>{calls++;assert.equal(request.action,'transcribe');assert.equal(request.file,file);return {segments:rows,origin:'Mock local speech'};}});
  await adapters.transcribe(file,{start:0,end:300});await adapters.transcribe(file,{start:0,end:300});assert.equal(calls,1);
});
