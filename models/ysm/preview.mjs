import * as THREE from 'three';
import {createPaperYsmActor} from '@neko-ysm/renderer';

const root=document.querySelector('#stage'),scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(30,1,.1,100);camera.position.set(0,1.1,5.8);camera.lookAt(0,1.0,0);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;root.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xd4e8ff,0x747a88,2.3));const key=new THREE.DirectionalLight(0xfff3e5,2.5);key.position.set(-3,6,5);scene.add(key);
const rim=new THREE.DirectionalLight(0x99cfff,1.2);rim.position.set(3,4,-3);scene.add(rim);
const names=['ysm.json','models/main.json','models/arm.json','animations/main.animation.json','animations/arm.animation.json','animations/extra.animation.json','textures/default.png'];
const actors=[];let animation='idle',elapsed=0,paused=false;
const render=()=>renderer.render(scene,camera);
try{
 const files={};for(const name of names){const response=await fetch('/neko_yui/'+name);if(!response.ok)throw Error('Missing resource '+name);const a=new Uint8Array(await response.arrayBuffer());let binary='';for(const b of a)binary+=String.fromCharCode(b);files[name]={base64:btoa(binary)};}
 const bundle={schemaVersion:1,ysmVersion:'2.4.1',format:'ysm-bedrock-original',modelId:'neko_yui',files,model:'models/main.json',animation:'animations/main.animation.json',textures:{default:'textures/default.png'}};
 const metadata=[];for(let i=0;i<3;i++){
   const actor=await createPaperYsmActor(bundle,'default');actor.root.position.set((i-1)*1.35,0,0);actor.root.rotation.y=[Math.PI,Math.PI*.43,0][i];scene.add(actor.root);actors.push(actor);metadata.push(actor.assetInfo);
   const disc=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.025,48),new THREE.MeshLambertMaterial({color:0x33445e}));disc.position.set((i-1)*1.35,-.02,0);scene.add(disc);
 }
 const labels={idle:'待机',walk:'行走',run:'跑步',swing_hand:'挥动工具',extra1:'招手',extra2:'欢呼',extra3:'鞠躬',sneaking:'潜行',sit:'坐下'};
 const update=()=>{for(const a of actors)a.animate({animation,pitch:0},elapsed);document.querySelector('#error').textContent=actors.map(a=>a.animationReason).filter(Boolean).join(' / ');render();};
 const mark=()=>{for(const b of document.querySelectorAll('[data-clip]'))b.setAttribute('aria-pressed',String(b.dataset.clip===animation));};
 for(const [name,label] of Object.entries(labels)){const b=document.createElement('button');b.textContent=label;b.dataset.clip=name;b.onclick=()=>{animation=name;elapsed=0;paused=false;freeze.textContent='暂停动画';mark();update();};document.querySelector('#controls').append(b);}
 const freeze=document.createElement('button');freeze.textContent='暂停动画';freeze.onclick=()=>{paused=!paused;freeze.textContent=paused?'继续动画':'暂停动画';};document.querySelector('#controls').append(freeze);
 const download=document.createElement('button');download.textContent='保存预览';download.onclick=()=>{
   render();const c=document.createElement('canvas');c.width=1440;c.height=980;const ctx=c.getContext('2d');
   const gradient=ctx.createRadialGradient(720,490,10,720,490,900);gradient.addColorStop(0,'#25364e');gradient.addColorStop(1,'#0d1320');ctx.fillStyle=gradient;ctx.fillRect(0,0,c.width,c.height);
   ctx.fillStyle='#a9cbea';ctx.font='16px system-ui';ctx.fillText('YSM ORIGINAL MODEL · 01',65,52);ctx.fillStyle='#eaf3ff';ctx.font='36px system-ui';ctx.fillText('NEKO / YUI',65,102);
   const aspect=renderer.domElement.width/renderer.domElement.height,h=Math.min(730,1300/aspect),w=h*aspect;
   ctx.drawImage(renderer.domElement,(c.width-w)/2,140,w,h);ctx.fillStyle='#bdd5ed';ctx.font='18px system-ui';ctx.textAlign='center';
   for(const [i,name] of ['正面','侧面','背面'].entries())ctx.fillText(name,720+(i-1)*w/3,870);
   ctx.fillText('猫耳双马尾 · 蓝白洛丽塔 · neko_yui',720,928);
   c.toBlob(async blob=>{try{const result=await fetch('/export-preview',{method:'POST',headers:{'Content-Type':'image/png'},body:blob});if(!result.ok)throw Error('Export failed');download.textContent='预览已保存';}catch(e){document.querySelector('#error').textContent=e.message;}},'image/png');
 };document.querySelector('#controls').append(download);
 const size=()=>{const w=root.clientWidth,h=root.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render();};new ResizeObserver(size).observe(root);size();mark();
 document.querySelector('#status').textContent=metadata[0].bones+' 骨骼 / '+metadata[0].cubes+' 立方体';
 let last=performance.now();const loop=now=>{if(!paused){elapsed+=now-last;update();}last=now;requestAnimationFrame(loop);};requestAnimationFrame(loop);
 window.nekoYsmPreview={metadata,setClip(name,seconds=0){animation=name;elapsed=seconds*1000;paused=true;mark();update();return actors.map(a=>a.animationReason);},resume(){paused=false;},getErrors(){return actors.map(a=>a.animationReason).filter(Boolean);}};
 window.nekoYsmPreviewReady=true;
}catch(e){document.querySelector('#error').textContent=e.message;window.nekoYsmPreviewError=e.message;throw e;}
