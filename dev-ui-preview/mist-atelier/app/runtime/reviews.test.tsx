// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getByRole,getByLabelText,queryByRole,queryByText} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../components/mist';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
import {Nav,type Route} from '../nav';

const bridge=vi.hoisted(()=>({session:{sessionKey:'session-a',status:'authenticated',user:{id:'actor-a'},canAccessView:(_:string)=>true} as any,workspaceId:'workspace-a',status:'pending',version:0,listeners:new Set<()=>void>(),refresh:vi.fn(),extra:null as any}));
vi.mock('./auth',()=>({useMistSession:()=>bridge.session}));
vi.mock('./workspace',async()=>{const React=await import('react');const {createMistState}=await import('../../../../server/src/shared/mistWorkspace');const base=createMistState({actorName:'测试',actorId:'actor-a',now:'2026-10-13T00:00:00.000Z',id:()=>crypto.randomUUID()},'empty');return{useMistWorkspace:()=>{React.useSyncExternalStore(listener=>{bridge.listeners.add(listener);return()=>{bridge.listeners.delete(listener);};},()=>bridge.version);return{workspace:{id:bridge.workspaceId,name:'本公司',revision:(bridge as any).revision??1,ownerId:'owner-x'},state:{...base,...(bridge.extra||{}),orderStatus:bridge.status},refresh:bridge.refresh};}};});
vi.mock('../../../../services/apiService',()=>({apiService:{getAuthHeaders:()=>({'Content-Type':'application/json','X-Test-Actor':bridge.session.user.id})}}));
import {useMistWorkspace} from './workspace';
import {MistReviewButton,MistReviewProvider,useMistReviews} from './reviews';
import {ApprovalsPage,approvalRows,projectedReviewEvidence} from '../pages/ApprovalsPage';

let host:HTMLDivElement,root:Root,serverStatus:'pending'|'approved'|'rejected',postCount:number,rows:any[]|undefined;
let intercept:((url:string,init:RequestInit)=>Promise<any>|undefined)|undefined;
const key='bambook.mist.review-pending:actor-a';
const intent={workspaceId:'workspace-a',reviewId:'order:round-one',requestId:'original-request',expectedRevision:1,decision:'approved',note:'核对合同'};
const response=(data:any,status=200)=>({ok:status<400,status,json:async()=>data});
function row(patch:any={}){return{id:'order:round-one',kind:'order',entityId:'order-one',title:'SO-ONE 主单审批',requesterId:'actor-b',reviewerIds:['actor-a'],status:serverStatus,submittedAt:'2026-10-13',requiredPermission:'orders:write',target:{view:'orders/detail',id:'order-one'},details:[{label:'金额',value:'48 USD'}],workspaceId:'workspace-a',workspaceName:'本公司',revision:1,canDecide:serverStatus==='pending',...patch};}
function publish(){bridge.version++;bridge.listeners.forEach(listener=>listener());}
let activeReviews:ReturnType<typeof useMistReviews>;
function Probe(){const workspace=useMistWorkspace();activeReviews=useMistReviews();return <p data-testid="business-state">{workspace.workspace?.id}:{(workspace.state as any).orderStatus}</p>;}
let route:Route={view:'approvals'};const go=vi.fn();
function Harness(){const [current,setCurrent]=React.useState<Route>(route);route=current;go.mockImplementation((view:string,id?:string,target={})=>setCurrent({view,id,...target}));
 return <Nav.Provider value={{route:current,go,theme:'light',toggleTheme:vi.fn(),openAI:vi.fn(),openPalette:vi.fn()} as any}><MistReviewProvider><Probe/><MistReviewButton/>{current.view==='approvals'&&<ApprovalsPage key={JSON.stringify(current)}/>}</MistReviewProvider></Nav.Provider>;}
async function render(){await act(async()=>root.render(<MistRoot><ToastProvider><Harness/></ToastProvider></MistRoot>));}
async function click(name:string|RegExp){await act(async()=>getByRole(document.body,'button',{name}).click());}
function tableRows(){return [...host.querySelectorAll<HTMLElement>('[aria-label="审批事项"] [role="row"][tabindex]')];}
async function openRow(text='SO-ONE'){const target=tableRows().find(r=>r.textContent?.includes(text));expect(target).toBeTruthy();await act(async()=>target!.click());}
async function typeNote(value:string){const input=getByLabelText(document.body,'审批意见') as HTMLTextAreaElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
async function prepareDecision(){await openRow();await typeNote('核对合同通过');}
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(yes=>{resolve=yes;});return{promise,resolve};}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();bridge.listeners.clear();bridge.session={sessionKey:'session-a',status:'authenticated',user:{id:'actor-a'},canAccessView:()=>true};bridge.workspaceId='workspace-a';bridge.status='pending';(bridge as any).revision=1;bridge.version=0;bridge.extra=null;serverStatus='pending';postCount=0;intercept=undefined;rows=undefined;route={view:'approvals'};go.mockReset();
 bridge.refresh=vi.fn(async()=>{bridge.status=serverStatus;publish();});
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit={})=>{
  const intercepted=intercept?.(String(url),init);if(intercepted)return intercepted;
  if(String(url)==='/api/mist/reviews')return response({reviews:bridge.session.user.id==='actor-a'?(rows??[row()]):[]});
  if(String(url).includes('/receipts/'))return response({receipt:{requestId:intent.requestId,revision:2,result:{reviewId:intent.reviewId}}});
  if(init.method==='POST'){postCount++;const body=JSON.parse(String(init.body));serverStatus=body.decision;return response({receipt:{requestId:body.requestId,revision:2,result:{reviewId:intent.reviewId}}});}
  throw new Error('Unexpected request: '+url);
 }));
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

it('withholds empty-state and count during an initial queue read failure, then restores the same list on retry',async()=>{
 intercept=url=>url==='/api/mist/reviews'?Promise.resolve(response({error:{message:'审批服务暂时不可用'}},503)):undefined;
 await render();
 expect(queryByText(document.body,'没有待你审批的事项')).toBeNull();
 expect(getByRole(host,'tab',{name:'待我审批',exact:true})).toBeTruthy();
 expect(getByRole(document.body,'button',{name:'重试',exact:true})).toBeTruthy();
 intercept=undefined;
 await click('重试');
 expect(tableRows().map(r=>r.textContent).join(' ')).toContain('SO-ONE');
 expect(queryByText(document.body,'审批服务暂时不可用')).toBeNull();
 expect(postCount).toBe(0);
});

it('blocks stale approval details after a refresh failure and restores the selection and draft opinion on retry',async()=>{
 await render();
 await prepareDecision();
 intercept=url=>url==='/api/mist/reviews'?Promise.resolve(response({error:{message:'审批服务暂时不可用'}},503)):undefined;
 await click('刷新');
 expect(queryByRole(document.body,'button',{name:'批准',exact:true})).toBeNull();
 expect(queryByRole(document.body,'button',{name:'退回',exact:true})).toBeNull();
 expect(queryByText(document.body,'没有待你审批的事项')).toBeNull();
 intercept=undefined;
 await click('重试');
 expect(getByRole(document.body,'button',{name:'批准',exact:true})).toBeTruthy();
 expect((getByLabelText(document.body,'审批意见') as HTMLTextAreaElement).value).toBe('核对合同通过');
 expect(postCount).toBe(0);
});

it('shows a genuine empty approval queue only after a successful read',async()=>{
 rows=[];
 await render();
 expect(getByRole(host,'tab',{name:/^待我审批\s*0$/})).toBeTruthy();
 expect(queryByText(document.body,'没有待你审批的事项')).toBeTruthy();
});

it('refreshes the current workspace after approval so the existing business page is no longer pending',async()=>{
 await render();await prepareDecision();await click('批准');
 expect(bridge.refresh).toHaveBeenCalledTimes(1);expect(host.querySelector('[data-testid="business-state"]')?.textContent).toBe('workspace-a:approved');
 expect(localStorage.getItem(key)).toBeNull();expect(postCount).toBe(1);
});
it('does not refresh or replace the current workspace when deciding a different workspace',async()=>{
 bridge.workspaceId='workspace-b';await render();await prepareDecision();await click('批准');
 expect(bridge.refresh).not.toHaveBeenCalled();expect(host.querySelector('[data-testid="business-state"]')?.textContent).toBe('workspace-b:pending');expect(postCount).toBe(1);
});
it('refreshes the current workspace when recovering a saved approval receipt without posting another decision',async()=>{
 localStorage.setItem(key,JSON.stringify(intent));serverStatus='approved';await render();await click('核对原请求');
 expect(bridge.refresh).toHaveBeenCalledTimes(1);expect(bridge.status).toBe('approved');expect(postCount).toBe(0);expect(localStorage.getItem(key)).toBeNull();
});
it('does not refresh the workspace selected after the decision started',async()=>{
 const gate=deferred();let requestId='';intercept=(url,init)=>{if(init.method==='POST'){postCount++;requestId=JSON.parse(String(init.body)).requestId;return gate.promise;}return undefined;};
 await render();await prepareDecision();await click('批准');
 bridge.workspaceId='workspace-b';await act(async()=>publish());
 await act(async()=>gate.resolve(response({receipt:{requestId,revision:2,result:{reviewId:intent.reviewId}}})));
 expect(bridge.refresh).not.toHaveBeenCalled();expect(bridge.workspaceId).toBe('workspace-b');
});
it('does not apply a former identity approval response to the new identity workspace',async()=>{
 const gate=deferred();let requestId='';intercept=(url,init)=>{if(init.method==='POST'){postCount++;requestId=JSON.parse(String(init.body)).requestId;return gate.promise;}return undefined;};
 await render();await prepareDecision();await click('批准');
 bridge.session={sessionKey:'session-b',status:'authenticated',user:{id:'actor-b'},canAccessView:()=>true};bridge.workspaceId='workspace-b';await render();
 await act(async()=>gate.resolve(response({receipt:{requestId,revision:2,result:{reviewId:intent.reviewId}}})));
 expect(bridge.refresh).not.toHaveBeenCalled();expect(bridge.workspaceId).toBe('workspace-b');expect(localStorage.getItem(key)).not.toBeNull();expect(localStorage.getItem('bambook.mist.review-pending:actor-b')).toBeNull();
});
it('retains request recovery protection when a response has a mismatched receipt',async()=>{
 intercept=(_url,init)=>init.method==='POST'?Promise.resolve(response({receipt:{requestId:'wrong-request'}})):undefined;
 await render();await prepareDecision();await click('批准');expect(bridge.refresh).not.toHaveBeenCalled();expect(localStorage.getItem(key)).not.toBeNull();
 expect(document.body.textContent).toContain('审批回执与原请求不符');expect(document.body.textContent).toContain('有审批结果待核对');
 expect((getByRole(document.body,'button',{name:'批准'}) as HTMLButtonElement).disabled).toBe(true);
});
it('reports a workspace refresh failure without claiming the saved approval must be posted again',async()=>{
 bridge.refresh=vi.fn(async()=>{throw new Error('本公司读取暂不可用');});await render();await prepareDecision();await click('批准');
 expect(localStorage.getItem(key)).toBeNull();expect(document.body.textContent).toContain('审批已保存');expect(document.body.textContent).toContain('本公司读取暂不可用');expect(queryByText(document.body,'有审批结果待核对')).toBeNull();
});

it('requires a written reason before returning and never posts an empty decision',async()=>{
 await render();await openRow();await click('退回');
 expect(postCount).toBe(0);expect(document.body.textContent).toContain('请填写退回理由');
 await typeNote('单价与合同不符');await click('退回');
 expect(postCount).toBe(1);expect(serverStatus).toBe('rejected');
});
it('keeps unimplemented transfer and permission codes out of the business view',async()=>{
 await render();await openRow();
 expect(queryByRole(document.body,'button',{name:'转交'})).toBeNull();
 expect(document.body.textContent).not.toContain('所需权限');
});
it('shows the submitted snapshot and blocks opening another workspace business record',async()=>{
 rows=[row({workspaceId:'workspace-z',workspaceName:'另一家公司'})];await render();await openRow();
 expect(document.body.textContent).toContain('48 USD');
 expect((getByRole(document.body,'button',{name:'打开原业务'}) as HTMLButtonElement).disabled).toBe(true);
 expect(document.body.textContent).toContain('请先切换到该公司');
});
it('opens a payment approval in the payable section at its exact original request',async()=>{
 rows=[row({kind:'payment',entityId:'payment-one',title:'PR-ONE 付款申请',target:{view:'payment-vouchers',id:'payment-one'}})];
 await render();await openRow('PR-ONE');await click('打开原业务');
 expect(go).toHaveBeenLastCalledWith('payment-vouchers','payment-one',{section:'payables'});
});
it('distinguishes same-title approval rounds in the list and opens the original record', async () => {
  rows = [
    row({ id: 'amendment-one', title: 'PO-001 合同变更', kind: 'procurementAmendment', roundNumber: 1,
      status: 'approved', canDecide: false, details: [{ label: '合同金额', value: '100.00 → 110.00 CNY' }] }),
    row({ id: 'amendment-three', title: 'PO-001 合同变更', kind: 'procurementAmendment', roundNumber: 3,
      status: 'approved', canDecide: false, details: [{ label: '合同金额', value: '110.00 → 120.00 CNY' }] }),
  ];
  route = { view: 'approvals', section: 'done' };
  await render();
  const result = tableRows();
  expect(result).toHaveLength(2);
  expect(result[0].textContent).toContain('第 1 轮');
  expect(result[1].textContent).toContain('第 3 轮');
  await act(async () => result[1].click());
  const detail = document.querySelector('[data-approval="amendment-three"]')!;
  expect(detail.textContent).toContain('110.00 → 120.00 CNY');
  expect(detail.textContent).toContain('审批轮次');
  expect(detail.textContent).toContain('第 3 轮');
  expect(postCount).toBe(0);
});

it('opens the exact business record when the review belongs to the current workspace',async()=>{
 await render();await openRow();await click('打开原业务');
 expect(go).toHaveBeenLastCalledWith('orders/detail','order-one');
});
it('lists my submitted items, including current-workspace requests where I am not a reviewer, as read-only',async()=>{
 bridge.extra={payables:{bills:[],payments:[],allocations:[],plans:[],requests:[{id:'req-1',code:'PR-2026-0001',purpose:'bill',supplierId:'s',supplier:'甲供应商',currency:'CNY',amount:120,lines:[],requesterId:'actor-a',requester:'我',submittedAt:'2026-10-14T02:00:00.000Z',reviewerIds:['boss'],snapshot:[{label:'用途',value:'货款'}],fileIds:[],state:'pending',note:''}]}};
 rows=[];await render();
 await act(async()=>getByRole(host,'tab',{name:/我发起的/}).click());
 await openRow('PR-2026-0001');
 expect(document.body.textContent).toContain('货款');
 expect(queryByRole(document.body,'textbox',{name:'审批意见'})).toBeNull();
 expect(queryByRole(document.body,'button',{name:'批准'})).toBeNull();expect(queryByRole(document.body,'button',{name:'退回'})).toBeNull();expect(getByRole(document.body,'button',{name:'打开原业务'})).toBeTruthy();
});
it('separates pending decisions for me from history and other pending items',()=>{
 const base=row();const list=[base,{...base,id:'b',status:'approved',canDecide:false},{...base,id:'c',canDecide:false,requesterId:'actor-c'},{...base,id:'d',canDecide:false,requesterId:'actor-a'}] as any[];
 expect(approvalRows(list,'mine','actor-a').map(r=>r.id)).toEqual(['order:round-one']);
 expect(approvalRows(list,'done','actor-a').map(r=>r.id)).toEqual(['b']);
 expect(approvalRows(list,'others','actor-a').map(r=>r.id)).toEqual(['c']);
 expect(approvalRows(list,'sent','actor-a').map(r=>r.id)).toEqual(['d']);
});
it('routes the top-bar entry to the approvals page and announces how many items wait for me',async()=>{
 route={view:'cockpit'};await render();
 const button=getByRole(document.body,'button',{name:'审批与放行（1 项待我审批）'});
 await act(async()=>button.click());expect(go).toHaveBeenLastCalledWith('approvals');
 expect(tableRows().length).toBe(1);
});

it('opens and reopens a compact approval after navigation remounts its page', async () => {
 vi.stubGlobal('matchMedia',(query:string)=>({matches:true,media:query,addEventListener(){},removeEventListener(){}}));
 await render();await openRow();
 expect(getByRole(document.body,'dialog',{name:'SO-ONE 主单审批'})).toBeTruthy();
 expect(getByRole(document.body,'button',{name:'批准'})).toBeTruthy();
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(queryByRole(document.body,'dialog',{name:'SO-ONE 主单审批'})).toBeNull();
 await openRow();
 expect(getByRole(document.body,'dialog',{name:'SO-ONE 主单审批'})).toBeTruthy();
 expect(postCount).toBe(0);
});

it('shows the payment approval tier and the level still missing on the approval detail',async()=>{
 rows=[row({id:'payment:pr-1',kind:'payment',entityId:'pr-1',title:'PR-2026-0001 · 华盛毛纺 · 1,000.00 CNY',requiredPermission:'finance:payment_request:approve',target:{view:'payment-vouchers',id:'pr-1'},details:[{label:'本次申请金额',value:'1,000.00 CNY'},{label:'审批档位',value:'申请金额 1,000.00 CNY；需 5 万元及以下档 + 首笔付款加签（总经理级）（该供应商首笔付款）'},{label:'审批进度',value:'已批：5 万元及以下档（财务主管）；还差：首笔付款加签（总经理级）'}]})];
 await render();await openRow('PR-2026-0001');
 const note=host.querySelector('[data-payment-tier]')?.textContent||'';
 expect(note).toContain('需 5 万元及以下档 + 首笔付款加签');expect(note).toContain('还差：首笔付款加签（总经理级）');
});

it('shows a rejected decision inside the approval drawer instead of failing silently',async()=>{
 intercept=(url,init)=>init.method==='POST'?Promise.resolve(response({ok:false,error:{code:'VALIDATION',message:'单价与合同不符'}},422)):undefined;
 try{
  await render();await prepareDecision();await click('退回');
  const banner=document.querySelector('[data-approval-error]');
  expect(banner?.textContent).toContain('单价与合同不符');
  expect(banner?.closest('[data-approval]')).toBeTruthy();
 }finally{intercept=undefined;}
});

it('shows who decided a handled approval, when, and the note',async()=>{
 serverStatus='approved';rows=[{...row({status:'approved',canDecide:false}),signatureFileId:'sig-1',decision:{actor:'周敏',at:'2026-11-05T12:30:00.000Z',note:'单价与交期已核对'}}];
 intercept=(url)=>url.endsWith('/files/sig-1')?Promise.resolve({ok:true,status:200,arrayBuffer:async()=>new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>').buffer}):undefined;
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:()=> 'blob:sig',revokeObjectURL:()=>undefined}));
 try{
  route={view:'approvals',section:'done'} as any;await render();
  const tab=[...document.querySelectorAll('[role="tab"],button')].find(b=>(b.textContent||'').startsWith('已处理')) as HTMLElement|undefined;if(tab)await act(async()=>tab.click());
  await openRow();await act(async()=>{await Promise.resolve();await Promise.resolve();});
  const text=document.body.textContent||'';
  expect(text).toContain('经办人');expect(text).toContain('周敏');expect(text).toContain('单价与交期已核对');
  // 带签字的已批准事项：按图片加载归档签字。
  expect(document.querySelector('[data-approval-signature]')?.getAttribute('src')).toMatch(/^blob:/);
  expect(fetch).toHaveBeenCalledWith('/api/mist/reviews/workspace-a/order%3Around-one/files/sig-1',expect.objectContaining({credentials:'include'}));
 }finally{rows=undefined;intercept=undefined;route={view:'approvals'};}
});

it('reloads the approval queue as soon as the company data revision changes',async()=>{
 rows=[];await render();expect(tableRows()).toHaveLength(0);
 rows=[row({requesterId:'actor-a'})];(bridge as any).revision=2;await act(async()=>{publish();});await act(async()=>{await Promise.resolve();});
 expect(tableRows().some(r=>r.textContent?.includes('SO-ONE'))).toBe(true);
});

function submittedCancellation(signatures:any[],files:any[]){
 bridge.extra={orders:[{id:'own-order',code:'SO-CANCEL',type:'garment',customer:'本票客户',ownerId:'actor-a',governance:{rounds:[],status:'cancelled',cancellation:{id:'own-cancel',status:'approved',reason:'客户书面取消',requesterId:'actor-a',requesterName:'我',reviewerIds:['boss'],requestedAt:'2026-11-18T04:00:00.000Z',decidedBy:'boss',decidedName:'周敏',decidedAt:'2026-11-18T04:00:00.000Z',note:'保留原单历史'}}}],decisionSignatures:signatures,files};
 rows=[];route={view:'approvals',section:'sent'};
}
const cancelSignature=(patch:any={})=>({id:'decision-signature',commandType:'order.governance.decide',entityId:'own-order#cancel:own-cancel',decision:'approved',fileId:'sig-cancel',actorId:'boss',actor:'周敏',at:'2026-11-17T09:32:08.000Z',requestId:'original-cancel-decision',...patch});
function stubSignatureFile(){
 const BaseURL=URL;vi.stubGlobal('URL',class extends BaseURL{static createObjectURL(){return 'blob:local-signature';}static revokeObjectURL(){}});
 intercept=url=>url.endsWith('/files/sig-cancel')?Promise.resolve({ok:true,status:200,arrayBuffer:async()=>new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>').buffer}):undefined;
}
it('shows the exact projected cancellation signature for my submitted read-only row using the company file route',async()=>{
 submittedCancellation([cancelSignature({id:'main-record',requestId:'original-main-decision',entityId:'own-order',fileId:'main-signature'}),cancelSignature()],[{id:'main-signature',name:'主单签字.svg',size:20},{id:'sig-cancel',name:'取消签字.svg',size:30}]);stubSignatureFile();
 await render();await openRow('SO-CANCEL');await act(async()=>{await Promise.resolve();await Promise.resolve();});
 expect(document.querySelector('[data-approval-signature]')?.getAttribute('src')).toBe('blob:local-signature');
 expect(fetch).toHaveBeenCalledWith('/api/mist/workspaces/workspace-a/files/sig-cancel',expect.objectContaining({credentials:'include'}));
 expect(queryByRole(document.body,'button',{name:'批准'})).toBeNull();expect(queryByRole(document.body,'button',{name:'退回'})).toBeNull();expect(postCount).toBe(0);
});
it.each([
 ['another command',{commandType:'fulfillment.procurement.decide'}],
 ['the main order',{entityId:'own-order'}],
 ['another cancellation',{entityId:'own-order#cancel:another'}],
 ['another decision',{decision:'rejected'}],
 ['an absent decision',{decision:undefined}],
])('does not substitute %s as the original cancellation signature',async(_label,patch)=>{
 submittedCancellation([cancelSignature(patch)],[{id:'sig-cancel',name:'不能套用.svg',size:30}]);stubSignatureFile();
 await render();await openRow('SO-CANCEL');
 expect(document.querySelector('[data-approval-signature]')).toBeNull();expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/files/'))).toBe(false);
});
it('does not request a projected signature whose original file is absent from current readable metadata',async()=>{
 submittedCancellation([cancelSignature()],[]);stubSignatureFile();await render();await openRow('SO-CANCEL');
 expect(document.querySelector('[data-approval-signature]')).toBeNull();expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/files/'))).toBe(false);
});
it('fills only current readable attachment metadata for a submitted row and downloads through the company route',async()=>{
 bridge.extra={files:[{id:'evidence-one',name:'本次依据.txt',size:12},{id:'other-evidence',name:'其他业务.txt',size:18}],payables:{bills:[],payments:[],allocations:[],plans:[],requests:[{id:'req-files',code:'PR-FILES',purpose:'bill',supplierId:'s',supplier:'本次供方',currency:'CNY',amount:120,lines:[],requesterId:'actor-a',requester:'我',submittedAt:'2026-10-14T02:00:00.000Z',reviewerIds:['boss'],snapshot:[],fileIds:['evidence-one','hidden-evidence','evidence-one'],state:'pending',note:''}]}};rows=[];route={view:'approvals',section:'sent'};
 const BaseURL=URL;vi.stubGlobal('URL',class extends BaseURL{static createObjectURL(){return 'blob:local-file';}static revokeObjectURL(){}});const anchor=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 intercept=url=>url.endsWith('/files/evidence-one')?Promise.resolve({ok:true,status:200,blob:async()=>new Blob(['本次依据'])}):undefined;
 try{await render();await openRow('PR-FILES');expect(document.body.textContent).toContain('1份附件不可读');expect(queryByRole(document.body,'button',{name:'其他业务.txt'})).toBeNull();expect(document.querySelectorAll('button[data-full-text="本次依据.txt"]')).toHaveLength(1);await click('本次依据.txt');expect(fetch).toHaveBeenCalledWith('/api/mist/workspaces/workspace-a/files/evidence-one',expect.objectContaining({credentials:'include'}));expect(anchor).toHaveBeenCalledTimes(1);expect(postCount).toBe(0);}finally{anchor.mockRestore();}
});
it('never posts a decision for a local read-only submission even when called outside the page controls',async()=>{
 await render();await act(async()=>{expect(await activeReviews.decide({...row(),local:true,canDecide:false},'approved','不能代审批')).toBe(false);});
 expect(postCount).toBe(0);expect(localStorage.getItem(key)).toBeNull();
});
it('does not fetch an old local file after switching the current company projection',async()=>{
 const file={id:'old-file',name:'原公司依据.txt',size:10};await render();bridge.workspaceId='workspace-b';await act(async()=>publish());
 const before=vi.mocked(fetch).mock.calls.length;await act(async()=>activeReviews.download({...row(),workspaceId:'workspace-a',local:true,files:[file]},file));
 expect(vi.mocked(fetch).mock.calls).toHaveLength(before);expect(document.body.textContent).toContain('审批附件读取失败');
});
it('does not borrow a later signature for ambiguous historical rounds sharing one source entity',()=>{
 const first=row({id:'order:first',status:'approved',canDecide:false,decision:{actor:'周敏',at:'2026-11-18T04:00:00.000Z'}}),second={...first,id:'order:second'};
 const evidence=projectedReviewEvidence(first,{files:[{id:'new-signature',name:'新一轮.svg',size:20}] as any,decisionSignatures:[cancelSignature({entityId:first.entityId,fileId:'new-signature'})]},[first,second]);
 expect(evidence.signatureFileId).toBeUndefined();
});
it('does not fall back to an earlier readable signature when the matching final original is hidden',()=>{
 const task=row({status:'approved',decision:{actor:'周敏',at:'2026-11-18T04:00:00.000Z'}});
 const evidence=projectedReviewEvidence(task,{files:[{id:'earlier',name:'旧档.svg',size:20}] as any,decisionSignatures:[cancelSignature({entityId:task.entityId,fileId:'earlier'}),cancelSignature({entityId:task.entityId,fileId:'hidden-final'})]},[task]);
 expect(evidence.signatureFileId).toBeUndefined();
});
it('does not choose the latest of two readable signatures for one unbound approval',()=>{
 const task=row({status:'approved',decision:{actor:'周敏',at:'2026-11-18T04:00:00.000Z'}});
 const evidence=projectedReviewEvidence(task,{files:[{id:'first',name:'第一份.svg',size:20},{id:'second',name:'第二份.svg',size:20}] as any,decisionSignatures:[cancelSignature({id:'first-signature',requestId:'first-request',entityId:task.entityId,fileId:'first'}),cancelSignature({id:'second-signature',requestId:'second-request',entityId:task.entityId,fileId:'second'})]},[task]);
 expect(evidence.signatureFileId).toBeUndefined();
});
it('uses only the exact response-only binding for old rounds and treats an empty binding map as unresolved',()=>{
 const first=row({id:'order:first',status:'approved',decision:{actor:'周敏',at:'2026-11-18T04:00:00.000Z'}}),second={...first,id:'order:second'};
 const state={files:[{id:'first-file',name:'第一轮.svg',size:20},{id:'second-file',name:'第二轮.svg',size:20}] as any,decisionSignatures:[cancelSignature({id:'first-signature',actorId:'actor-a',requestId:'first-request',entityId:first.entityId,fileId:'first-file'}),cancelSignature({id:'second-signature',actorId:'actor-a',requestId:'second-request',entityId:first.entityId,fileId:'second-file'})]};
 const bindings=[{signatureId:'first-signature',reviewId:first.id},{signatureId:'second-signature',reviewId:second.id}];
 expect(projectedReviewEvidence(first,state,[first,second],bindings).signatureFileId).toBe('first-file');
 expect(projectedReviewEvidence(second,state,[first,second],bindings).signatureFileId).toBe('second-file');
 expect(projectedReviewEvidence(first,state,[first,second],[]).signatureFileId).toBeUndefined();
});
it('keeps a server review attachment on its exact review snapshot route outside the selected projection',async()=>{
 bridge.workspaceId='workspace-b';const BaseURL=URL;vi.stubGlobal('URL',class extends BaseURL{static createObjectURL(){return 'blob:review-file';}static revokeObjectURL(){}});const anchor=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 intercept=url=>url.endsWith('/files/review-file')?Promise.resolve({ok:true,status:200,blob:async()=>new Blob(['审批快照依据'])}):undefined;
 try{await render();await act(async()=>activeReviews.download(row(),{id:'review-file',name:'提交时依据.txt'}));expect(fetch).toHaveBeenCalledWith('/api/mist/reviews/workspace-a/order%3Around-one/files/review-file',expect.objectContaining({credentials:'include'}));expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).startsWith('/api/mist/workspaces/'))).toBe(false);expect(postCount).toBe(0);}finally{anchor.mockRestore();}
});
