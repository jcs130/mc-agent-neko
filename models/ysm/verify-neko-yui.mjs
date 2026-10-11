import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';

const here=path.dirname(fileURLToPath(import.meta.url));
const dir=path.resolve(process.argv[2]??path.join(here,'neko_yui'));
const manifest=JSON.parse(await fs.readFile(path.join(here,'neko-yui-manifest.json'),'utf8'));
const files={};
const json=async name=>{
  const bytes=await fs.readFile(path.join(dir,name));
  assert.notEqual(bytes.subarray(0,3).toString('hex'),'efbbbf','BOM: '+name);
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
};
for(const [name,row] of Object.entries(manifest.files)){
  assert(!path.isAbsolute(name)&&!name.includes('..')&&!name.includes('\\'),'unsafe path');
  const bytes=await fs.readFile(path.join(dir,name));files[name]=bytes;
  assert.equal(bytes.length,row.bytes,name+' size');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,name+' hash');
}
const d=await json('ysm.json');assert.equal(d.spec,2);assert.equal(d.properties.free,true);
const player=d.files.player;
for(const p of [...Object.values(player.model),...Object.values(player.animation),...player.texture])assert(files[p],'missing resource '+p);
const require=createRequire(import.meta.url),{createCanvas,loadImage}=require('canvas');
const im=await loadImage(files[player.texture[0]]);assert.equal(im.width,64);assert.equal(im.height,64);
const c=createCanvas(64,64),ctx=c.getContext('2d');ctx.drawImage(im,0,0);const pixels=ctx.getImageData(0,0,64,64).data;
const stats={};
for(const [type,file] of Object.entries(player.model)){
  const model=await json(file);assert.equal(model.format_version,'1.12.0');assert.equal(model['minecraft:geometry'].length,1);
  const g=model['minecraft:geometry'][0],names=new Set(g.bones.map(b=>b.name));
  assert.equal(names.size,g.bones.length,'duplicate bones');assert(g.bones.length<=128,'viewer bone budget');
  assert.equal(g.description.texture_width,im.width);assert.equal(g.description.texture_height,im.height);
  const index=new Map(g.bones.map(b=>[b.name,b]));let cubes=0;
  for(const b of g.bones){
    const seen=new Set([b.name]);let p=b.parent;
    while(p){assert(index.has(p),'missing parent '+p);assert(!seen.has(p),'parent cycle');seen.add(p);p=index.get(p).parent;}
    assert.equal(b.pivot.length,3);assert(b.pivot.every(Number.isFinite));assert((b.cubes?.length??0)<=64,'cube-per-bone budget');
    for(const cube of b.cubes??[]){cubes++;assert(cube.size.every(n=>Number.isFinite(n)&&n>0),'degenerate cube');
      for(const face of Object.values(cube.uv)){
        for(let a=0;a<2;a++)assert(Math.min(face.uv[a],face.uv[a]+face.uv_size[a])>=0&&Math.max(face.uv[a],face.uv[a]+face.uv_size[a])<=64,'UV outside texture');
        // Palette-color cubes must sample opaque pixels; translucent hat layers are intentional.
        if(Math.abs(face.uv_size[0])<1&&Math.abs(face.uv_size[1])<1){
          const x=Math.floor(face.uv[0]+face.uv_size[0]/2),y=Math.floor(face.uv[1]+face.uv_size[1]/2);
          assert.equal(pixels[(y*64+x)*4+3],255,'transparent palette sample at '+x+','+y);
        }
      }
    }
  }
  assert(cubes<=2048);stats[type]={bones:names.size,cubes};
  if(type==='main')for(const name of ['Head','AllHead','ViewLocator','LeftHandLocator','RightHandLocator','ElytraLocator','RightHair','LeftHair','Tail'])assert(names.has(name),'required locator/bone '+name);
  if(type==='arm'){for(const name of ['LeftArm','RightArm'])assert(names.has(name));assert(!names.has('Head'));}
}
const names=new Set((await json(player.model.main))['minecraft:geometry'][0].bones.map(b=>b.name));
for(const [type,file] of Object.entries(player.animation)){
  const anim=await json(file);assert.equal(anim.format_version,'1.8.0');
  for(const [name,clip] of Object.entries(anim.animations)){
    assert(Number.isFinite(clip.animation_length)&&clip.animation_length>=0&&clip.animation_length<=600);
    for(const [bone,channels] of Object.entries(clip.bones)){
      assert(names.has(bone),'unknown animated bone '+bone);
      for(const [channel,track] of Object.entries(channels)){
        assert(['rotation','position','scale'].includes(channel));
        const values=Array.isArray(track)?[track]:Object.values(track);
        for(const v of values)assert(Array.isArray(v)&&v.length===3&&v.every(Number.isFinite),'non-numeric keyframe '+name);
      }
    }
  }
  stats[type+'AnimationClips']=Object.keys(anim.animations).length;
  if(type==='main')for(const name of ['empty','idle','walk','run','sneak','sneaking','jump','swim','climb','attacked','death','swing_hand','swing_offhand','use_mainhand','use_offhand'])assert(anim.animations[name],'missing clip '+name);
  if(type==='extra')for(const name of Object.keys(d.properties.extra_animation))assert(anim.animations[name],'missing wheel clip '+name);
}
assert(files['textures/default.png'].equals(await fs.readFile(path.resolve(here,'../../skins/yui-lolita-slim.png'))),'approved source texture changed');
// Optional check through the real shared viewer importer, rather than a second approximation.
if(process.env.NEKO_YSM_RENDERER_ROOT){
  const root=path.resolve(process.env.NEKO_YSM_RENDERER_ROOT),rendererRequire=createRequire(path.join(root,'package.json'));
  const THREE=rendererRequire('three');
  const {createNativeBedrockModel}=await import(pathToFileURL(path.join(root,'src/native-viewer/native-entity-model-bedrock.js')));
  const {applyPaperYsmAnimation}=await import(pathToFileURL(path.join(root,'src/modern-viewer/paper-ysm.js')));
  const material=new THREE.MeshBasicMaterial();
  for(const file of Object.values(player.model)){
    const imported=createNativeBedrockModel(await json(file),material);assert(imported.cubeCount>0);imported.dispose();
  }
  const imported=createNativeBedrockModel(await json(player.model.main),material),anim=await json(player.animation.main);
  let samples=0;for(const [name,clip] of Object.entries(anim.animations))for(const t of [0,.25,.5,.75,1]){
    applyPaperYsmAnimation(imported,anim,name,t*clip.animation_length,{});imported.root.updateMatrixWorld(true);
    for(const b of imported.bones.values())assert(b.matrixWorld.elements.every(Number.isFinite),'invalid transform '+name);samples++;
  }
  imported.dispose();material.dispose();stats.sharedRenderer={imported:true,animationSamples:samples};
  const {decodeYsmBundle}=await import(pathToFileURL(path.join(root,'host/viewer-ysm-assets.mjs')));
  const encoded=Object.fromEntries(Object.entries(files).map(([name,b])=>[name,{...manifest.files[name],base64:b.toString('base64')}]));
  const fixture={schemaVersion:1,ysmVersion:'2.4.1',format:'ysm-bedrock-original',modelId:manifest.modelId,files:encoded,model:player.model.main,animation:player.animation.main,textures:{default:player.texture[0]}};
  const compressed=gzipSync(Buffer.from(JSON.stringify(fixture))),hash=createHash('sha256').update(compressed).digest('hex');
  assert.equal(decodeYsmBundle(compressed,hash).modelId,manifest.modelId);stats.sharedRenderer.offlineBundleBytes=compressed.length;
}
console.log(JSON.stringify({modelId:manifest.modelId,resources:Object.keys(files).length,totalBytes:Object.values(files).reduce((n,b)=>n+b.length,0),...stats},null,2));
