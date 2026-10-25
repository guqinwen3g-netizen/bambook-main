// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getAllByRole,getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState} from '../../../../../server/src/shared/mistWorkspace';
import type {ClaimRepairJob} from '../../../../../server/src/shared/mistClaimInventory';
import type {PlatformClaimGoods} from '../../../../../server/src/shared/mistPlatform';
import {Nav} from '../../nav';
import {ClaimRepairWork,repairDispatchSpec,repairReturnSpec,repairRecordSpec} from './ClaimRepairWork';
const bridge=vi.hoisted(()=>({value:null as any}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>bridge.value}));
let host:HTMLDivElement,root:Root;
const job:ClaimRepairJob={id:'repair-new',receivedEventId:'received',stockId:'stock',batchNumber:'LOT-1',quantity:1,unit:'件',domain:'garment',warehouseId:'warehouse',place:'Warehouse A',supplierId:'factory',supplierName:'Repair provider',technician:'Technician',completedAt:'2026-10-13',basis:'Seam repaired',fileIds:[],at:'2026-10-13T08:00:00Z',actorId:'warehouse-user',actor:'Warehouse'};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const state=createMistState({id:()=>'',actorName:'Test',now:'2026-10-13T08:00:00Z'},'empty');state.platform.claims.push({id:'case',code:'CLAIM',state:'Processing',fileIds:[],dispositions:[]} as any);bridge.value={state,workspace:{id:'space'},saving:false,pending:null,downloadFile:vi.fn(),uploadFile:vi.fn()};host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
function render(jobs:ClaimRepairJob[],canInspect?:(domain:'fabric'|'garment')=>boolean){const command=vi.fn(async()=>({})),openEditor=vi.fn(),goods={id:'goods',claimId:'case',repairs:jobs} as PlatformClaimGoods;act(()=>root.render(<MistRoot><ToastProvider><ClaimRepairWork goods={goods} state={bridge.value.state} busy={false} canInspect={canInspect} command={command} openEditor={openEditor}/></ToastProvider></MistRoot>));return{command,openEditor};}
it('allows the matching QC to inspect a shared job without any warehouse rows and submits its exact repair id',async()=>{
 const action=render([structuredClone(job)],domain=>domain==='garment');expect(bridge.value.state.fulfillment.stock).toEqual([]);expect(host.textContent).toContain('待复检');await act(async()=>getByRole(host,'button',{name:'登记复检'}).click());
 const spec=action.openEditor.mock.calls[0][0];expect(spec.title).toBe('返修复检');expect(spec.fields.find((row:any)=>row.key==='batch').readonly).toBe(true);expect(spec.initialValues.batch).toBe('LOT-1 · 1 件');await spec.submit({result:'fail',checkedAt:'2026-10-13',basis:'Seam recheck failed',fileId:''});expect(action.command).toHaveBeenCalledWith({type:'fulfillment.claimInventory.repair.qc',payload:{goodsId:'goods',repairId:'repair-new',result:'fail',checkedAt:'2026-10-13',basis:'Seam recheck failed',fileIds:[]}});
});
it('keeps inspection unavailable to a reader and the other business line QC',()=>{render([structuredClone(job)],domain=>domain==='fabric');expect(queryByRole(host,'button',{name:'登记复检'})).toBeNull();expect(host.textContent).toContain('LOT-1');});
it('shows old results but offers only the latest uninspected repair',async()=>{
 const old={...structuredClone(job),id:'old',qc:{id:'check',result:'fail' as const,checkedAt:'2026-10-13',basis:'Failed first repair',fileIds:[],at:job.at,actorId:'qc',actor:'QC'}};const action=render([old,structuredClone(job)],()=>true);expect(host.textContent).toContain('复检不合格');expect(getAllByRole(host,'button',{name:'登记复检'})).toHaveLength(1);await act(async()=>getByRole(host,'button',{name:'登记复检'}).click());expect(action.openEditor.mock.calls[0][0].description).toContain('LOT-1');
});
it('does not offer inspection after a recorded verdict or after the case closes',()=>{
 const checked={...structuredClone(job),qc:{id:'check',result:'pass' as const,checkedAt:'2026-10-13',basis:'Passed',fileIds:[],at:job.at,actorId:'qc',actor:'QC'}};render([checked],()=>true);expect(host.textContent).toContain('复检合格');expect(queryByRole(host,'button',{name:'登记复检'})).toBeNull();bridge.value.state.platform.claims[0].state='Closed';render([structuredClone(job)],()=>true);expect(queryByRole(host,'button',{name:'登记复检'})).toBeNull();
});

it('shows physical transfer history before any repair job and keeps a returned provider fixed in the new repair record',async()=>{
 const state=bridge.value.state;state.market.suppliers.push({id:'factory',name:'Repair provider',status:'active'});state.fulfillment.warehouses.push({id:'home',name:'Home site',active:true},{id:'site',name:'External site',active:true,supplierId:'factory'});
 const record={id:'received',warehouseId:'home',stockId:'stock',location:'Hold area',batchNumber:'LOT-1',quantity:1,unit:'件'} as any;
 state.fulfillment.receivedRecords.push(record);const trip={id:'trip',receivedEventId:'received',stockId:'stock',batchNumber:'LOT-1',originWarehouseId:'home',originWarehouseName:'Home site',originLocation:'Hold area',quantity:1,unit:'件',supplierId:'factory',supplierName:'Repair provider',warehouseId:'site',warehouseName:'External site',address:'Physical address',location:'Repair desk',date:'2026-10-13',recipient:'Factory recipient',reference:'OUT-1',basis:'Actual dispatch',fileIds:[],at:job.at,actorId:'warehouse-user',actor:'Warehouse',movementId:'move-out'};
 const goods={id:'goods',claimId:'case',repairs:[],repairDispatches:[trip]} as unknown as PlatformClaimGoods,command=vi.fn(async()=>({}));
 act(()=>root.render(<Nav.Provider value={{route:{view:'claims',id:'case'},go:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><MistRoot><ToastProvider><ClaimRepairWork goods={goods} state={state} busy={false}/></ToastProvider></MistRoot></Nav.Provider>));expect(host.textContent).toContain('外修中');await act(async()=>getByRole(host,'button',{name:'送修记录'}).click());expect(host.textContent).toContain('Physical address');expect(host.textContent).toContain('OUT-1');
 const dispatch=repairDispatchSpec(state,goods,record,command);expect(dispatch.initialValues.warehouseId).toBe('');expect(dispatch.initialValues.origin).toBe('Home site · Hold area');expect(dispatch.fields.find(f=>f.key==='origin')?.readonly).toBe(true);await dispatch.submit({warehouseId:'site',location:'Repair desk',date:'2026-10-13',recipient:'Factory recipient',reference:'OUT-2',basis:'Actual handover',fileId:''});expect(command).toHaveBeenLastCalledWith(expect.objectContaining({type:'fulfillment.claimInventory.repair.dispatch',payload:expect.objectContaining({warehouseId:'site',supplierId:'factory',receivedEventId:'received'})}));
 const returned=repairReturnSpec(state,goods,record,trip as any,command);expect(returned.initialValues.place).toBe('Home site · Hold area');
 Object.assign(trip,{returned:{date:'2026-10-13',warehouseId:'home',warehouseName:'Home site',location:'Hold area',recipient:'Receiver',reference:'BACK-1',basis:'Returned batch',fileIds:[],actor:'Warehouse',actorId:'warehouse-user',at:job.at,movementId:'move-back'}});const repair=repairRecordSpec(state,goods,record,command);expect(repair.fields.find(f=>f.key==='supplierId')?.readonly).toBe(true);expect(repair.initialValues.place).toBe('External site · Repair desk');
 state.market.suppliers[0].status='paused';state.market.suppliers[0].statusFrom='2000-01-01';expect(repairDispatchSpec(state,goods,record,command).fields.find(f=>f.key==='warehouseId')?.options?.some(o=>o.value==='site')).toBe(false);
 state.fulfillment.receivedRecords=[];state.fulfillment.warehouses=[];act(()=>root.render(<Nav.Provider value={{route:{view:'claims',id:'case'},go:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><MistRoot><ToastProvider><ClaimRepairWork goods={goods} state={state} busy={false}/></ToastProvider></MistRoot></Nav.Provider>));expect(host.textContent).toContain('LOT-1');await act(async()=>getByRole(host,'button',{name:'返库记录'}).click());expect(host.textContent).toContain('Home site · Hold area');expect(host.textContent).toContain('BACK-1');
});

it('identifies repeated repair rounds without changing old results or adding explanations',()=>{
 const first={...structuredClone(job),id:'first',qc:{id:'qc-first',result:'fail' as const,checkedAt:'2026-10-13',basis:'Failed',fileIds:[],at:job.at,actorId:'qc',actor:'QC'}},second={...structuredClone(job),id:'second'};
 const before=structuredClone([first,second]);render([first,second],()=>true);expect(host.textContent).toContain('维修 1');expect(host.textContent).toContain('维修 2');expect([first,second]).toEqual(before);
});
