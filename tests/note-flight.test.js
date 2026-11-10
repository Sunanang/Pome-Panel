const test=require('node:test'),assert=require('node:assert/strict');
const {meshPoint}=require('../renderer/note-flight');
const rect={x:400,y:350,width:360,height:180},target={x:210,y:35,width:28};
test('genie opens a narrow throat across the full near edge while the far edge stays in place',()=>{
 const left=meshPoint(rect,target,0,0,.24),right=meshPoint(rect,target,1,0,.24);
 const farLeft=meshPoint(rect,target,0,1,.24),farRight=meshPoint(rect,target,1,1,.24);
 assert.equal(left.y,right.y,'whole near edge moves together, never one corner');
 assert(left.y<rect.y-100);assert(right.x-left.x<rect.width*.6,'near edge narrows into the funnel');
 assert.equal(farLeft.x,rect.x);assert.equal(farRight.x,rect.x+rect.width);assert.equal(farLeft.y,rect.y+rect.height);
});
test('genie keeps slices ordered and converges at the tab without folding or inversion',()=>{
 for(const destination of [target,{x:1150,y:40,width:28},{x:10,y:600,width:28},{x:1200,y:600,width:28}]){
  for(let y=0;y<=48;y++)for(let x=0;x<=2;x++){
   const u=x/2,v=y/48,start=meshPoint(rect,destination,u,v,0),end=meshPoint(rect,destination,u,v,1);
   assert.equal(start.x,rect.x+u*rect.width);assert.equal(start.y,rect.y+v*rect.height);
   assert(Math.hypot(end.x-destination.x,end.y-destination.y)<.001);
   for(let t=0;t<=1;t+=.025){
    const p=meshPoint(rect,destination,u,v,t),left=meshPoint(rect,destination,0,v,t),right=meshPoint(rect,destination,1,v,t);
    assert(Number.isFinite(p.x)&&Number.isFinite(p.y));assert(right.x>=left.x,'no reversed horizontal slice');
    if(y<48){const below=meshPoint(rect,destination,u,(y+1)/48,t);assert(below.y>=p.y-.001,'no folded rows');}
   }
  }
 }
});
