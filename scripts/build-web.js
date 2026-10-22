import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'dist');
// Explicit public allowlist: never copy .env, local jobs, recordings or model files.
const files=['index.html','style.css','brand.css','logo.svg','boot.js','cloud-app.js','cloud-course.js','markdown-view.js','course-bundle.js'];
await mkdir(out,{recursive:true});
for(const file of files)await copyFile(resolve(root,'public',file),resolve(out,file));
const index=await readFile(resolve(out,'index.html'),'utf8');await writeFile(resolve(out,'index.html'),index.replace('data-runtime="local"','data-runtime="hosted"'));
await mkdir(resolve(out,'fonts'),{recursive:true});
for(const file of ['DejaVuSans.ttf','SourceCodePro-Regular.ttf','DejaVu-LICENSE.txt','SourceCodePro-LICENSE.md'])await copyFile(resolve(root,'assets/fonts',file),resolve(out,'fonts',file));
await mkdir(resolve(out,'samples'),{recursive:true});
await copyFile(resolve(root,'examples/local-lesson.evidence.json'),resolve(out,'samples/tokenizer.json'));
console.log('Built NanT public web app. Private source data and settings excluded.');
