import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,mistCommandPermission,type MistContext} from './mistWorkspace';
import {applicablePricingParams,normalizePricingPercent,upcomingPricingParams,type PricingParamVersion} from './mistPricingParams';

function fixture(now='2026-10-18T02:00:00.000Z'){let i=0;const c:MistContext={id:()=>`pp-${++i}`,now,actorName:'总经理',actorId:'boss',members:[{id:'boss',name:'总经理',active:true,groups:['fabric','garment']}]} as MistContext;let state=createMistState(c,'empty');state.customers.push({id:'customer',name:'客户',code:'C1',country:'CN',city:'',industry:'',owner:'总经理',ownerId:'boss',grade:'A',currency:'USD',terms:'',incoterm:'FOB',categories:'',creditLimit:1000,since:'2026-01-01'} as any);state=applyMistCommand(state,{type:'order.create',payload:{type:'garment',customerId:'customer',season:'AW',currency:'USD',due:'2026-11-10',ownerId:'boss',lines:[{name:'成衣',style:'A',img:'coat',qty:10,unit:'件',price:10}]}} as any,c).state;return{c,state,orderId:state.orders[0].id};}
const setParams=(p:Record<string,unknown>)=>({type:'platform.pricingParams.set',payload:{family:'garment',profitMargin:20,commissionRate:5,effectiveFrom:'2026-10-18',reason:'年度定价会议',...p}}) as any;
const save=(orderId:string,p:Record<string,unknown>={})=>({type:'platform.pricing.save',payload:{orderId,purchaseCostCny:100,refundRate:13,exchangeRate:7.2,profitMargin:20,commissionRate:5,basis:'CNY/件，工厂报价 2026-10-18',...p}}) as any;

describe('pricing parameter versions',()=>{
 it('requires pricing:admin to set versions while saving a calculation stays pricing:write',()=>{
  expect(mistCommandPermission(setParams({}))).toBe('pricing:admin');
  expect(mistCommandPermission(save('o'))).toBe('pricing:write');
 });
 it('validates percent bounds and effective date, and numbers versions per family',()=>{
  const f=fixture();
  expect(()=>applyMistCommand(f.state,setParams({profitMargin:'abc'}),f.c)).toThrow(/标准成本加成率/);
  expect(()=>applyMistCommand(f.state,setParams({commissionRate:31}),f.c)).toThrow(/标准佣金率/);
  expect(()=>applyMistCommand(f.state,setParams({effectiveFrom:'2026-10-17'}),f.c)).toThrow(/不能早于今天/);
  expect(()=>applyMistCommand(f.state,setParams({reason:' '}),f.c)).toThrow(/调整原因/);
  let s=applyMistCommand(f.state,setParams({}),f.c).state;
  s=applyMistCommand(s,setParams({profitMargin:'18.5',effectiveFrom:'2026-11-01'}),f.c).state;
  s=applyMistCommand(s,setParams({family:'fabric',profitMargin:12,commissionRate:0}),f.c).state;
  expect(s.platform.pricingParams.map(r=>[r.family,r.version,r.profitMargin])).toEqual([['garment',1,20],['garment',2,18.5],['fabric',1,12]]);
  expect(s.events[0].text).toContain('面料定价标准参数 V1');
 });
 it('picks the latest effective version on a day, preferring the higher version on the same day',()=>{
  const row=(version:number,effectiveFrom:string,family:'garment'|'fabric'='garment')=>({id:'v'+version+family,family,version,profitMargin:version,commissionRate:0,effectiveFrom,reason:'',createdAt:'',createdBy:'',createdById:''}) as PricingParamVersion;
  const rows=[row(1,'2026-10-01'),row(2,'2026-11-01'),row(3,'2026-10-01'),row(1,'2026-09-01','fabric')];
  expect(applicablePricingParams(rows,'garment','2026-10-18')?.version).toBe(3);
  expect(applicablePricingParams(rows,'garment','2026-11-01')?.version).toBe(2);
  expect(applicablePricingParams(rows,'garment','2026-09-30')).toBeUndefined();
  expect(upcomingPricingParams(rows,'garment','2026-10-18')?.version).toBe(2);
  expect(normalizePricingPercent('200',200)).toBe(200);expect(normalizePricingPercent('200.01',200)).toBeNull();expect(normalizePricingPercent('1e2',200)).toBeNull();
 });
 it('freezes the version applicable on the save day by order type and later versions do not rewrite it',()=>{
  const f=fixture();
  let s=applyMistCommand(f.state,setParams({}),f.c).state;
  s=applyMistCommand(s,setParams({family:'fabric',profitMargin:30}),f.c).state;
  s=applyMistCommand(s,save(f.orderId),f.c).state;
  expect(s.platform.pricing[0].params).toMatchObject({family:'garment',version:1,profitMargin:20,commissionRate:5,effectiveFrom:'2026-10-18'});
  expect(s.platform.pricing[0].deviationReason).toBeUndefined();
  const frozen=structuredClone(s.platform.pricing[0]);
  s=applyMistCommand(s,setParams({profitMargin:25,effectiveFrom:'2026-10-19'}),f.c).state;
  expect(s.platform.pricing[0]).toEqual(frozen);
  const next={...f.c,now:'2026-10-19T02:00:00.000Z'};
  s=applyMistCommand(s,save(f.orderId,{profitMargin:25}),next).state;
  expect(s.platform.pricing[0].params?.version).toBe(2);
 });
 it('requires and records a deviation reason only when markup is below standard',()=>{
  const f=fixture();
  let s=applyMistCommand(f.state,setParams({}),f.c).state;
  expect(()=>applyMistCommand(s,save(f.orderId,{profitMargin:15}),f.c)).toThrow(/低于成衣标准 20%（V1），请填写偏离理由/);
  s=applyMistCommand(s,save(f.orderId,{profitMargin:15,commissionRate:0,deviationReason:'老客户返单，总经理口头批准'}),f.c).state;
  expect(s.platform.pricing[0].deviationReason).toBe('老客户返单，总经理口头批准');
  expect(s.events[0].text).toContain('低于标准 20%');
  s=applyMistCommand(s,save(f.orderId,{profitMargin:22,deviationReason:'无需理由'}),f.c).state;
  expect(s.platform.pricing[0].deviationReason).toBeUndefined();
 });
 it('saves without frozen params when no standard is set for the order type',()=>{
  const f=fixture();
  const s=applyMistCommand(applyMistCommand(f.state,setParams({family:'fabric'}),f.c).state,save(f.orderId,{profitMargin:1}),f.c).state;
  expect(s.platform.pricing[0].params).toBeUndefined();expect(s.platform.pricing[0].finalUnitPrice).toBeGreaterThan(0);
 });
});
