'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const domain=require('../renderer/domain');
const registry=['music','pomodoro','cursor','recorder','inbox','windows','mirror','note','commands','sun'];
const defaults={music:'small',pomodoro:'mini',cursor:'small',recorder:'small',inbox:'medium',windows:'medium',mirror:'medium',note:'medium',commands:'mini',sun:'medium'};
test('new default Bento positions inbox above the medium window module without overlapping',()=>{
 const result=domain.normalizeHomeInboxLayout({registry,order:['music','pomodoro','cursor','recorder','inbox','commands','mirror','note','windows','sun'],sizes:defaults,hiddenIds:['sun']});
 assert.equal(domain.validateHomeWidgetLayout({placements:result.placements,allowGaps:true},registry.filter(id=>id!=='sun')),true);
 assert.deepEqual(result.placements.inbox,{column:8,row:0,width:4,height:2});assert.deepEqual(result.placements.windows,{column:8,row:2,width:4,height:2});
});
test('custom old footprint and position stay fixed, and new inbox degrades into a mini gap',()=>{
 const placements={music:{column:0,row:0,width:4,height:4},windows:{column:4,row:0,width:4,height:4},note:{column:8,row:0,width:4,height:2},commands:{column:8,row:2,width:2,height:2},pomodoro:{column:10,row:2,width:2,height:1}};
 const sizes={...defaults,...Object.fromEntries(Object.entries(placements).map(([id,p])=>[id,domain.sizeNameFromPlacement(p)]))};
 const hiddenIds=registry.filter(id=>!placements[id]&&id!=='inbox');
 const result=domain.normalizeHomeInboxLayout({registry,order:registry,sizes,placements,hiddenIds});
 for(const id of Object.keys(placements)){assert.deepEqual(result.placements[id],placements[id]);assert.equal(result.sizes[id],sizes[id]);}
 assert.equal(result.sizes.inbox,'mini');assert.equal(result.hiddenIds.includes('inbox'),false);assert.equal(domain.validateHomeWidgetLayout({placements:result.placements,allowGaps:true},Object.keys(result.placements)),true);
});
test('a full customized grid retains all old modules and sizes, with inbox accessible from its hidden-module setting',()=>{
 const placements={music:{column:0,row:0,width:4,height:4},cursor:{column:4,row:0,width:4,height:4},recorder:{column:8,row:0,width:4,height:4}};
 const sizes={...defaults,music:'large',cursor:'large',recorder:'large'};
 const result=domain.normalizeHomeInboxLayout({registry,order:registry,sizes,placements,hiddenIds:registry.filter(id=>!placements[id]&&id!=='inbox')});
 assert.deepEqual(result.placements,placements);for(const id of Object.keys(sizes))assert.equal(result.sizes[id],sizes[id]);assert(result.hiddenIds.includes('inbox'));
 assert.equal(domain.validateHomeWidgetLayout({placements:result.placements,allowGaps:false},Object.keys(placements)),true);
});
test('an already customized inbox keeps its large footprint during a subsequent launch',()=>{
 const placements={inbox:{column:8,row:0,width:4,height:4},music:{column:0,row:0,width:4,height:4}};
 const sizes={...defaults,inbox:'large',music:'large'};
 const result=domain.normalizeHomeInboxLayout({registry,order:registry,sizes,placements,hiddenIds:registry.filter(id=>!placements[id])});assert.deepEqual(result.placements,placements);assert.equal(result.sizes.inbox,'large');
});
test('only an unchanged old default layout adopts the new default; customized order/size/position is preserved',()=>{
 const order=['music','pomodoro','cursor','windows','recorder','mirror','note','commands','sun'];
 const sizes={...defaults,windows:'large'};delete sizes.inbox;
 const placements=domain.resolveHomeWidgetLayout(order,sizes,['sun']).placements;
 assert(domain.isLegacyDefaultHomeLayout({order,sizes,placements,hiddenIds:['sun']}));
 assert.equal(domain.isLegacyDefaultHomeLayout({order,sizes:{...sizes,music:'medium'},placements,hiddenIds:['sun']}),false);
 assert.equal(domain.isLegacyDefaultHomeLayout({order:[...order].reverse(),sizes,placements,hiddenIds:['sun']}),false);
 assert.equal(domain.isLegacyDefaultHomeLayout({order,sizes,placements,hiddenIds:['sun','note']}),false);
});
test('reopening inbox prefers its remembered slot and freezes every other card',()=>{
 const placements={music:{column:0,row:0,width:4,height:4},windows:{column:4,row:0,width:4,height:4},note:{column:8,row:0,width:4,height:2}};
 const preferredInboxPlacement={column:8,row:2,width:4,height:2};
 const result=domain.normalizeHomeInboxLayout({registry,order:registry,sizes:{...defaults,music:'large',windows:'large'},placements,hiddenIds:registry.filter(id=>!placements[id]&&id!=='inbox'),preservePositions:true,preferredInboxPlacement});
 assert.deepEqual(result.placements.inbox,preferredInboxPlacement);
 for(const [id,p] of Object.entries(placements))assert.deepEqual(result.placements[id],p);
});
test('reopening inbox shrinks only itself when its remembered slot is occupied',()=>{
 const placements={music:{column:0,row:0,width:4,height:4},windows:{column:4,row:0,width:4,height:4},note:{column:8,row:0,width:4,height:2},commands:{column:8,row:2,width:2,height:2},pomodoro:{column:10,row:2,width:2,height:1}};
 const sizes={...defaults,...Object.fromEntries(Object.entries(placements).map(([id,p])=>[id,domain.sizeNameFromPlacement(p)]))};
 const result=domain.normalizeHomeInboxLayout({registry,order:registry,sizes,placements,hiddenIds:registry.filter(id=>!placements[id]&&id!=='inbox'),preservePositions:true,preferredInboxPlacement:{column:8,row:0}});
 assert.equal(result.sizes.inbox,'mini');
 for(const id of Object.keys(placements)){assert.deepEqual(result.placements[id],placements[id]);assert.equal(result.sizes[id],sizes[id]);}
 assert(domain.validateHomeWidgetLayout({placements:result.placements,allowGaps:true},Object.keys(result.placements)));
});
