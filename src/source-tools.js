import {spawn, execFile} from 'node:child_process';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {SourceNeeded} from './errors.js';
import {normalizeSpeechTiming} from './speech-timing.js';
const ROOT=fileURLToPath(new URL('../',import.meta.url));

export async function runSourceWorker(request,{env=process.env,signal,onProgress=()=>{},timeout=120000}={}) {
  signal?.throwIfAborted();
  const bundled=path.join(ROOT,'.tools/python-path.txt');
  const python=env.PYTHON || await readFile(bundled,'utf8').then(s=>s.trim()).catch(()=>'python');
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-X','utf8',path.join(ROOT,'scripts/source_worker.py')],{windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...process.env,...env,HF_HUB_DISABLE_TELEMETRY:'1'}});
    let output='',diagnostics='',settled=false;
    const stop=()=>{if(child.pid) {if(process.platform==='win32') execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{}); else try{process.kill(-child.pid,'SIGTERM');}catch{/* Process already stopped. */}}};
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{stop();finish(signal.reason || new Error('Source processing stopped'));};
    const timer=setTimeout(()=>{stop();finish(new SourceNeeded('The local source operation timed out. Retry or import the recording directly.'));},timeout);
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',()=>finish(new SourceNeeded('Local source tools are unavailable. Run npm run setup:sources with Python installed.')));
    child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>4_000_000){stop();finish(new SourceNeeded('Source output exceeds the 4 MB local adapter limit.'));}});
    child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-10000);let newline;while((newline=diagnostics.indexOf('\n'))>=0){const line=diagnostics.slice(0,newline);diagnostics=diagnostics.slice(newline+1);try{const progress=JSON.parse(line);if(typeof progress.message==='string')onProgress({message:progress.message.slice(0,300)});}catch{/* Library diagnostics are not application instructions. */}}});
    child.on('close',()=>{try{const data=JSON.parse(output);if(data.error)finish(new SourceNeeded(data.error.message));else if(data.result)finish(null,data.result);else finish(new SourceNeeded('Local source tools returned an incomplete response.'));}catch{finish(new SourceNeeded('Local source tools did not return a valid response. Check their installation.'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
  });
}

export function createSourceTools({env=process.env,run=runSourceWorker}={}) {
  const invoke=(request,options)=>run(request,{env,...options});
  return {
    async captions(id,options={}) {
      if(!/^[\w-]{11}$/.test(id))throw new SourceNeeded('Use a valid YouTube video ID.');
      const cache=path.join(ROOT,'.local-data/captions',id+'.json');
      try{const saved=JSON.parse(await readFile(cache,'utf8'));if(Date.now()-saved.fetchedAt<86400000 && Array.isArray(saved.result?.segments) && saved.result.segments.length)return {...saved.result,origin:saved.result.origin+' Cached on this device.'};}catch{/* Fetch public captions normally when no fresh cache is available. */}
      const result=await invoke({action:'captions',id},{...options,timeout:90000});
      await mkdir(path.dirname(cache),{recursive:true});await writeFile(cache,JSON.stringify({fetchedAt:Date.now(),result}));return result;
    },
    video:(id,options={})=>invoke({action:'video',id,node:process.execPath,ffmpeg:env.FFMPEG_PATH || path.join(ROOT,'.tools',process.platform==='win32'?'ffmpeg.exe':'ffmpeg')},{...options,timeout:1200000}),
    probe:(file,options={})=>invoke({action:'probe',file},{...options,timeout:30000}),
    readFrames:(frames,options={})=>invoke({action:'ocr',files:frames.map(f=>f.localFramePath)},{...options,timeout:600000}),
    async transcribe(file,{start,end,signal,onProgress}={}) {
      const model=env.ASR_MODEL || 'small.en';
      const stat=await import('node:fs/promises').then(fs=>fs.stat(file));
      const key=createHash('sha256').update(`${file}:${stat.size}:${stat.mtimeMs}:${start}:${end}:${model}:asr-v2-programming`).digest('hex');
      const cache=path.join(ROOT,'.local-data/speech',key+'.json');
      try{return normalizeSpeechTiming(JSON.parse(await readFile(cache,'utf8')),{start,end});}catch{/* Retry invalid or absent local speech caches normally. */}
      const result=await invoke({action:'transcribe',file,start,end,model,ffmpeg:env.FFMPEG_PATH || path.join(ROOT,'.tools',process.platform==='win32'?'ffmpeg.exe':'ffmpeg')},{signal,onProgress,timeout:1800000});
      await mkdir(path.dirname(cache),{recursive:true});await writeFile(cache,JSON.stringify(result));return normalizeSpeechTiming(result,{start,end});
    }
  };
}
