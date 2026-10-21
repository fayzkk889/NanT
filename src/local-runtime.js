import {spawn} from 'node:child_process';

// WSL services alone do not keep their distribution awake. An explicitly
// configured distribution gets an owned stdin reader for this app's life.
// Closing its input ends only that reader, never Ollama or other user work.
export function holdLocalRuntime({env=process.env,platform=process.platform,spawnImpl=spawn,onWarning=()=>{}}={}){
  const distro=env.OLLAMA_WSL_DISTRO;
  if(platform!=='win32' || !distro)return ()=>{};
  if(!/^[a-zA-Z0-9._-]{1,80}$/.test(distro)){onWarning('Invalid OLLAMA_WSL_DISTRO; local runtime was not started.');return ()=>{};}
  const child=spawnImpl('wsl.exe',['-d',distro,'--exec','sh','-c','cat >/dev/null'],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  child.once('error',()=>onWarning('Could not keep the configured model runtime awake. Start Ollama and retry.'));
  child.stdin?.on('error',()=>{});
  return ()=>child.stdin?.end();
}
