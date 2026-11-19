// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { MistRoot } from '../../../../components/mist';
import { createMistState } from '../../../../server/src/shared/mistWorkspace';
import { AgentProposalDialog } from './AgentProposalDialog';

function reopenProposalFixture(){
 const state=createMistState({id:()=>crypto.randomUUID(),now:'2026-11-18T04:00:00Z',actorName:'业务员'},'empty');
 state.devs=[{id:'dev-private',code:'DEV-27',name:'羊毛外套',currentVersionId:'version-private',versionIds:['version-private'],closure:{id:'close-private',kind:'archived',at:'2026-11-18T04:00:00Z',by:'业务员',reason:'样衣阶段已告结束'}}as any];state.versions=[{id:'version-private',devId:'dev-private',label:'R2-A-2'}as any];
 const proposal:any={id:'restore-proposal',ownerId:'owner',owner:'业务员',state:'pending',createdAt:'2026-11-18T04:00:00Z',summary:['development.reopen dev-private closureId close-private expectedVersionId version-private'],command:{type:'development.reopen',payload:{devId:'dev-private',closureId:'close-private',expectedVersionId:'version-private',reason:'继续下一轮版型核对'}}};
 return{state,proposal};
}
it('presents a restore proposal as the exact business case/version and both reasons without exposing or trusting technical tokens',()=>{
 const{state,proposal}=reopenProposalFixture();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));const text=document.body.textContent!;
  for(const value of['恢复开发案','开发案 · DEV-27 · 羊毛外套','当前版本 · R2-A-2','关闭状态 · 已归档','原关闭原因 · 样衣阶段已告结束','本次恢复原因 · 继续下一轮版型核对','中风险'])expect(text).toContain(value);
  for(const value of['dev-private','close-private','version-private','devId','closureId','expectedVersionId','development.reopen'])expect(text).not.toContain(value);expect(getConfirm(host).disabled).toBe(false);
 }finally{act(()=>root.unmount());host.remove();}
});
it.each(['unread','case','version','foreign-version','closure','cycle','current-version','forged-token','empty-reason','extra-field'])('blocks restore confirmation after %s changes while keeping owner rejection available',async kind=>{
 const{state,proposal}=reopenProposalFixture();let visible:any=state;const run=vi.fn(async()=>({}));(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={visible} run={run} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));render();expect(getConfirm(host).disabled).toBe(false);
  if(kind==='unread')visible=null;else if(kind==='case')state.devs=[];else if(kind==='version')state.versions=[];else if(kind==='foreign-version')state.versions[0].devId='another-case';else if(kind==='closure')delete state.devs[0].closure;else if(kind==='cycle')state.devs[0].closure!.id='new-close-same-clock';else if(kind==='current-version')state.devs[0].currentVersionId='new-version';else if(kind==='forged-token')proposal.command.payload.closureId='forged';else if(kind==='empty-reason')proposal.command.payload.reason=' ';else proposal.command.payload.hiddenChange='unreviewed';render();expect(getConfirm(host).disabled).toBe(true);
  const reject=[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()==='拒绝')!;expect(reject.disabled).toBe(false);for(const value of['dev-private','close-private','version-private','closureId','expectedVersionId'])expect(document.body.textContent).not.toContain(value);
  if(kind==='unread'){await act(async()=>reject.click());expect(run).toHaveBeenCalledWith({type:'agent.proposal.reject',payload:{id:'restore-proposal'}},undefined);}
 }finally{act(()=>root.unmount());host.remove();}
});

function orderProposalFixture(){
 const state=createMistState({id:()=> 'id',now:'2026-11-15T00:00:00Z',actorName:'Test'},'empty');
 state.customers=[{id:'customer-private',name:'Harborline Brands',code:'HLB'} as any];
 state.members=[{userId:'owner-private',name:'沈禾'} as any];state.files=[{id:'file-private',name:'HLB-01.pdf'} as any];
 state.market.products=[{id:'product-private',name:'再生涤纶塔丝隆',sku:'HLB-T01'} as any];
 const command={type:'order.create',payload:{type:'fabric',customerId:'customer-private',season:'SS28',currency:'GBP',due:'2026-12-28',ownerId:'owner-private',governance:{kind:'external',poNumber:'HLB-01',confirmationFileIds:['file-private'],internalPurpose:'',receiver:'',paymentMethod:'TT',depositPercent:100,preShipmentPercent:100,paymentNote:'T/T 100% 预付',incoterm:'FOB',deliveryPlace:'上海',overPercent:0,shortPercent:0},lines:[{name:'再生涤纶塔丝隆',nameEn:'Recycled polyester taslon',style:'HLB-T01',img:'clay',qty:10,unit:'米',price:1.95,sourceProductId:'product-private',breakdown:{kind:'fabric',composition:'再生涤纶100%',width:150,weight:110,rows:[{color:'Navy / HB-N01',quantity:10}]}}]}};
 const proposal={id:'p',ownerId:'u',owner:'陆衡',summary:['创建订单'],state:'pending',createdAt:'2026-11-15',command};return{state,proposal};
}
function contractProposalFixture(){
 const{state,proposal:original}=orderProposalFixture(),contract={...original.command.payload.governance,confirmationFileIds:[] as string[]};
 state.orders=[{id:'order-private',code:'SO-G-22',governance:{status:'draft',contract}} as any];
 const proposal:any={id:'contract-proposal',ownerId:'u',owner:'顾言',summary:['保存订单合同草稿'],state:'pending',createdAt:'2026-11-18',command:{type:'order.governance.saveDraft',payload:{orderId:'order-private',input:{...contract,confirmationFileIds:['file-private']}}}};
 return{state,proposal};
}
it('identifies a contract proposal by its order and original filename without presenting unchanged inputs as changes',()=>{
 const{state,proposal}=contractProposalFixture();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));const text=host.textContent!;
  expect(text).toContain('订单 · SO-G-22');expect(text).toContain('客户依据 · 第1项 · HLB-01.pdf');
  for(const value of ['order-private','file-private','input ·','付款方式 · TT','定金比例（%） · 100'])expect(text).not.toContain(value);
  expect(getConfirm(host).disabled).toBe(false);
 }finally{act(()=>root.unmount());host.remove();}
});
it.each(['order','file'])('blocks a saved contract proposal after its %s source becomes invisible',kind=>{
 const{state,proposal}=contractProposalFixture();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));render();expect(getConfirm(host).disabled).toBe(false);
  if(kind==='order')state.orders=[];else state.files=[];render();expect(getConfirm(host).disabled).toBe(true);expect(host.textContent).toContain('订单或来源资料已不可见，请重新核对');
 }finally{act(()=>root.unmount());host.remove();}
});
it('identifies the assigned owner and priced line, permits new proposed lines, and blocks another order line',()=>{
 const{state,proposal}=contractProposalFixture();state.orders[0].currency='GBP';state.orderLines=[{id:'line-private',orderId:'order-private',style:'HLB-T01',name:'塔丝隆',qty:10,unit:'米',price:1.95} as any];
 proposal.command.payload.orderPatch={ownerId:'owner-private'};proposal.command.payload.lines=[{...state.orderLines[0],price:2.25,img:'clay'}];
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));render();
  expect(host.textContent).toContain('负责人 · 沈禾');expect(host.textContent).toContain('单价 · 2.25 GBP');expect(host.textContent).not.toContain('line-private');expect(host.textContent).not.toContain('owner-private');expect(host.textContent).not.toContain('img ·');
  state.orderLines=[];render();expect(getConfirm(host).disabled).toBe(false);expect(host.textContent).toContain('HLB-T01');expect(host.textContent).not.toContain('line-private');
  state.orderLines=[{id:'line-private',orderId:'another-order',style:'OTHER'} as any];render();expect(getConfirm(host).disabled).toBe(true);
 }finally{act(()=>root.unmount());host.remove();}
});
it('presents an order draft as named business objects, full terms and an exact currency total',()=>{
 const{state,proposal}=orderProposalFixture();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal as any} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));const text=host.textContent!;
  for(const value of ['客户 · Harborline Brands','负责人 · 沈禾','客户依据 · 第1项 · HLB-01.pdf','订单总金额 · 19.50 GBP','来源产品 · 再生涤纶塔丝隆','面料','外部客户订单','门幅（cm） · 150','克重（g/m²） · 110','出运前累计收款（%） · 100'])expect(text).toContain(value);
  for(const value of ['customer-private','owner-private','file-private','product-private','governance','breakdown','img ·','clay','fabric','external'])expect(text).not.toContain(value);
  expect(getConfirm(host).disabled).toBe(false);
 }finally{act(()=>root.unmount());host.remove();}
});
it.each(['customer','member','file','product'])('blocks an order draft when its named %s reference is no longer visible',kind=>{
 const{state,proposal}=orderProposalFixture();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal as any} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));render();expect(getConfirm(host).disabled).toBe(false);
  if(kind==='customer')state.customers=[];if(kind==='member')state.members=[];if(kind==='file')state.files=[];if(kind==='product')state.market.products=[];render();expect(getConfirm(host).disabled).toBe(true);expect(host.textContent).toContain('订单或来源资料已不可见，请重新核对');
 }finally{act(()=>root.unmount());host.remove();}
});
it('shows all fields of a larger medium risk order and blocks confirmation when the display limit is exceeded',()=>{
 const{state,proposal}=orderProposalFixture();proposal.command.payload.lines=Array.from({length:4},(_,i)=>({...proposal.command.payload.lines[0],style:'款号'+i}));(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal as any} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));render();expect(host.textContent).toContain('订单总金额 · 78.00 GBP');expect(host.textContent).toContain('款号3');expect(host.textContent).not.toContain('项未显示');expect(getConfirm(host).disabled).toBe(false);
  proposal.command.payload.lines=Array.from({length:40},()=>proposal.command.payload.lines[0]);render();expect(host.textContent).toContain('项未显示');expect(getConfirm(host).disabled).toBe(true);
 }finally{act(()=>root.unmount());host.remove();}
});

it.each([false,true])('keeps a rejected confirmation local while preserving an uncertain original request (%s)',async(uncertain)=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const proposal:any={id:'failure-proposal',ownerId:'u',owner:'User',summary:['Update customer'],state:'pending',createdAt:'2026-11-15T00:00:00Z',command:{type:'customer.update',payload:{id:'customer',patch:{city:'York'}}}};
 const failure=Object.assign(new Error('Confirmation failed'),uncertain?{mistPendingCommand:true}:{}),onRejection=vi.fn(),run=vi.fn().mockRejectedValue(failure);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal} run={run} onRejection={onRejection} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));
  await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='确认执行')!.click();});
  expect(document.body.textContent).toContain(uncertain?'结果待核对':'没有执行');
  expect(document.body.textContent).toContain('Confirmation failed');
  expect(onRejection.mock.calls).toEqual(uncertain?[]:[['Confirmation failed']]);
  if(uncertain)for(const label of ['确认执行','拒绝'])expect([...document.querySelectorAll('button')].find(b=>b.textContent===label)!.disabled).toBe(true);
 }finally{act(()=>root.unmount());host.remove();}
});

it.each(['proposal','company'])('does not report a late rejection in a different %s or consume its global failure',async(change)=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const make=(id:string):any=>({id,ownerId:'u',owner:'User',summary:[id],state:'pending',createdAt:'2026-11-15T00:00:00Z',command:{type:'customer.update',payload:{id:'customer',patch:{city:'York'}}}});
 let reject!:(error:Error)=>void;const run=vi.fn(()=>new Promise((_ok,no)=>{reject=no;})),onRejection=vi.fn();
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const show=(id:string,scope='a')=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={make(id)} scopeKey={scope} run={run} onRejection={onRejection} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));
 try{show('old');await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='确认执行')!.click();});show(change==='proposal'?'new':'old',change==='company'?'b':'a');await act(async()=>reject(new Error('Old failure')));expect(document.body.textContent).not.toContain('Old failure');expect(onRejection).not.toHaveBeenCalled();expect([...document.querySelectorAll('button')].find(b=>b.textContent==='确认执行')!.disabled).toBe(false);}
 finally{act(()=>root.unmount());host.remove();}
});

it('identifies supplier quote sources and filenames before allowing confirmation',()=>{
 const state=createMistState({id:()=> 'id',now:'2026-11-14T00:00:00Z',actorName:'Test'},'empty');
 state.market.suppliers=[{id:'supplier-private',name:'江南成衣'} as any];state.files=[{id:'file-private',name:'CMT-V2.pdf'} as any];state.rfqs=[{id:'rfq-private',code:'RFQ-2026-0003',state:'open',unit:'件',supplierIds:['supplier-private'],quotes:[]} as any];
 const proposal={id:'p',ownerId:'u',owner:'顾言',summary:['更新供应报价'],state:'pending',createdAt:'2026-11-14',command:{type:'rfq.quote',payload:{id:'rfq-private',supplierId:'supplier-private',price:'131.25',currency:'CNY',moq:'50',promisedDue:'2026-12-20',validUntil:'2026-11-30',terms:'20%预付',fileIds:['file-private']}}};
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal as any} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));const confirmButton=()=>getConfirm(host);render();const text=host.textContent!;
  for(const value of ['询价单 · RFQ-2026-0003','供应商 · 江南成衣','CMT-V2.pdf','承诺交期 · 2026-12-20','报价有效期 · 2026-11-30','单价 · 131.25'])expect(text).toContain(value);
  for(const value of ['rfq-private','supplier-private','file-private','fileIds','promisedDue','validUntil','moq ·'])expect(text).not.toContain(value);expect(confirmButton().disabled).toBe(false);
  const files=state.files;state.files=[];render();expect(confirmButton().disabled).toBe(true);state.files=files;state.rfqs=[];render();expect(confirmButton().disabled).toBe(true);
 }finally{act(()=>root.unmount());host.remove();}
});
it('identifies the exact awarded quote and blocks a superseded quote source',()=>{
 const state=createMistState({id:()=> 'id',now:'2026-11-14T00:00:00Z',actorName:'Test'},'empty'),quote={id:'quote-private',supplierId:'supplier-private',supplier:'江南成衣',price:131.25,currency:'CNY',fileIds:[],declined:false};state.rfqs=[{id:'rfq-private',code:'RFQ-2026-0003',state:'open',unit:'件',supplierIds:['supplier-private'],quotes:[quote]} as any];
 const proposal={id:'p',ownerId:'u',owner:'顾言',summary:['定标'],state:'pending',createdAt:'2026-11-14',command:{type:'rfq.award',payload:{id:'rfq-private',quoteId:'quote-private',reason:'按有效报价'}}};(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal as any} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));render();expect(host.textContent).toContain('江南成衣 · 131.25 CNY/件');expect(host.textContent).not.toContain('quote-private');(quote as any).supersededAt='2026-11-14T01:00:00Z';render();expect(getConfirm(host).disabled).toBe(true);
 }finally{act(()=>root.unmount());host.remove();}
});
function getConfirm(host:HTMLElement){return [...host.querySelectorAll('button')].find(b=>b.textContent==='确认执行')!;}

it('shows precise proposed mail values and evidence, and disables confirmation when the analyzed source is stale', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const state = createMistState({ id: () => 'id', now: '2026-11-01T00:00:00Z', actorName: 'Test' }, 'demo'), mail = state.email.messages[0];
  mail.analysis = { id: 'a', at: '', actor: '', sourceHash: '', category: '订单往来', summary: '', fields: [{ id: 'qty', field: '数量', value: '120 pcs', source: 'body', quote: 'Quantity: 120 pcs.' }], warnings: [], truncated: false, attachmentCount: 0 };
  const proposal = { id: 'p', ownerId: 'u', owner: '顾言', summary: ['复核邮件资料'], state: 'pending' as const, createdAt: '2026-11-01T00:00:00Z', command: { type: 'email.extraction.review', payload: { id: mail.id, analysisId: 'a', category: '订单往来', fields: [{ id: 'qty', value: '120 pcs（待确认）' }], note: '保留请求语气' } } };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), run = vi.fn().mockResolvedValue({});
  const render = () => root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={run} onClose={() => {}} onDone={() => {}} /></MistRoot>);
  try {
    act(render); expect(document.body.textContent).toContain('120 pcs（待确认）'); expect(document.body.textContent).toContain('Quantity: 120 pcs.'); expect(document.body.textContent).toContain('保留请求语气');
    mail.analysis.id = 'changed'; act(render);
    expect(document.body.textContent).toContain('邮件或整理版本已变化');
    const confirm = [...document.querySelectorAll('button')].find(b => b.textContent === '确认执行')!;
    expect(confirm.disabled).toBe(true); await act(async () => confirm.click()); expect(run).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); host.remove(); }
});

it('shows the risk tier; medium lists fields to change, high requires the login password and sends it only with the confirmation', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const base = { id: 'p', ownerId: 'u', owner: '林舒', summary: ['Agent 提议'], state: 'pending' as const, createdAt: '2026-11-01T00:00:00Z' };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), run = vi.fn().mockResolvedValue({});
  const show = (proposal: any) => act(() => root.render(<MistRoot><AgentProposalDialog proposal={proposal} run={run} onClose={() => {}} onDone={() => {}} /></MistRoot>));
  const confirmButton = () => [...document.querySelectorAll('button')].find(b => b.textContent === '确认执行')!;
  try {
    show({ ...base, command: { type: 'customer.update', payload: { id: 'c1', patch: { name: '新客户名', terms: 'T/T 30%' } } } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('medium');
    const changes = document.querySelector('[data-agent-proposal-changes]')?.textContent || '';
    expect(changes).toContain('名称 · 新客户名'); expect(changes).toContain('条款 · T/T 30%'); expect(changes).not.toContain('patch');
    expect(document.querySelector('input[type="password"]')).toBeNull(); expect(confirmButton().disabled).toBe(false);

    show({ ...base, id: 'p2', command: { type: 'payable.payment.register', payload: { requestId: 'r', amount: 100 } } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('high');
    // 权限码是实现细节，界面只显示风险等级（服务端仍校验 ai:write:high）。
    expect(document.body.textContent).not.toContain('ai:write');
    // 高风险同样列出将要执行的内容，不能只给摘要和密码框。
    expect(document.querySelector('[data-agent-proposal-changes]')?.textContent).toContain('金额 · 100');
    const input = document.querySelector('input[type="password"]') as HTMLInputElement; expect(input).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Secret-1'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(confirmButton().disabled).toBe(false);
    await act(async () => confirmButton().click());
    expect(run).toHaveBeenCalledWith({ type: 'agent.proposal.confirm', payload: { id: 'p2' } }, { reauth: { password: 'Secret-1' } });

    // 目录外的普通写入按规则为中风险（用户 2026-11-02 定案：只有付款、核销、审批类为高风险），不要求密码。
    run.mockClear(); show({ ...base, id: 'p3', command: { type: 'unregistered.command', payload: {} } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('medium');
    expect(document.querySelector('input[type="password"]')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});

it('high-risk bank account changes show the full new account beside the current one before the password is entered', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const state = createMistState({ id: () => 'id', now: '2026-11-01T00:00:00Z', actorName: 'Test' }, 'demo');
  state.bankAccounts = [{ id: 'ba1', code: 'BA-001', name: '美元户', bankName: '中国银行上海分行', accountNo: '4567000011112222', currency: 'USD', openingDate: '2026-10-01', openingBalance: 0, createdAt: '', actor: '' }];
  const base = { ownerId: 'u', owner: '林舒', summary: ['修改银行账户 BA-001'], state: 'pending' as const, createdAt: '2026-11-01T00:00:00Z' };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const show = (proposal: any) => act(() => root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={() => {}} onDone={() => {}} /></MistRoot>));
  try {
    show({ ...base, id: 'b1', command: { type: 'finance.account.save', payload: { id: 'ba1', name: '美元户', bankName: '招商银行苏州分行', accountNo: '6214 8899 0000 1234', currency: 'usd', openingDate: '2026-10-01', openingBalance: 0 } } });
    expect(document.querySelector('[data-agent-proposal-risk]')?.getAttribute('data-agent-proposal-risk')).toBe('high');
    const account = document.querySelector('[data-agent-proposal-account]')!;
    expect(account.textContent).toContain('6214889900001234'); expect(account.textContent).toContain('4567000011112222');
    expect(account.textContent).toContain('招商银行苏州分行'); expect(account.textContent).toContain('中国银行上海分行');
    expect(account.querySelectorAll('[data-changed]').length).toBe(2);
    expect(document.querySelector('[data-agent-proposal-changes]')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeTruthy();

    state.market.suppliers[0].bankAccounts = [{ id: 'sb1', currency: 'CNY', accountName: '江南成衣', bankName: '工商银行', accountNo: '1111222233334444', verification: '电话核实', addedAt: '', addedBy: '', state: 'active' }];
    show({ ...base, id: 'b2', command: { type: 'market.supplier.bank.save', payload: { supplierId: state.market.suppliers[0].id, currency: 'CNY', accountName: '江南成衣', bankName: '农业银行', accountNo: '9999888877776666', verification: '按合同电话回拨核实' } } });
    const supplier = document.querySelector('[data-agent-proposal-account]')!;
    expect(supplier.textContent).toContain(state.market.suppliers[0].name); expect(supplier.textContent).toContain('9999888877776666');
    expect(supplier.textContent).toContain('1111222233334444'); expect(supplier.textContent).toContain('按合同电话回拨核实');
  } finally { act(() => root.unmount()); host.remove(); }
});

it('high-risk proposals list every array item untruncated, and block confirmation when the content exceeds what the dialog can show', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const state = createMistState({ id: () => 'id', now: '2026-11-01T00:00:00Z', actorName: 'Test' }, 'demo');
  const base = { ownerId: 'u', owner: '林舒', summary: ['分配付款'], state: 'pending' as const, createdAt: '2026-11-01T00:00:00Z' };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const show = (proposal: any) => act(() => root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={() => {}} onDone={() => {}} /></MistRoot>));
  const confirmButton = () => [...document.querySelectorAll('button')].find(b => b.textContent === '确认执行')!;
  const fill = () => { const input = document.querySelector('input[type="password"]') as HTMLInputElement; act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Secret-1'); input.dispatchEvent(new Event('input', { bubbles: true })); }); };
  try {
    const allocations = Array.from({ length: 5 }, (_, i) => ({ billId: 'AP-' + (i + 1), amount: 1000 + i }));
    const longNote = '核对依据'.repeat(80);
    show({ ...base, id: 'a1', command: { type: 'payable.payment.allocate', payload: { paymentId: 'PAY-1', allocations, note: longNote } } });
    const text = document.querySelector('[data-agent-proposal-changes]')!.textContent!;
    for (let i = 1; i <= 5; i++) expect(text).toContain('分配 · 第' + i + '项 · 应付单 · AP-' + i);
    expect(text).toContain(longNote); expect(text).not.toContain('…');
    fill(); expect(confirmButton().disabled).toBe(false);

    show({ ...base, id: 'a2', command: { type: 'payable.payment.allocate', payload: { paymentId: 'PAY-2', allocations: Array.from({ length: 150 }, (_, i) => ({ billId: 'AP-' + i, amount: i })) } } });
    expect(document.body.textContent).toContain('内容过多，无法在此完整核对');
    fill(); expect(confirmButton().disabled).toBe(true);

    state.settings.companyProfile = { ...(state.settings.companyProfile as any), bankName: '中国银行苏州分行', bankAccount: '1111222233334444', swift: 'BKCHCNBJ' };
    show({ ...base, id: 'a3', command: { type: 'settings.update', payload: { companyProfile: { bankName: '招商银行苏州分行', bankAccount: '9999 8888 7777 6666', swift: 'CMBCCNBS' } } } });
    const account = document.querySelector('[data-agent-proposal-account]')!.textContent!;
    expect(account).toContain('9999888877776666'); expect(account).toContain('1111222233334444'); expect(account).toContain('CMBCCNBS'); expect(account).toContain('BKCHCNBJ');
    expect(document.querySelector('[data-agent-proposal-changes]')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});

describe('signature on Agent-drafted approvals', () => {
 it('requires the confirming person to sign a contract or money approval before it can run', async () => {
  const { commandRequiresSignature } = await import('../runtime/signatureRules');
  expect(commandRequiresSignature({ type: 'fulfillment.procurement.decide', payload: { id: 'p', decision: 'approved', note: 'ok' } })).toBe(true);
  expect(commandRequiresSignature({ type: 'fulfillment.procurement.decide', payload: { id: 'p', decision: 'rejected', note: 'no' } })).toBe(false);
  expect(commandRequiresSignature({ type: 'finance.receivable.writeoff', payload: { kind: 'badDebt' } })).toBe(true);
  expect(commandRequiresSignature({ type: 'finance.receivable.writeoff', payload: { kind: 'rounding' } })).toBe(false);
  expect(commandRequiresSignature({ type: 'payable.settlement.confirm', payload: {} })).toBe(true);
  expect(commandRequiresSignature({ type: 'market.quotation.decide', payload: { decision: 'approved' } })).toBe(false);
 });
});

it('shows development draft business fields and source filenames without internal wrapper paths',()=>{
 const state=createMistState({id:()=> 'id',now:'2026-11-11T00:00:00Z',actorName:'Test'},'empty');state.drafts=[{id:'draft-private',values:{name:'羊毛大衣'},fileIds:['file-private']} as any];state.files=[{id:'file-private',name:'RFQ.docx'} as any];
 const p={id:'p',ownerId:'u',owner:'顾言',summary:['保存开发草稿'],state:'pending',createdAt:'2026-11-11',command:{type:'development.saveDraft',payload:{draftId:'draft-private',values:{name:'羊毛大衣',style:'NW-31',fabric:'80% wool',kind:'new',target:'',factories:[],sampleQuantity:2},fileIds:['file-private']}}};
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{
  const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={p as any} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));
  const confirmButton=()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='确认执行')!;
  render();const text=host.textContent||'';expect(text).toContain('客户款号 · NW-31');expect(text).toContain('面料 · 80% wool');expect(text).toContain('RFQ.docx');expect(text).not.toContain('draft-private');expect(text).not.toContain('file-private');expect(text).not.toContain('values');expect(confirmButton().disabled).toBe(false);
  const drafts=state.drafts;state.drafts=[];render();expect(host.textContent).toContain('草稿或附件已不可见，请重新核对');expect(confirmButton().disabled).toBe(true);
  state.drafts=drafts;state.files=[];render();expect(host.textContent).toContain('附件已不可见');expect(confirmButton().disabled).toBe(true);
 }
 finally{act(()=>root.unmount());host.remove();}
});

it('shows quotation business references and exact version, and blocks missing sources',()=>{
 const state=createMistState({id:()=> 'id',now:'2026-11-11T00:00:00Z',actorName:'Test'},'empty');
 state.customers=[{id:'customer-private',name:'Cedar & Crown'} as any];state.devs=[{id:'dev-private',code:'DEV-31',currentVersionId:'current-private'} as any];state.versions=[{id:'version-private',devId:'dev-private',label:'R2-B-1'} as any];state.files=[{id:'file-private',name:'RFQ.docx'} as any];state.market.quotations=[{id:'quote-private',code:'QT-2026-0007',revision:1} as any];
 const proposal={id:'p',ownerId:'u',owner:'顾言',summary:['更新报价'],state:'pending',createdAt:'2026-11-11',command:{type:'market.quotation.save',payload:{id:'quote-private',input:{customerId:'customer-private',currency:'USD',fxRate:'7.10',season:'AW27',validUntil:'2026-11-30',deliveryTerms:'FOB Shanghai',paymentTerms:'T/T',fileIds:['file-private'],lines:[{productId:'',sourceDevId:'dev-private',sourceVersionId:'version-private',name:'羊毛大衣',style:'GA-2711',qty:'640',unit:'件',price:'72.50',cost:'58.00',specs:{sizeRange:'M',mainFabric:'双面羊毛'},costBasis:'unverified',family:'garment',marginFloor:{id:'floor-private',version:1,minMarginPercent:'15'}}],approvalHistory:[],requiresApproval:false}}}};
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{
  const render=()=>act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal as any} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));
  const confirmButton=()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='确认执行')!;
  render();const text=host.textContent||'';for(const value of ['报价草稿 · QT-2026-0007','客户 · Cedar & Crown','有效期 · 2026-11-30','报价汇率 · 7.10','来源开发案 · DEV-31','来源版本 · R2-B-1','数量 · 640','单价 · 72.50','RFQ.docx'])expect(text).toContain(value);
  for(const value of ['input','sourceVersionId','-private','marginFloor','costBasis'])expect(text).not.toContain(value);expect(confirmButton().disabled).toBe(false);
  for(const [owner,key]of [[state.market,'quotations'],[state,'customers'],[state,'devs'],[state,'versions'],[state,'files']] as const){const rows=owner[key as keyof typeof owner];(owner as any)[key]=[];render();expect(host.textContent).toContain('报价或来源资料已不可见，请重新核对');expect(confirmButton().disabled).toBe(true);(owner as any)[key]=rows;}
 }
 finally{act(()=>root.unmount());host.remove();}
});

it('shows a customer credit grant with the exact old/new currency values and requires the existing high-risk password',()=>{
 const state=createMistState({id:()=> 'id',now:'2026-11-18T04:00:00Z',actorName:'Test'},'empty');state.customers=[{id:'customer-private',code:'BCS',name:'Birchline',grade:'B',creditLimit:1000,currency:'GBP'} as any];
 const proposal:any={id:'credit-proposal',ownerId:'u',owner:'Manager',summary:['调整信用额度'],state:'pending',createdAt:'2026-11-18',risk:'high',command:{type:'market.customer.update',payload:{id:'customer-private',patch:{creditLimit:2000}}}};
 const host=document.createElement('div'),root=createRoot(host);document.body.append(host);try{act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));const body=document.body.textContent!;for(const text of ['Birchline · BCS','原信用额度','1000.00 GBP','拟设信用额度','2000.00 GBP','高风险','本人登录密码'])expect(body).toContain(text);expect(body).not.toContain('customer-private');expect(body).not.toContain('creditLimit');expect(getConfirm(host).disabled).toBe(true);}finally{act(()=>root.unmount());host.remove();}
});

it('labels customer acceptance facts in an existing finance confirmation proposal',()=>{
 const {state}=orderProposalFixture();state.invoices=[{id:'ar-private',code:'CI-ACCEPTANCE',orderId:'',order:'',customer:'Buyer',currency:'USD',amount:100,open:0,due:'',financeStatus:'pending'}];
 const proposal:any={id:'accept-proposal',ownerId:'u',owner:'财务',summary:['确认应收'],state:'pending',createdAt:'2026-11-18',command:{type:'finance.receivable.due',payload:{invoiceId:'ar-private',acceptanceDate:'2026-11-18',acceptanceBasis:'Customer AC-1 and POD-1'}}};
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{act(()=>root.render(<MistRoot><AgentProposalDialog proposal={proposal} state={state} run={vi.fn()} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));expect(host.textContent).toContain('客户验收日');expect(host.textContent).toContain('验收依据');expect(host.textContent).toContain('Customer AC-1 and POD-1');expect(host.textContent).not.toContain('acceptanceDate');expect(host.textContent).not.toContain('acceptanceBasis');}finally{act(()=>root.unmount());host.remove();}
});
