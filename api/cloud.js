import {extractVideo,writeCloudPart,cloudProviders} from '../src/cloud-model.js';
import {reserveCloudRequest,quotaConfigured,dailyLimits} from '../src/cloud-quota.js';
import {assembleCloudCourse} from '../src/cloud-course.js';
import {parseYouTubeURL} from '../src/youtube.js';
import {parseTranscript,selectChapter} from '../src/transcript.js';
import {validateDraft} from '../src/generation.js';
import {restoreChapter} from '../src/restore.js';
import {createChapterPDF} from '../src/pdf.js';
import {readFile} from 'node:fs/promises';
import {createCloudCapacity} from '../src/cloud-capacity.js';
import {SOURCE_PART_SECONDS} from '../public/source-policy.js';

const MAX_BODY=1_500_000;
async function bodyJSON(req){
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Object.assign(new Error('Send a JSON request.'),{status:415});
  let body=req.body;
  if(body==null){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw Object.assign(new Error('Use a source bundle under 1.5 MB on the online app.'),{status:413});chunks.push(chunk);}body=Buffer.concat(chunks).toString();}
  if(typeof body==='string'||Buffer.isBuffer(body)){if(Buffer.byteLength(body)>MAX_BODY)throw Object.assign(new Error('This chapter is too large for the online app.'),{status:413});try{body=JSON.parse(body);}catch{throw Object.assign(new Error('The request JSON could not be read.'),{status:400});}}
  if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>MAX_BODY)throw Object.assign(new Error('Supply a chapter request under 1.5 MB.'),{status:400});return body;
}
export function createCloudHandler({env=process.env,fetcher=fetch,reserve=reserveCloudRequest,capacity}={}){
  const sharedCapacity=capacity??(quotaConfigured(env)?createCloudCapacity({env,fetcher}):null);
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
    try{
      if(req.method==='GET'){const providers=cloudProviders(env),quota=quotaConfigured(env);return send(200,{mode:'hosted',ready:providers.writer&&quota,video:providers.video&&quota,transcript:providers.writer&&quota,connections:{gemini:providers.video,openrouter:Boolean(env.OPENROUTER_API_KEY)},limits:dailyLimits(env),message:providers.writer&&quota?'Free shared connection. No account or API key needed.':'Free conversion is being connected. Explore the working sample and PDF exports.'});}
      if(req.method!=='POST')return send(405,{error:'Use GET or POST.'});
      const origin=req.headers.origin;if(origin){let originHost;try{originHost=new URL(origin).host;}catch{}if(originHost!==req.headers.host)return send(403,{error:'Open NanT directly to start a conversion.'});}
      const input=await bodyJSON(req);
      if(input.action==='sample'){const sample=JSON.parse(await readFile(new URL('../examples/local-lesson.evidence.json',import.meta.url),'utf8'));return send(200,restoreChapter(sample));}
      if(input.action==='pdf'){
        const result=restoreChapter(input.result),bytes=await createChapterPDF(result,input.style||'textbook',{edition:input.edition||'lesson',timestamps:input.timestamps===true});
        res.statusCode=200;res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="nant-lesson.pdf"');return res.end(Buffer.from(bytes));
      }
      if(input.action==='restore')return send(200,restoreChapter(input.result));
      if(input.action==='transcript'){
        const segments=parseTranscript(input.transcript),start=Number(input.start),duration=Number(input.duration);
        if(!Number.isFinite(start)||start<0||![300,480,600].includes(duration)||start+duration>86400)throw Object.assign(new Error('Choose a valid 5–10-minute chapter window.'),{status:400});
        return send(200,{segments:selectChapter(segments,start,duration).segments});
      }
      if(input.action==='finalize')return send(200,assembleCloudCourse(input));
      if(!['extract','write'].includes(input.action))return send(400,{error:'Unknown conversion step.'});
      if(input.action==='extract'){parseYouTubeURL(input.url);if(!Number.isFinite(input.start)||!Number.isFinite(input.end)||input.start<0||input.end<=input.start||input.end-input.start>SOURCE_PART_SECONDS||input.end>86400)return send(400,{error:'Refresh NanT to read video in parts of at most 30 seconds.'});if(!cloudProviders(env).video)return send(503,{error:'YouTube conversion is being connected. The sample and exports work now.'});}
      if(input.action==='write'){
        if(!cloudProviders(env).writer)return send(503,{error:'The free writing connection is being connected. Try the sample.'});
        if(!Array.isArray(input.segments)||!input.segments.length||input.segments.length>150||JSON.stringify({segments:input.segments,evidence:input.evidence}).length>90000)return send(400,{error:'Supply one bounded source part.'});
      }
      const ip=req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.socket?.remoteAddress||'unknown';let usage;
      const options={env,fetcher,signal:AbortSignal.timeout(210000),capacity:sharedCapacity,beforeAttempt:async()=>{usage=await reserve(ip,{env,fetcher});}};
      if(input.action==='extract'){
        const link=parseYouTubeURL(input.url),saved=await sharedCapacity?.source(link.url,input.start,input.end);
        if(saved)return send(200,{part:saved,reused:true});
        const part=await extractVideo(link.url,input.start,input.end,options);
        // A cache write failure must not discard a completed provider response.
        try{await sharedCapacity?.saveSource(link.url,input.start,input.end,part);}catch{}
        return send(200,{part,usage,reused:false});
      }
      return send(200,{writing:await writeCloudPart(input.segments,input.evidence||[],options),usage});
    }catch(error){const status=error.status||error.statusCode||500;if(error.retryAfter)res.setHeader('Retry-After',String(error.retryAfter));return send(status,{error:status>=500&&!error.status?'This step could not finish. Your completed steps are saved; try again later.':error.message});}
  };
}
export default createCloudHandler();
