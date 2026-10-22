export function cancellableDelay(ms,signal){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason);return;}
    const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};
    const timer=setTimeout(finish,ms);
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
    signal?.addEventListener('abort',abort,{once:true});
  });
}
// Only short, explicitly timed throttle responses are retried. Daily/provider
// exhaustion remains an honest stop; completed source parts remain saved.
export async function cloudRequest(action,body={}, {fetcher=fetch,signal,onPause=()=>{},wait=cancellableDelay}={}){
  for(let attempt=0;attempt<3;attempt++){
    signal?.throwIfAborted();
    const response=await fetcher('/api/cloud',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body}),signal});
    if(response.ok)return action==='pdf'?response.arrayBuffer():response.json();
    const data=await response.json().catch(()=>({})),retry=Number(response.headers.get('Retry-After'));
    if([429,503].includes(response.status)&&retry>0&&retry<=120&&attempt<2){onPause(retry);await wait(retry*1000,signal);continue;}
    throw new Error(data.error||'This step could not finish. Try again in a moment.');
  }
}
