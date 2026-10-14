'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarize}=require('../scripts/work-hub-statistics');
const samples=()=>['normal','background-sync'].flatMap(group=>Array.from({length:20},(_,index)=>({group,index,ms:100+index,success:true})));
test('P95 uses rank 19 and permits one slow successful sample per 20',()=>{const rows=samples();rows[19].ms=500;const result=summarize(rows);assert.equal(result.groups.normal.p95,118);assert.equal(result.passed,true);rows[18].ms=400;assert.equal(summarize(rows).passed,false);});
test('failure/timeout and missing samples are retained and fail the group',()=>{const rows=samples();rows[0].success=false;rows[0].ms=null;assert.equal(summarize(rows).groups.normal.samples,20);assert.equal(summarize(rows).passed,false);assert.equal(summarize(rows.slice(1)).passed,false);});
