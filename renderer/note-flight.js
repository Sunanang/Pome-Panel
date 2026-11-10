(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PomeNoteFlight=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  const clamp=value=>Math.max(0,Math.min(1,value));
  const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
  // Genie-style transport: the near edge stretches into a narrow throat first,
  // then the far edge accelerates along the same curved funnel. Horizontal
  // slices stay level; there is no corner grab, rotation or flapping sheet.
  function meshPoint(rect,target,u,v,time) {
    const t=clamp(time),up=target.y<=rect.y+rect.height/2;
    const near=up?rect.y:rect.y+rect.height,far=up?rect.y+rect.height:rect.y;
    const stretch=smooth(t/.42),absorb=smooth((t-.28)/.72);
    const row=up?v:1-v;
    const nearY=near+(target.y-near)*stretch,farY=far+(target.y-far)*absorb;
    const y=nearY+(farY-nearY)*row;
    const distance=Math.abs(far-target.y)<.001?row*(1-absorb):clamp((y-target.y)/(far-target.y));
    const curve=(1-Math.cos(Math.PI*distance))/2;
    const sourceCenter=rect.x+rect.width/2;
    const throat=(target.width||24)*(1-smooth((t-.86)/.14));
    const center=sourceCenter+(target.x+(sourceCenter-target.x)*curve-sourceCenter)*stretch;
    const width=rect.width+(throat+(rect.width-throat)*curve-rect.width)*stretch;
    return {x:center+(u-.5)*width,y};
  }
  let active=null;
  function reduced(){return matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('experience-reduced-motion');}
  function pulse(target){if(!target?.isConnected)return;target.classList.add('note-received');setTimeout(()=>target.classList.remove('note-received'),220);}
  function stop(){generation++;document.documentElement.classList.remove('note-snapshotting');active?.finish(false);}
  function triangle(ctx,bitmap,source,dest) {
    const [a,b,c]=source,[p,q,r]=dest;
    const det=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);if(Math.abs(det)<.001)return;
    const xx=((q.x-p.x)*(c.y-a.y)-(r.x-p.x)*(b.y-a.y))/det;
    const xy=((r.x-p.x)*(b.x-a.x)-(q.x-p.x)*(c.x-a.x))/det;
    const yx=((q.y-p.y)*(c.y-a.y)-(r.y-p.y)*(b.y-a.y))/det;
    const yy=((r.y-p.y)*(b.x-a.x)-(q.y-p.y)*(c.x-a.x))/det;
    // Adjacent antialiased clips otherwise leave hairline gaps in compressed
    // lettering. Overlap the clip a fraction of a pixel; keep texture mapping
    // unchanged so the curved slices remain continuous.
    const center={x:(p.x+q.x+r.x)/3,y:(p.y+q.y+r.y)/3};
    const clip=[p,q,r].map(v=>{const d=Math.hypot(v.x-center.x,v.y-center.y)||1;return {x:v.x+(v.x-center.x)/d*.45,y:v.y+(v.y-center.y)/d*.45};});
    ctx.save();ctx.beginPath();ctx.moveTo(clip[0].x,clip[0].y);ctx.lineTo(clip[1].x,clip[1].y);ctx.lineTo(clip[2].x,clip[2].y);ctx.closePath();ctx.clip();
    ctx.transform(xx,yx,xy,yy,p.x-xx*a.x-xy*a.y,p.y-yx*a.x-yy*a.y);ctx.drawImage(bitmap,0,0);ctx.restore();
  }
  let generation=0;
  async function prepare(source) {
    const tile=source.closest('.home-note'),target=document.querySelector('#tab-button-notes');
    if(!tile||reduced()||!window.notchAPI?.captureNoteModule)return {target};
    const bounds=tile.getBoundingClientRect(),clip=tile.closest('.home-bento')?.getBoundingClientRect()||{left:0,top:0,right:innerWidth,bottom:innerHeight};
    const x=Math.max(bounds.left,clip.left,0),y=Math.max(bounds.top,clip.top,0);
    const rect={x,y,width:Math.min(bounds.right,clip.right,innerWidth)-x,height:Math.min(bounds.bottom,clip.bottom,innerHeight)-y};
    if(rect.width<10||rect.height<10)return {target};
    const token=generation;
    let captured;
    document.documentElement.classList.add('note-snapshotting');
    try {
      // capturePage reads the compositor, not the latest unpainted DOM. Wait
      // for a painted frame so a just-typed draft cannot capture an old empty
      // field. Exclude the viewport toast, which is not part of this module.
      await new Promise(resolve=>{
        const timeout=setTimeout(resolve,70);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timeout);resolve();}));
      });
      if(token!==generation)return {target};
      captured=await window.notchAPI.captureNoteModule(rect);
    } finally {document.documentElement.classList.remove('note-snapshotting');}
    if(!captured||token!==generation||reduced()||document.hidden)return {target};
    const image=new Image();image.src=captured.dataURL;await image.decode();
    if(token!==generation)return {target};
    // Native pixels preserve the complete tile: its actual background, glass,
    // title, actions and text. Clip out neighbouring pixels at rounded corners.
    const bitmap=document.createElement('canvas');bitmap.width=image.naturalWidth;bitmap.height=image.naturalHeight;
    const ctx=bitmap.getContext('2d');if(!ctx)return {target};
    const scale=bitmap.width/captured.rect.width;
    const radius=parseFloat(getComputedStyle(tile).borderTopLeftRadius)||0;
    ctx.beginPath();ctx.roundRect(0,0,bitmap.width,bitmap.height,radius*scale);ctx.clip();ctx.drawImage(image,0,0);
    return {rect:captured.rect,target,bitmap,tile,generation:token};
  }
  function start(prepared) {
    active?.finish(false);
    const target=prepared?.target,bounds=target?.getBoundingClientRect();
    if(!prepared?.bitmap||prepared.generation!==generation||document.hidden||!target?.checkVisibility()||!bounds?.width||reduced()){pulse(target);return Promise.resolve();}
    const {rect,bitmap,tile}=prepared,point={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,width:Math.min(28,bounds.width*.5)};
    const canvas=document.createElement('canvas');canvas.className='note-flight';canvas.setAttribute('aria-hidden','true');
    const dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.ceil(innerWidth*dpr);canvas.height=Math.ceil(innerHeight*dpr);document.body.append(canvas);
    const ctx=canvas.getContext('2d');if(!ctx){canvas.remove();return Promise.resolve();}
    tile?.classList.add('note-replenish');
    const cols=2,rows=48,duration=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--note-flight-ms'))||720;
    let frame=0,resolve,finished=false,startTime=performance.now();
    const promise=new Promise(done=>{resolve=done;});
    const state={finish(arrived){if(finished)return;finished=true;cancelAnimationFrame(frame);canvas.remove();tile?.classList.remove('note-replenish');if(active===state)active=null;if(arrived)pulse(target);resolve();}};active=state;
    function draw(now){
      if(finished)return;
      if(document.hidden||reduced()||!target.checkVisibility()){state.finish(false);return;}
      const time=clamp((now-startTime)/duration);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);
      ctx.globalAlpha=1-smooth((time-.96)/.04);
      const vertices=[];
      for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++)vertices.push(meshPoint(rect,point,x/cols,y/rows,time));
      for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
        const i=y*(cols+1)+x;
        const a={x:x/cols*bitmap.width,y:y/rows*bitmap.height},b={x:(x+1)/cols*bitmap.width,y:a.y},c={x:a.x,y:(y+1)/rows*bitmap.height},d={x:b.x,y:c.y};
        triangle(ctx,bitmap,[a,b,c],[vertices[i],vertices[i+1],vertices[i+cols+1]]);
        triangle(ctx,bitmap,[b,d,c],[vertices[i+1],vertices[i+cols+2],vertices[i+cols+1]]);
      }
      canvas.dataset.progress=time.toFixed(3);canvas.dataset.effect='genie';canvas.dataset.scope='module';
      if(time>=1)state.finish(true);else frame=requestAnimationFrame(paint);
    }
    function paint(now){try{draw(now);}catch{state.finish(false);}}
    paint(startTime);return promise;
  }
  if(typeof document==='object'){
    document.addEventListener('notch:will-collapse',stop);
    document.addEventListener('notch:tabchange',event=>{if(event.detail?.tab!=='home')stop();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
    document.addEventListener('notch:window-visibility',event=>{if(!event.detail?.visible)stop();});
    document.addEventListener('notch:motion-preference',()=>{if(reduced())stop();});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{if(reduced())stop();});
    window.addEventListener('resize',stop);window.addEventListener('pagehide',stop);
  }
  return {meshPoint,prepare,start,stop,isActive:()=>Boolean(active)};
});
