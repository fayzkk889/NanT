import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';

test('HTTP app serves UI, completes a demo, exposes honest blocked/error states and protects local access', async () => {
  const server = createApp({ env: {}, fetcher: async () => { throw new Error('Offline'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(body, extraHeaders = {}) { return fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) }); }
  async function job(body) {
    const response = await post(body); assert.equal(response.status, 202); const { id } = await response.json();
    for (let tries = 0; tries < 100; tries++) {
      const data = await (await fetch(`${base}/api/jobs/${id}`)).json();
      if (data.status !== 'running') return data;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Job did not settle');
  }
  try {
    const home = await fetch(base); assert.equal(home.status, 200); assert.match(await home.text(), /From your screen/);
    assert.match(home.headers.get('Content-Security-Policy'), /object-src 'none'/);
    const appModule=await (await fetch(`${base}/app.js`)).text();
    for(const dependency of appModule.matchAll(/from\s+['"]([^'"]+)['"]/g)){
      const moduleURL=new URL(dependency[1],`${base}/app.js`);assert.equal(moduleURL.origin,base);
      const moduleResponse=await fetch(moduleURL);assert.equal(moduleResponse.status,200,`Browser module ${dependency[1]} must load`);assert.match(moduleResponse.headers.get('content-type'),/javascript/);
    }
    const health = await (await fetch(`${base}/api/health`)).json(); assert.equal(health.sourceProcessing, 'local'); assert.equal(health.sourceToolsConfigured,false);
    const demo = await job({ demo: true }); assert.equal(demo.status, 'ready'); assert.equal(demo.stages.length, 6); assert.match(demo.result.markdown, /ORIGINAL TEST FIXTURE/);
    const pdf = await fetch(`${base}/api/jobs/${demo.id}/pdf?style=companion`); assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    assert.equal((await fetch(`${base}/api/jobs/${demo.id}/pdf?style=wrong`)).status, 400);
    const savedSample = await job({ demo: true, sample: true }); assert.equal(savedSample.status, 'ready'); assert.equal(savedSample.result.generated.provider, 'local'); assert.equal(savedSample.result.generated.cached, true);
    const blocked = await job({ url: 'https://youtu.be/kCc8FmEb1nY', rightsConfirmed: true }); assert.equal(blocked.status, 'needs_input'); assert.equal(blocked.stage, 'transcript'); assert.match(blocked.message, /Captions are needed/);
    const invalid = await job({ url: 'https://evil.test', rightsConfirmed: true }); assert.equal(invalid.status, 'failed'); assert.match(invalid.message, /YouTube/);
    const badTranscript = await job({ url: 'https://youtu.be/kCc8FmEb1nY', rightsConfirmed: true, transcript: 'broken text' }); assert.equal(badTranscript.status, 'failed');
    assert.equal((await post({ demo: true }, { Origin: 'https://evil.test' })).status, 403);
    const invalidHostStatus = await new Promise((resolve, reject) => {
      const req = http.get(base, { headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
    });
    assert.equal(invalidHostStatus, 403);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/api/jobs/unknown`)).status, 404);
    const malformed = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.equal(malformed.status, 400);
    assert.equal((await post(null)).status, 400);
    const tooBig = await post({ huge: 'x'.repeat(6_000_000) }); assert.equal(tooBig.status, 413);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Local queue bounds model spending and job retention', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const server = createApp({ env: {}, pipeline: async () => { await waiting; return { markdown: 'done' }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/jobs`;
  const post = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"demo":true,"force":true}' });
  try { assert.equal((await post()).status, 202); assert.equal((await post()).status, 202); assert.equal((await post()).status, 429); }
  finally { release(); await new Promise(resolve => server.close(resolve)); }
});

test('Changing local speech or writing models cannot reuse a stale completed conversion',async()=>{
 const env={ASR_MODEL:'base.en',OLLAMA_MODEL:'first-local'},server=createApp({env,pipeline:async()=>({markdown:'done',generated:{mode:'model'}})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const submit=async()=>{const response=await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://youtu.be/W6NZfCO5SIk',useModel:true})});assert.equal(response.status,202);const job=await response.json();for(let i=0;i<50;i++){const saved=await (await fetch(base+'/api/jobs/'+job.id)).json();if(saved.status==='ready')return job;await new Promise(r=>setTimeout(r,10));}throw new Error('Job did not settle');};
 try{const first=await submit();assert.equal((await submit()).id,first.id);env.ASR_MODEL='small.en';const second=await submit();assert.notEqual(second.id,first.id);env.OLLAMA_MODEL='second-local';assert.notEqual((await submit()).id,second.id);}finally{await new Promise(resolve=>server.close(resolve));}
});
