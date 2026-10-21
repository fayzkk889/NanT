import {spawnSync} from 'node:child_process';
import {mkdir,copyFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url));
const directory = path.join(root,'.tools');
const python = process.env.PYTHON || 'python';
await mkdir(directory,{recursive:true});
const installed = spawnSync(python,['-m','pip','install','--target',path.join(directory,'python'),'imageio-ffmpeg==0.6.0'],{stdio:'inherit',windowsHide:true});
if (installed.error || installed.status !== 0) { console.error('Media setup needs Python with pip. Set PYTHON to its executable, or install FFmpeg yourself and set FFMPEG_PATH.'); process.exit(1); }
const binaries = path.join(directory,'python/imageio_ffmpeg/binaries');
const name = (await readdir(binaries)).find(n=>n.startsWith('ffmpeg-') && (process.platform !== 'win32' || n.endsWith('.exe')));
if (!name) throw new Error('No matching FFmpeg binary was installed.');
const destination = path.join(directory,process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
await copyFile(path.join(binaries,name),destination);
console.log(`FFmpeg installed at ${destination}. Set FFMPEG_PATH to this file on non-Windows systems.`);
