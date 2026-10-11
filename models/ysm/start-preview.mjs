// Isolated static preview; no Neko/game/chat connection and no runtime state mutation.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
const rendererPath=process.argv[2]??process.env.NEKO_YSM_RENDERER_ROOT;
const port=Number(process.argv[3]??18043);
if(!rendererPath||!Number.isInteger(port)||port<1024||port>65535)throw Error('Usage: node start-preview.mjs RENDERER_ROOT [PORT]');
const rendererRoot=path.resolve(rendererPath);
const require=createRequire(path.join(rendererRoot,'package.json')),{build}=require('esbuild');
const built=await build({entryPoints:[path.join(here,'preview.mjs')],write:false,bundle:true,format:'esm',platform:'browser',
 alias:{'@neko-ysm/renderer':path.join(rendererRoot,'src/modern-viewer/paper-ysm.js'),
   'three/addons':path.join(rendererRoot,'node_modules/three/examples/jsm'),
   'three':path.join(rendererRoot,'node_modules/three')},logLevel:'warning'});
const manifest=JSON.parse(await fs.readFile(path.join(here,'neko-yui-manifest.json'),'utf8'));
const allowed=new Set(Object.keys(manifest.files).map(n=>'neko_yui/'+n));
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');const file=decodeURIComponent(url.pathname).slice(1);
  if(file==='export-preview'&&req.method==='POST'){
   if(req.headers.origin!=='http://127.0.0.1:'+port||req.headers['content-type']!=='image/png'){res.writeHead(403);res.end();return;}
   const chunks=[];let count=0;for await(const chunk of req){count+=chunk.length;if(count>4*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'){res.writeHead(400);res.end();return;}
   await fs.writeFile(path.join(here,'neko-yui-preview.png'),bytes);res.writeHead(200,{'Content-Type':'text/plain'});res.end('Saved neko-yui-preview.png');return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  let bytes,mime;if(!file||file==='preview.html'){bytes=await fs.readFile(path.join(here,'preview.html'));mime='text/html; charset=utf-8';}
  else if(file==='preview.bundle.js'){bytes=built.outputFiles[0].contents;mime='text/javascript; charset=utf-8';}
  else if(allowed.has(file)){bytes=await fs.readFile(path.join(here,file));mime=file.endsWith('.png')?'image/png':'application/json; charset=utf-8';}
  else{res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
 }catch{res.writeHead(500);res.end('Preview resource error');}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,url:'http://127.0.0.1:'+port,rendererRoot,scope:'isolated-static-preview'})));
