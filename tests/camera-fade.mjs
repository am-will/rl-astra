import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('test-results/camera-fade',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),errors=[],results=[];
const check=(name,pass,detail)=>{assert.ok(pass,`${name}: ${JSON.stringify(detail)}`);results.push({name,detail});console.log(`PASS ${name}`)};
try{
 const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',e=>{if(e.type()==='error')errors.push(e.text())});
 await p.goto('http://127.0.0.1:5179');await p.waitForFunction(()=>window.__game?.view&&!document.querySelector('#loading'));
 await p.evaluate(()=>{window.requestAnimationFrame=()=>0;window.__game.testing=true;});await p.waitForTimeout(80);
 for(const quality of ['performance','high','ultra'])for(const end of [-1,1]){
  const floor=await p.evaluate(async({quality,end})=>{const g=window.__game;g.scenario('drive');g.physics.player.body.setTranslation({x:0,y:.35,z:end*54},true);const v=g.view;v.setQuality(quality);v.update(0,'playing');v.camera.position.set(0,2.45,end*59);v.camera.lookAt(0,.4,end*52);v.camera.updateMatrixWorld();v.stadium.grass.update(v.camera.position,v.player.root.position,0);v.draw();
   const c=document.createElement('canvas');c.width=1280;c.height=800;const ctx=c.getContext('2d');ctx.drawImage(v.renderer.domElement,0,0,1280,800);const data=ctx.getImageData(410,580,300,140).data;let difference=0,high=0;
   for(let y=0;y<140;y++)for(let x=1;x<300;x++){const i=(y*300+x)*4;const d=(Math.abs(data[i]-data[i-4])+Math.abs(data[i+1]-data[i-3])+Math.abs(data[i+2]-data[i-2]))/3;difference+=d;high+=d>25?1:0;}
   return{difference:difference/(299*140),highFraction:high/(299*140)};
  },{quality,end});
  // The original fade produced mean adjacent-pixel jumps of 45-48 / 255 and
  // high-contrast speckles across ~50% of this otherwise continuous floor.
  check(`${quality}: ${end<0?'orange':'blue'} goal floor remains solid beside the camera`,floor.difference<2&&floor.highFraction<.01,floor);
 }
 const blend=await p.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),v=window.__game.view;
  const body=v.scene.getObjectByName('blue-goal-frame').children[0];
  const source=body.children.find(m=>m.children.some(c=>c.name==='camera-fade-overlay'));
  const scene=new T.Scene();scene.background=new T.Color(0xdce8ff);scene.add(new T.HemisphereLight(0xffffff,0xffffff,2));
  const geometry=new T.PlaneGeometry(8,8),solid=new T.Mesh(geometry,source.material),near=new T.Mesh(geometry,source.children.find(c=>c.name==='camera-fade-overlay').material);
  near.renderOrder=2;solid.add(near);scene.add(solid);
  const camera=new T.PerspectiveCamera(60,1.6,.1,20),gl=v.renderer.getContext(),samples=[];
  for(const distance of [2,3,4,5,5.49,5.5,5.51,6]){
   camera.position.set(0,0,distance);camera.lookAt(0,0,0);v.renderer.render(scene,camera);
   const data=new Uint8Array(8*8*4);gl.readPixels(Math.floor(gl.drawingBufferWidth/2)-4,Math.floor(gl.drawingBufferHeight/2)-4,8,8,gl.RGBA,gl.UNSIGNED_BYTE,data);
   const values=[];for(let i=0;i<data.length;i+=4)values.push((data[i]+data[i+1]+data[i+2])/3);
   samples.push({distance,mean:values.reduce((a,b)=>a+b)/values.length,range:Math.max(...values)-Math.min(...values)});
  }
  geometry.dispose();return samples;
 });
 check('Close structures blend smoothly without individual-pixel holes',blend.every(s=>s.range<3)&&blend[0].mean-blend[2].mean>20&&blend[2].mean-blend.at(-1).mean>20,blend);
 check('Returning to opaque rendering has no visible brightness seam',Math.abs(blend[4].mean-blend[6].mean)<2,blend);
 check('No browser or shader errors',errors.length===0,errors);
 await writeFile('test-results/camera-fade/checks.json',JSON.stringify({results,errors},null,2));
}finally{await browser.close()}
