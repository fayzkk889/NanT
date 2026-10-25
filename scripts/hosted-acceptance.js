import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {parseYouTubeURL} from '../src/youtube.js';
import {chapterParts,writingBatches,applyWritingBatch} from '../public/cloud-course.js';
import {cloudRequest} from '../public/cloud-request.js';

// Manual real-provider check; never part of npm test or CI. Calls use the public
// API, its shared counters and its normal free-only routing. No keys are needed.
const {values}=parseArgs({options:{url:{type:'string'},start:{type:'string',default:'0'},duration:{type:'string',default:'300'},endpoint:{type:'string',default:'https://nant-sepia.vercel.app'}}});
if(!values.url)throw new Error('Supply --url YOUTUBE_URL; this test consumes shared provider capacity.');
const source=parseYouTubeURL(values.url),start=Number(values.start),duration=Number(values.duration),endpoint=new URL('/api/cloud',values.endpoint);
if(!Number.isFinite(start)||start<0||![300,480,600].includes(duration))throw new Error('Use a nonnegative start in seconds and a 300/480/600-second duration.');
if(endpoint.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(endpoint.hostname))throw new Error('Use HTTPS for a remote service.');
const directory=resolve('.local-data/hosted-acceptance');await mkdir(directory,{recursive:true});
const file=resolve(directory,`${source.id}-${start}-${duration}.json`),pdfFile=file.replace(/\.json$/,'.pdf');
let state={input:{url:source.url,start,duration},parts:[]};try{state=JSON.parse(await readFile(file,'utf8'));}catch{}
const signal=AbortSignal.timeout(15*60*1000),save=()=>writeFile(file,JSON.stringify(state,null,2));
const call=(action,body)=>cloudRequest(action,body,{signal,fetcher:(_url,options)=>fetch(endpoint,options),onPause:seconds=>console.log(JSON.stringify({waitingSeconds:seconds,checkpointSaved:true}))});
try{
  const windows=chapterParts(start,duration);
  for(let i=0;i<windows.length;i++){
    if(state.parts[i])continue;
    const response=await call('extract',{url:source.url,...windows[i]});const part=response.part,offset=state.parts.reduce((n,p)=>n+p.segments.length,0);
    part.segments=part.segments.map((s,index)=>({...s,id:`s${String(offset+index+1).padStart(5,'0')}`}));state.parts[i]=part;await save();
    console.log(JSON.stringify({sourcePart:i+1,total:windows.length,reused:response.reused===true,provider:part.provider,model:part.model,passages:part.segments.length,visuals:part.evidence.length}));
  }
  // Verify the shared reuse path actually serves the exact same public window.
  const reused=await call('extract',{url:source.url,...windows[0]});if(!reused.reused)throw new Error('Source reuse check failed');
  if(JSON.stringify(reused.part.segments.map(s=>s.text))!==JSON.stringify(state.parts[0].segments.map(s=>s.text)))throw new Error('Cached source changed');
  for(const indices of writingBatches(state.parts)){
    const parts=indices.map(i=>state.parts[i]);const {writing}=await call('write',{segments:parts.flatMap(p=>p.segments),evidence:parts.flatMap(p=>p.evidence)});
    applyWritingBatch(state.parts,indices,writing);await save();console.log(JSON.stringify({writingProvider:writing.provider,retained:writing.retained.length}));
  }
  state.result=await call('finalize',{...state.input,parts:state.parts});delete state.lastError;await save();
  const expected=state.parts.reduce((n,p)=>n+p.segments.length,0);if(state.result.report.segmentCoverage.covered!==expected)throw new Error('Acquired passage coverage check failed');
  const bytes=Buffer.from(await call('pdf',{result:state.result,style:'textbook',edition:'lesson'}));if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('Invalid PDF');await writeFile(pdfFile,bytes);
  console.log(JSON.stringify({completed:true,acquiredPassages:expected,visuals:state.result.evidence.length,sourceRecovery:state.result.generated.sourceFallbackSegments.length,pdfBytes:bytes.length,pdfFile,semanticAccuracy:'not_measured'}));
}catch(error){state.lastError=error.message;await save();console.error(JSON.stringify({completed:false,error:error.message,checkpoint:file}));process.exitCode=1;}
