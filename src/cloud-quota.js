import {createHmac} from 'node:crypto';

export function quotaConfigured(env){return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);}
export function dailyLimits(env){return {global:bounded(env.CLOUD_DAILY_REQUESTS,80,1,500),visitor:bounded(env.CLOUD_VISITOR_DAILY_REQUESTS,20,1,100)};}
function bounded(value,fallback,min,max){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
const reserveScript=`
local global=tonumber(redis.call('GET',KEYS[1]) or '0')
local visitor=tonumber(redis.call('GET',KEYS[2]) or '0')
local minute=tonumber(redis.call('GET',KEYS[3]) or '0')
if global>=tonumber(ARGV[1]) then return {'global',global,visitor} end
if visitor>=tonumber(ARGV[2]) then return {'visitor',global,visitor} end
if minute>=6 then return {'minute',global,visitor} end
for i=1,3 do redis.call('INCR',KEYS[i]); redis.call('EXPIRE',KEYS[i],i==3 and 120 or 172800) end
return {'ok',global+1,visitor+1}`;

// Atomic persistent counters are mandatory for shared public keys. No in-memory fallback.
export async function reserveCloudRequest(ip,{env=process.env,fetcher=fetch,now=new Date()}={}){
  if(!quotaConfigured(env))throw Object.assign(new Error('Free conversions are being connected. The sample and exports still work.'),{status:503});
  const url=new URL(env.UPSTASH_REDIS_REST_URL);
  if(url.protocol!=='https:' || !url.hostname.endsWith('.upstash.io'))throw Object.assign(new Error('The daily allowance service is unavailable.'),{status:503});
  const visitor=createHmac('sha256',env.UPSTASH_REDIS_REST_TOKEN).update(String(ip)).digest('hex').slice(0,24),date=now.toISOString().slice(0,10),minute=Math.floor(now.getTime()/60000),limits=dailyLimits(env);
  const response=await fetcher(url,{method:'POST',headers:{Authorization:`Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(['EVAL',reserveScript,'3',`nant:day:${date}`,`nant:visitor:${date}:${visitor}`,`nant:minute:${minute}:${visitor}`,String(limits.global),String(limits.visitor)]),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Object.assign(new Error('Could not check the free allowance. Please try again later.'),{status:503});
  const data=await response.json();if(!Array.isArray(data.result))throw Object.assign(new Error('The daily allowance service is unavailable.'),{status:503});
  const [status,global,used]=data.result;
  if(status!=='ok')throw Object.assign(new Error(status==='global'?"Today’s shared free allowance is used up. Your saved chapters and exports still work. Come back after 00:00 UTC.":status==='minute'?'A quick breather: please wait a minute before continuing. Your completed steps are saved.':'You’ve used today’s free allowance on this connection. Continue tomorrow after 00:00 UTC; your completed steps are saved.'),{status:429,retryAfter:status==='minute'?60:Math.ceil((Date.parse(date+'T00:00:00Z')+86400000-now.getTime())/1000)});
  return {sharedRemaining:Math.max(0,limits.global-Number(global)),visitorRemaining:Math.max(0,limits.visitor-Number(used)),resets:'00:00 UTC'};
}
