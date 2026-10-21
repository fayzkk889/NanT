import {EventEmitter} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import {holdLocalRuntime} from '../src/local-runtime.js';
test('An explicit WSL runtime stays awake only until its owned input closes',()=>{
 let calls=0,closed=0;
 const stop=holdLocalRuntime({platform:'win32',env:{OLLAMA_WSL_DISTRO:'Ubuntu'},spawnImpl:(executable,args,options)=>{
  calls++;assert.equal(executable,'wsl.exe');assert.deepEqual(args,['-d','Ubuntu','--exec','sh','-c','cat >/dev/null']);assert.equal(options.windowsHide,true);
  const child=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>closed++;return child;
 }});
 assert.equal(calls,1);assert.equal(closed,0);stop();assert.equal(closed,1);
 for(const config of [{platform:'linux',env:{OLLAMA_WSL_DISTRO:'Ubuntu'}},{platform:'win32',env:{}},{platform:'win32',env:{OLLAMA_WSL_DISTRO:'Ubuntu; unwanted'}}])holdLocalRuntime({...config,spawnImpl:()=>{throw new Error('Unexpected process');}})();
});
