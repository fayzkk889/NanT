import {createHash} from 'node:crypto';
import {SOURCE_REVISION} from '../public/source-policy.js';

// Reuse only machine-read public YouTube source. Never cache supplied transcripts,
// private notes or credentials. State survives separate serverless instances.
export function createCloudCapacity({env,fetcher=fetch,now=()=>Date.now()}){
  async function command(args){
    const url=new URL(env.UPSTASH_REDIS_REST_URL);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.upstash.io'))throw new Error('Invalid capacity store');
    const response=await fetcher(url,{method:'POST',headers:{Authorization:`Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('Capacity store unavailable');
    const data=await response.json();if(data.error)throw new Error('Capacity store unavailable');return data.result;
  }
  const routeKey=route=>`nant:cooldown:v1:${route.provider}:${route.model}`;
  const sourceKey=(url,start,end)=>`nant:source:${SOURCE_REVISION}:${createHash('sha256').update(JSON.stringify([url,start,end])).digest('hex')}`;
  return {
    async cooldown(route){const until=Number(await command(['GET',routeKey(route)]));return Math.max(0,Math.ceil((until-now())/1000));},
    async pause(route,seconds){const ttl=Math.max(1,Math.ceil(seconds));await command(['SET',routeKey(route),String(now()+ttl*1000),'EX',String(ttl)]);},
    async source(url,start,end){const value=await command(['GET',sourceKey(url,start,end)]);if(!value)return null;try{const data=JSON.parse(value);return data.start===start&&data.end===end&&Array.isArray(data.segments)&&data.segments.length&&Array.isArray(data.evidence)?data:null;}catch{return null;}},
    async saveSource(url,start,end,part){const value=JSON.stringify(part);if(value.length<=150000)await command(['SET',sourceKey(url,start,end),value,'EX','86400']);}
  };
}

export function pacificResetSeconds(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(now);
  const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));const midnight=Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day)+1);
  let reset=midnight+8*3600000;
  for(let i=0;i<2;i++){const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'shortOffset'}).formatToParts(new Date(reset)).find(p=>p.type==='timeZoneName').value;const match=offset.match(/GMT([+-])(\d+)(?::(\d+))?/);const hours=match?(match[1]==='-'?-1:1)*(Number(match[2])+Number(match[3]||0)/60):0;reset=midnight-hours*3600000;}
  return Math.max(1,Math.ceil((reset-now.getTime())/1000));
}
