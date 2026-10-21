import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {InputError,assert} from './errors.js';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXTENSIONS=new Set(['.mp4','.mkv','.mov','.webm','.mp3','.m4a','.wav','.ogg','.flac']);
export function mediaStore(directory,{limit=1_000_000_000}={}) {
  return {
    async upload(request) {
      assert(directory,'Local recording storage is unavailable in this server configuration.');
      let name;try{name=decodeURIComponent(request.headers['x-file-name'] || '');}catch{throw new InputError('Use a valid media filename.');}
      name=path.basename(name.replace(/\\/g,'/')).slice(0,200);
      const extension=path.extname(name).toLowerCase();
      assert(EXTENSIONS.has(extension),'Choose an MP4, MKV, MOV, WebM, MP3, M4A, WAV, OGG or FLAC recording.');
      if(Number(request.headers['content-length'])>limit)throw new InputError('Recording exceeds the 1 GB upload limit.',413);
      await mkdir(directory,{recursive:true});
      const id=randomUUID(),file=path.join(directory,id+extension);let size=0;
      try {
        await pipeline(request,new Transform({transform(chunk,_encoding,done){size+=chunk.length;if(size>limit)return done(new InputError('Recording exceeds the 1 GB upload limit.',413));done(null,chunk);}}),createWriteStream(file,{flags:'wx'}));
        assert(size>0,'The recording is empty.');
        const metadata={id,extension,title:name,bytes:size};
        await writeFile(path.join(directory,id+'.json'),JSON.stringify(metadata),{flag:'wx'});
        return metadata;
      }catch(error){await unlink(file).catch(()=>{});throw error;}
    },
    async resolve(id) {
      assert(directory && typeof id==='string' && ID.test(id),'Choose an uploaded recording. Local filesystem paths are not accepted.');
      let saved;try{saved=JSON.parse(await readFile(path.join(directory,id+'.json'),'utf8'));}catch{throw new InputError('This recording is unavailable. Upload it again.',404);}
      assert(saved.id===id && EXTENSIONS.has(saved.extension),'The stored recording metadata is invalid.');
      return {...saved,path:path.join(directory,id+saved.extension)};
    }
  };
}
