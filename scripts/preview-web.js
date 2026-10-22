import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import handler from '../api/cloud.js';
const root=resolve(import.meta.dirname,'../dist'),port=Number(process.env.PREVIEW_PORT||4318);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf','.json':'application/json'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://127.0.0.1:${port}`);if(url.pathname==='/api/cloud')return handler(req,res);const file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+sep)){res.writeHead(403);return res.end();}res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end('Not found');}}).listen(port,'127.0.0.1',()=>console.log(`NanT web preview: http://127.0.0.1:${port}`));
