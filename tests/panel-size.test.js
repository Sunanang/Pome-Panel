'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { layout } = require('../platform');
const { appSettingsLayoutPreferences } = require('../main-services');
const { projectHomeCapacity, packHomeWidgetLayout, validateHomeWidgetLayout, fitHomeWidgetView } = require('../renderer/domain');

test('three local presets generate every tab size; invalid persisted values fall back safely', () => {
  for (const [preset, width, height, capacity] of [['standard',1240,638,48],['medium',1040,580,36],['compact',880,520,24]]) {
    assert.equal(appSettingsLayoutPreferences({panelSize:preset}).panelSize,preset);
    assert.equal(layout.panelSizePreset(preset).capacity,capacity);
    for (const size of Object.values(layout.tabSizes(preset))) assert.deepEqual(size,{width,panelHeight:height-98});
  }
  for (const value of [null,0,'mini','',{},['compact'],'__proto__']) {
    assert.equal(layout.normalizePanelSize(value),'standard');
    assert.equal(appSettingsLayoutPreferences({panelSize:value}).panelSize,'standard');
  }
});
test('actual default footprints stop at first overflow instead of skipping ahead or shrinking cards', () => {
  const order=['sun','pomodoro','cursor','almanac','inbox','commands','mirror','note','windows','music','recorder'];
  const sizes={sun:'medium',pomodoro:'mini',cursor:'small',almanac:'small',inbox:'medium',commands:'mini',mirror:'medium',note:'medium',windows:'medium',music:'small',recorder:'small'};
  const before=JSON.stringify(sizes),hidden=['music','recorder'];
  for(const [capacity,used,count] of [[48,44,8],[36,36,7],[24,18,4]]) {
    const projection=projectHomeCapacity(order,sizes,hidden,capacity);
    assert.equal(projection.used,used);assert.deepEqual(projection.visibleIds,order.slice(0,count));
    assert.deepEqual(projection.overflowIds,order.slice(count,9));
  }
  assert.equal(JSON.stringify(sizes),before);assert.deepEqual(hidden,['music','recorder']);
  const stopped=projectHomeCapacity(['a','b','c'],{a:'large',b:'large',c:'mini'},[],24);
  assert.deepEqual(stopped.visibleIds,['a']);assert.deepEqual(stopped.overflowIds,['b','c']);
});
test('capacity accounts for unsupported/hidden modules and recovers the same user order at a larger size', () => {
  const order=['a','b','c','d'],sizes={a:'large',b:'medium',c:'small',d:'mini'},hidden=['a'];
  assert.deepEqual(projectHomeCapacity(order,sizes,hidden,24).visibleIds,['b','c','d']);
  assert.deepEqual(projectHomeCapacity(order,sizes,[],24).visibleIds,['a','b']);
  assert.deepEqual(projectHomeCapacity(order,sizes,[],48).visibleIds,order);
});
test('every admitted combination of the four existing footprints fits the narrower preset grids', () => {
  // Includes multiple large cards and many mini cards; no footprint is resized.
  for (const [columns, capacity] of [[10,36],[8,24]]) {
    for(let mini=0;mini<=capacity/2;mini++)for(let small=0;small<=capacity/4;small++)
    for(let medium=0;medium<=capacity/8;medium++)for(let large=0;large<=capacity/16;large++) {
      const area=mini*2+small*4+medium*8+large*16;
      if(!area||area>capacity)continue;
      const sizes={};let index=0;
      for(const [count,size] of [[mini,'mini'],[small,'small'],[medium,'medium'],[large,'large']])
        for(let i=0;i<count;i++)sizes[`tile${index++}`]=size;
      const ids=Object.keys(sizes),placements=packHomeWidgetLayout(ids,sizes,columns,4,false);
      assert(validateHomeWidgetLayout({placements,allowGaps:true},ids,columns,4),JSON.stringify(sizes));
      for(const [id,p] of Object.entries(placements))assert.equal(p.width*p.height,{mini:2,small:4,medium:8,large:16}[sizes[id]]);
    }
  }
});
test('presets stay pinned to all four edges and within work areas on both platforms and scaled displays', () => {
  for(const platform of ['darwin','win32'])for(const scale of [1,1.25,1.5,2])for(const edge of ['top','bottom','left','right'])for(const preset of ['standard','medium','compact']) {
    const display={id:1,scaleFactor:scale,bounds:{x:-1920,y:0,width:1920,height:1080},workArea:{x:-1920,y:platform==='darwin'?28:0,width:1920,height:platform==='darwin'?1020:1040}};
    const ctx={platform,display,tab:'notes',tabSizes:layout.tabSizes(preset)};
    const area=layout.layoutArea(ctx),side=layout.collapsedSize(edge);
    const seed={x:edge==='left'?area.x:edge==='right'?area.x+area.width-side.width:area.x+Math.round((area.width-side.width)/2),y:edge==='top'?display.workArea.y:edge==='bottom'?area.y+area.height-side.height:area.y+Math.round((area.height-side.height)/2),...side};
    ctx.position=layout.snapCollapsed(ctx,seed,edge);
    const bounds=layout.expandedBounds(ctx),expected=layout.panelSizePreset(preset);
    assert.equal(bounds.width,expected.width);assert.equal(bounds.height,expected.panelHeight+98);
    assert(bounds.x>=area.x&&bounds.x+bounds.width<=area.x+area.width);
    assert(bounds.y>=display.workArea.y&&bounds.y+bounds.height<=area.y+area.height);
    if(edge==='left')assert.equal(bounds.x,ctx.position.x);
    if(edge==='right')assert.equal(bounds.x+bounds.width,ctx.position.x+side.width);
    if(edge==='top')assert.equal(bounds.y,ctx.position.y);
    if(edge==='bottom')assert.equal(bounds.y+bounds.height,ctx.position.y+side.height);
  }
});

test('narrow views fill the entire surface without changing selected footprints or the admitted set', () => {
  for(const [sizes,columns,rows] of [
    [{pomodoro:'small',note:'small',inbox:'medium',windows:'medium',cursor:'medium'},10,4],
    [{pomodoro:'small',note:'small',inbox:'medium',windows:'medium'},8,3],
    [{sun:'medium',pomodoro:'mini',cursor:'small',almanac:'small',inbox:'medium',commands:'mini',mirror:'medium'},10,4],
    [{sun:'medium',pomodoro:'mini',cursor:'small',almanac:'small'},8,3],
    [{cursor:'large',sun:'medium'},8,3],
    [{note:'mini'},8,3],
  ]) {
    const before=JSON.stringify(sizes),ids=Object.keys(sizes),view=fitHomeWidgetView(ids,sizes,columns,rows,2);
    assert(validateHomeWidgetLayout({placements:view.placements,allowGaps:true},ids,view.columns,view.rows));
    assert.equal(JSON.stringify(sizes),before);
    const rectangles=Object.values(view.rects);
    assert(Math.abs(rectangles.reduce((sum,r)=>sum+r.width*r.height,0)-1)<1e-9,'no unused surface');
    for(const [id,p] of Object.entries(view.placements))assert.equal(p.width*p.height,{mini:2,small:4,medium:8,large:16}[sizes[id]]);
    for(let i=0;i<rectangles.length;i++) {
      const a=rectangles[i];assert(a.x>=0&&a.y>=0&&a.x+a.width<=1+1e-9&&a.y+a.height<=1+1e-9);
      for(let j=i+1;j<rectangles.length;j++) {
        const b=rectangles[j];assert(!(a.x<b.x+b.width-1e-9&&a.x+a.width>b.x+1e-9&&a.y<b.y+b.height-1e-9&&a.y+a.height>b.y+1e-9),'tiles cannot overlap');
      }
    }
  }
});
