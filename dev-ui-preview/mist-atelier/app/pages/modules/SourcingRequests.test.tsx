// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getAllByRole,getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {ModuleEditorSpec} from './ModuleWorkbench';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({state:null as MistState|null,workspace:{id:'workspace'},saving:false,pending:null,uploadFile:vi.fn(),downloadFile:vi.fn(),recover:vi.fn()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth',()=>{const session=()=>({user:{id:'buyer',displayName:'Buyer'},sessionKey:'s',hasPermission:()=>true});return{useMistSession:session,useOptionalMistSession:session};});
import {RfqLedger,rfqLedgerExport} from './SourcingRequests';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;const open=vi.fn(),run=vi.fn(),go=vi.fn();
const now='2026-11-14T01:00:00Z';
beforeEach(()=>{
 open.mockReset();run.mockReset();go.mockReset();store.downloadFile.mockReset();store.uploadFile.mockReset();
 const state=createMistState({id:()=>crypto.randomUUID(),now,actorName:'Buyer'},'empty');
 state.orders=[{id:'order',code:'SO-G-1',type:'garment',customer:'Customer',ownerId:'buyer',governance:{status:'approved',contract:{kind:'external'}}}] as any;
 state.orderLines=[{id:'line',orderId:'order',name:'Coat',style:'C-01',qty:80,unit:'件',price:80} as any];
 state.market.suppliers=[{id:'supplier',code:'S',name:'Factory',type:'成衣加工',status:'active',contacts:[],fileIds:[],ratings:[]}] as any;
 state.rfqs=[{id:'rfq',code:'RFQ-1',orderId:'order',lineId:'line',kind:'processing',domain:'garment',description:'Coat CMT',quantity:80,unit:'件',currency:'CNY',due:'2099-01-31',destination:'Factory',deadline:'2099-01-10',supplierIds:['supplier'],quotes:[{id:'current',supplierId:'supplier',supplier:'Factory',declined:false,declineReason:'',price:131.25,currency:'CNY',moq:50,promisedDue:'2099-01-20',terms:'20% advance',validUntil:'2099-01-30',note:'',fileIds:['current-file'],at:now,actor:'Buyer'}],note:'',state:'open',createdAt:now,actor:'Buyer'}];
 state.files=[{id:'current-file',name:'Current quotation.pdf',mimeType:'application/pdf',size:5,storageKey:'current',createdAt:now}];store.state=state;
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(){act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'procurement'},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><RfqLedger state={store.state!} day="2026-11-14" domain="garment" needle="" can locked={false} loading={false} open={open} run={run} onPurchase={vi.fn()} onSupplier={vi.fn()}/></Nav.Provider></ToastProvider></MistRoot>));await act(async()=>getByRole(getByRole(host,'table',{name:'询价单列表'}),'row',{name:/RFQ-1/}).click());}
async function action(label:string){await act(async()=>getAllByRole(document.body,'button',{name:label,exact:true}).at(-1)!.click());return open.mock.calls.at(-1)![0] as ModuleEditorSpec;}
it('exports RFQs from the current domain, exact source and search rather than purchase orders',()=>{
 const state=store.state!,r=state.rfqs[0];state.rfqs.push({...r,id:'fabric',code:'RFQ-F',domain:'fabric'},{...r,id:'other-line',code:'RFQ-OTHER',lineId:'other-line'},{...r,id:'other-search',code:'RFQ-UNMATCHED',description:'Buttons',quotes:[]});
 state.fulfillment.purchases.push({id:'purchase',code:'PO-UNRELATED'} as any);
 const data=rfqLedgerExport(state,'garment','coat','2026-11-14','line');
 expect(data.name).toBe('询价台账');expect(data.rows).toHaveLength(1);expect(data.rows[0].slice(0,5)).toEqual(['RFQ-1','SO-G-1 · C-01','Coat CMT',80,'件']);
 expect(data.rows.flat()).not.toContain('PO-UNRELATED');
});
it('exports the current quoted price and currency while retaining the frozen award source',()=>{
 const state=store.state!,r=state.rfqs[0];r.quotes.unshift({...r.quotes[0],id:'old',price:1,supersededAt:now});
 r.state='awarded';r.award={quoteId:'current',supplierId:'supplier',supplier:'Factory',reason:'Reviewed',flags:[],purchaseId:'po',purchaseCode:'PO-42',at:now,actor:'Buyer'};
 const data=rfqLedgerExport(state,'garment','factory','2026-11-14');const record=Object.fromEntries(data.headers.map((key,i)=>[key,data.rows[0][i]]));
 expect(record).toMatchObject({'已报家数':1,'受邀家数':1,'最低报价':131.25,'币种':'CNY','中标供应商':'Factory','生成采购单':'PO-42'});
});
it('exports no rows for an unmatched search or another source',()=>{
 expect(rfqLedgerExport(store.state!,'garment','unmatched','2026-11-14').rows).toEqual([]);
 expect(rfqLedgerExport(store.state!,'garment','','2026-11-14','unavailable-line').rows).toEqual([]);
});
it('keeps uploaded quotation references on the quote command',async()=>{
 await render();const spec=await action('登记报价');expect(spec.fields.find(f=>f.key==='files')?.type).toBe('files');
 expect(spec.sections?.find(s=>s.id==='delivery')?.fields).toContain('files');
 await spec.submit({supplierId:'supplier',price:'131.25',currency:'CNY',moq:'50',promisedDue:'2099-01-20',terms:'20% advance',validUntil:'2099-01-30',note:'Revised offer',files:'current-file,another-file'});
 expect(run.mock.calls.at(-1)![0]).toMatchObject({type:'rfq.quote',payload:{id:'rfq',supplierId:'supplier',price:'131.25',fileIds:['current-file','another-file']}});
});
it('keeps an optional refusal source separate from the refusal reason',async()=>{
 await render();const spec=await action('登记谢绝');expect(spec.fields.find(f=>f.key==='files')?.type).toBe('files');
 await spec.submit({supplierId:'supplier',declineReason:'No capacity',files:'refusal-file'});
 expect(run.mock.calls.at(-1)![0]).toMatchObject({type:'rfq.quote',payload:{declined:true,declineReason:'No capacity',fileIds:['refusal-file']}});
});
it('shows current and superseded originals but does not reveal an unavailable file name',async()=>{
 const r=store.state!.rfqs[0];r.quotes.unshift({...r.quotes[0],id:'old',fileIds:['old-file','unavailable-file'],price:130,supersededAt:now});
 store.state!.files.push({id:'old-file',name:'Previous quotation.pdf',mimeType:'application/pdf',size:5,storageKey:'old',createdAt:now});
 await render();expect(getAllByRole(document.body,'button',{name:'Current quotation.pdf',exact:true}).length).toBeGreaterThan(0);expect(getAllByRole(document.body,'button',{name:'Previous quotation.pdf',exact:true}).length).toBeGreaterThan(0);
 expect(document.body.textContent).toContain('1份附件不可读');expect(queryByRole(document.body,'button',{name:'unavailable-file'})).toBeNull();expect(run).not.toHaveBeenCalled();
});
