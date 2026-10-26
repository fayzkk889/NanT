import {pacificResetSeconds} from './cloud-capacity.js';

export const GEMINI_FREE_MODELS=['gemini-3.8-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-2.5-flash','gemini-2.5-flash-lite'];
export function freeRoutes(env,role){
  const routes=[];
  if(env.GEMINI_API_KEY&&env.GEMINI_FREE_TIER_CONFIRMED==='true'){
    const models=role==='video'?[env.GEMINI_MODEL||'gemini-3.6-flash',...(env.GEMINI_VIDEO_FALLBACK_MODELS??'gemini-3.5-flash-lite,gemini-3.8-flash').split(',').map(s=>s.trim()).filter(Boolean)]:[env.GEMINI_WRITER_MODEL||'gemini-3.5-flash-lite'];
    if(models.some(model=>!GEMINI_FREE_MODELS.includes(model)))throw Object.assign(new Error('The selected model is not on NanT’s free-tier allowlist.'),{status:503});
    for(const model of new Set(models))routes.push({provider:'gemini',model});
  }
  // Text routing cannot stand in for a verified clipped YouTube source reader.
  if(role==='writer'&&env.OPENROUTER_API_KEY)routes.push({provider:'openrouter',model:'openrouter/free'});
  return routes;
}

export function providerError(status,data={},retryHeader,provider='gemini',now=new Date()){
  if(status===400)return Object.assign(new Error('The model could not accept this source or writing batch. Your completed source is saved.'),{status:502,providerStatus:400,invalidOutput:true});
  const details=JSON.stringify(data).slice(0,16000),daily=/per.?day|daily|\bRPD\b/i.test(details),retryInfo=details.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  const delay=Number(retryHeader)||Number(retryInfo?.[1])||60;
  const dailyReset=provider==='openrouter'?Math.max(1,Math.ceil((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)-now.getTime())/1000)):pacificResetSeconds(now);
  const retryAfter=status===429?(daily?dailyReset:Math.min(120,Math.max(15,delay))):status===503?15:60;
  const messages={429:'The free providers are at capacity. Your completed steps are saved. Resume when capacity returns.',402:'The free provider is unavailable. No paid model was selected.',401:'The free connection needs attention.',403:'The free connection needs attention.',404:'This free model is unavailable to the account.',503:'The free model is busy. Your completed steps are saved.'};
  return Object.assign(new Error(messages[status]||'The free provider could not be reached. Your completed steps are saved.'),{status:status===429||status===402?429:503,providerFailure:[401,402,403,404,408,429,500,502,503,504].includes(status),providerStatus:status,retryAfter,capacityExhausted:true});
}

export async function withFreeFallback(role,request,{env,signal,capacity,beforeAttempt=async()=>{}}){
  const routes=freeRoutes(env,role);let soonest=Infinity;const blockedProviders=new Set();
  for(const route of routes){
    signal?.throwIfAborted();if(blockedProviders.has(route.provider))continue;
    if(capacity){const remaining=await capacity.cooldown(route);if(remaining>0){soonest=Math.min(soonest,remaining);continue;}}
    // Count each real provider attempt. Cache hits and known exhausted routes
    // never consume the application's shared request allowance.
    await beforeAttempt(route);
    try{return {data:await request(route),route};}
    catch(error){
      signal?.throwIfAborted();if(!error.providerFailure)throw error;
      soonest=Math.min(soonest,error.retryAfter||60);
      if([401,403].includes(error.providerStatus))blockedProviders.add(route.provider);
      if(capacity)await capacity.pause(route,error.retryAfter||60);
    }
  }
  throw Object.assign(new Error(routes.length?(role==='video'?'Video reading is temporarily at capacity on the connected free providers. Your progress is saved. Resume later, or import a timestamped transcript and code records.':'The free writing providers are at capacity.'):'The free model connection is not configured.'),{status:routes.length?429:503,capacityExhausted:true,retryAfter:Number.isFinite(soonest)?soonest:60});
}
