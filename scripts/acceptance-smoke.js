import { readFile,writeFile,mkdir } from 'node:fs/promises';
const base = 'http://127.0.0.1:4317';
async function convert(input) {
  const response = await fetch(`${base}/api/jobs`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...input, force:true})});
  const started = await response.json();
  if (!response.ok) throw new Error(started.error);
  const queuedAt=Date.now();let workStartedAt=null;
  let lastProgress=0;
  while (Date.now()-(workStartedAt || queuedAt)<(workStartedAt?1_800_000:3_600_000)) {
    const job = await (await fetch(`${base}/api/jobs/${started.id}?progress=1`)).json();
    if (job.status !== 'running') return job;
    if(!workStartedAt && job.stage!=='queued')workStartedAt=Date.now();
    if(Date.now()-lastProgress>30000){lastProgress=Date.now();console.log(JSON.stringify({title:input.url,progress:job.progress?.message || job.stage}));}
    await new Promise(resolve => setTimeout(resolve,1000));
  }
  await fetch(`${base}/api/jobs/${started.id}/cancel`,{method:'POST'});
  throw new Error(workStartedAt?'Acceptance conversion exceeded thirty processing minutes and was stopped.':'Acceptance request exceeded one hour waiting in the local queue and was stopped.');
}
let failed = false;
const results=[];
for (const [title,url] of [
  ['Mosh JavaScript','https://www.youtube.com/watch?v=W6NZfCO5SIk'],
  ['freeCodeCamp Python','https://www.youtube.com/watch?v=eWRfhZUzrAc'],
  ['Mosh ES6','https://www.youtube.com/watch?v=NCwa_xi0Uuc']
]) {
  let job;try{job=await convert({url, provider:'local', useModel:true, duration:300});}catch(error){job={status:'failed',message:error.message};}
  const total=job.result?.chapter.segments.length || 0,retained=job.result?.generated.sourceFallbackSegments?.length || 0;
  const pipelineCompleted=job.status==='ready' && Boolean(job.result);
  const passed = pipelineCompleted && job.result.generated.mode === 'model' && !job.result.generated.generationFailed && job.result.evidence.length>0 && retained/total<=.2;
  failed ||= !passed;
  const result={title,url,structuralPassed:passed,pipelineCompleted,acceptanceStatus:passed?'needs_semantic_review':'failed',acceptanceRule:'Model-written chapter with captured screens and at least 80% accepted model passages; semantic review still required',status:job.status,reason:job.message || '',jobId:job.id,model:job.result?.generated.model,frames:job.result?.evidence?.length,coverage:job.result?.report.segmentCoverage,sourceRetained:retained,writtenPassages:total-retained,semanticFidelity:'Requires manual review'};
  results.push(result);console.log(JSON.stringify(result));
  await mkdir(new URL('../.local-data/',import.meta.url),{recursive:true});await writeFile(new URL('../.local-data/acceptance-result.json',import.meta.url),JSON.stringify({createdAt:new Date().toISOString(),results},null,2));
}
if (process.argv.includes('--local')) {
  const fixture = JSON.parse(await readFile(new URL('../test/fixtures/oral-sorting.json',import.meta.url)));
  const job = await convert(fixture);
  const passed = job.status === 'ready' && job.result?.generated?.mode === 'model';
  failed ||= !passed;
  console.log(JSON.stringify({title:'Original spoken-style fixture (not a real course)',passed,status:job.status,report:job.result?.report}));
}
process.exitCode = failed ? 1 : 0;
await mkdir(new URL('../.local-data/',import.meta.url),{recursive:true});await writeFile(new URL('../.local-data/acceptance-result.json',import.meta.url),JSON.stringify({createdAt:new Date().toISOString(),results},null,2));
