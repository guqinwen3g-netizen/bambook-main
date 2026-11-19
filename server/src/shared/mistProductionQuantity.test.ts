import {describe,expect,it} from 'vitest';
import {aggregateProductionProgress} from './mistProductionQuantity';

describe('production progress quantities',()=>{
 it('weights split sources within their line before averaging incompatible lines',()=>{
  const rows=[{id:'a1',lineId:'a',qty:30,pct:100,unit:'米'},{id:'a2',lineId:'a',qty:70,pct:0,unit:'米'},{id:'b',lineId:'b',qty:1000,pct:100,unit:'公斤'}];
  const before=structuredClone(rows);
  expect(aggregateProductionProgress(rows)).toBe(65);
  expect(rows).toEqual(before);
 });
 it('keeps equivalent piece aliases quantity weighted',()=>{
  expect(aggregateProductionProgress([{id:'a',qty:197,pct:100,unit:'件'},{id:'b',qty:3,pct:0,unit:'PCS'}])).toBe(99);
 });
 it('does not invent a common unit for unrecorded units',()=>{
  expect(aggregateProductionProgress([{id:'a',qty:1,pct:100},{id:'b',qty:999,pct:0}])).toBe(50);
 });
 it('leaves existing order progress alone without active quantities',()=>{
  expect(aggregateProductionProgress([])).toBeUndefined();
  expect(aggregateProductionProgress([{id:'a',qty:0,pct:100,unit:'米'}])).toBeUndefined();
 });
});
