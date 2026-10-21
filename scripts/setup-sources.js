import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const python=process.env.PYTHON || 'python';
const version=spawnSync(python,['-c','import sys; print("%d.%d" % sys.version_info[:2])'],{encoding:'utf8',windowsHide:true});
if(version.error || version.status!==0 || version.stdout.trim()!=='3.12'){console.error('The tested source-tool bundle requires Python 3.12. Set PYTHON to its executable, then rerun setup:sources.');process.exit(1);}
await mkdir(path.join(root,'.tools'),{recursive:true});
const install=spawnSync(python,['-m','pip','install','--target',path.join(root,'.tools/source-python'),'-r',path.join(root,'requirements-source-lock.txt')],{stdio:'inherit',windowsHide:true});
if(install.error || install.status!==0) {console.error('Source setup needs Python 3.12 with pip. Set PYTHON to its executable.');process.exit(1);}
const model=spawnSync(python,['-X','utf8',path.join(root,'scripts/source_worker.py')],{input:JSON.stringify({action:'setup-model',model:process.env.ASR_MODEL || 'small.en'}),encoding:'utf8',windowsHide:true});
process.stdout.write(model.stdout || '');process.stderr.write(model.stderr || '');
if(model.error || model.status!==0) process.exit(1);
await writeFile(path.join(root,'.tools/python-path.txt'),python);
console.log('Public source tools and the local speech model are ready. Model weights stay in .tools/models.');
