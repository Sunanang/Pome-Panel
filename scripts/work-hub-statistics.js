'use strict';
function summarize(samples, thresholdMs=300) {
 const groups={};
 for(const group of ['normal','background-sync']) {
  const rows=samples.filter(s=>s.group===group);
  const values=rows.map(s=>Number.isFinite(s.ms)?s.ms:Infinity).sort((a,b)=>a-b);
  const p95=values[Math.ceil(.95*rows.length)-1]??Infinity;
  groups[group]={samples:rows.length,p95:Number.isFinite(p95)?p95:null,passed:rows.length===20&&rows.every(s=>s.success)&&p95<=thresholdMs};
 }
 return {groups,passed:Object.values(groups).every(g=>g.passed)};
}
module.exports={summarize};
