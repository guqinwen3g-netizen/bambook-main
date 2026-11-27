import { uiText } from '../../../services/interfaceLanguage';
import { writeDevice } from '../../../services/devicePreferences';
// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole,queryByRole} from '@testing-library/dom';
import {createMistState} from '../../../server/src/shared/mistWorkspace';
const bridge=vi.hoisted(()=>({workspace:null as any,sessionKey:'session-a',canAsk:true,fetch:vi.fn(),activity:vi.fn()}));
vi.mock('./runtime/auth',()=>({MistSessionProvider:({children}:any)=>children,useMistSession:()=>({status:'authenticated',sessionKey:bridge.sessionKey,user:{id:bridge.sessionKey,displayName:'Test user',email:'test@example.test',roles:['sales'],permissions:['*'],roleLabels:[]},hasRole:()=>false,hasPermission:()=>bridge.canAsk,canAccessView:()=>true})}));
vi.mock('./runtime/workspace',()=>({MistWorkspaceProvider:({children}:any)=>children,useMistWorkspace:()=>bridge.workspace,mistApiRequest:bridge.activity}));
vi.mock('../../../services/apiService',()=>({apiService:{getAuthHeaders:()=>({'X-Test-Auth':'authenticated'})}}));
vi.mock('./runtime/reviews',()=>({MistReviewButton:()=>null,MistReviewProvider:({children}:{children:React.ReactNode})=>children,useOptionalMistReviews:()=>null}));
vi.mock('./pages/HomePage',()=>({HomePage:()=>null}));
vi.mock('./pages/OrderDetailPage',()=>({OrderDetailPage:()=>null}));
vi.mock('./pages/modules/FulfillmentPages',()=>({FULFILLMENT_PAGES:{}}));
vi.mock('./pages/modules/MarketPages',()=>({MARKET_PAGES:{}}));
vi.mock('./pages/modules/PlatformPages',()=>({PLATFORM_PAGES:{}}));
import {ReferenceApp} from './ReferenceApp';
let root:Root|undefined,host:HTMLDivElement;const originalScroll=HTMLElement.prototype.scrollTo;
const response=(body:unknown,ok=true)=>({ok,json:async()=>
  (body as {mode?:unknown})?.mode==='read_only' ? {contextToken:crypto.randomUUID(),...body as object} : body});
function workspace(id='workspace-a',code='SO-ONE'){let i=0;const state=createMistState({id:()=>`drawer-${++i}`,now:'2026-10-13T00:00:00Z',actorName:'Test'},'empty');state.orders.push({id:'order-a',code,customer:'Fixture customer',state:'Open',currency:'USD',amount:10} as any);return{state,workspace:{id,name:'Test workspace',revision:2},workspaces:[],error:'',loading:false,saving:false,pending:null,run:vi.fn(),refresh:vi.fn()};}
beforeEach(()=>{localStorage.removeItem('bambook.device.locale');(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;bridge.workspace=workspace();bridge.sessionKey='session-a';bridge.canAsk=true;bridge.fetch.mockReset();vi.stubGlobal('fetch',(url:unknown,init?:RequestInit)=>url==='/api/hr/teams/mine'?Promise.resolve({ok:true,json:async()=>({ok:true,teams:[]})}):bridge.fetch(url,init));vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));HTMLElement.prototype.scrollTo=vi.fn();history.replaceState(null,'','/?intro=0&theme=light&view=orders/detail&id=order-a');});
beforeEach(()=>{
  sessionStorage.clear();
  bridge.activity.mockReset().mockImplementation(async (url:string, init?:RequestInit) => url.endsWith('/history-access')
    ? { allowedTokens: JSON.parse(String(init?.body)).tokens } : { items:[] });
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host?.remove();localStorage.removeItem('bambook.device.locale');HTMLElement.prototype.scrollTo=originalScroll;vi.unstubAllGlobals();vi.restoreAllMocks();});
async function mount(){
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(<ReferenceApp/>));
  await act(async()=>{await import('./WorkspaceApp');});
}
async function open(){await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'j',metaKey:true,bubbles:true,cancelable:true})));return getByRole(document.body,'dialog',{name:uiText('小竹')});}
async function click(button:HTMLElement){await act(async()=>button.click());}
it('shows live activity in the sidebar, opens its original task, and hides after completion', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const task = { id:'task-a', name:'核对采购附件', state:'running', executionStage:'tool', currentStep:'读取附件' };
  const change = () => act(async () => window.dispatchEvent(new Event('bambook:agent-task-update')));
  const card = () => host.querySelector<HTMLButtonElement>('.mist-side-ai');
  await mount();
  expect(card()).toBeNull();
  expect(bridge.activity).toHaveBeenCalledWith('/api/mist/workspaces/workspace-a/personal-agent/activity', expect.objectContaining({cache:'no-store'}));
  bridge.activity.mockResolvedValue({items:[task]});
  await change();
  expect(card()?.textContent).toContain('核对采购附件');
  expect(card()?.textContent).toContain('读取附件');
  bridge.activity.mockResolvedValue({items:[{...task,executionStage:'model'}]});
  await change();
  expect(card()?.textContent).toContain('正在等待模型');
  const modelFallbackSince = new Date().toISOString();
  bridge.activity.mockResolvedValue({items:[{...task,executionStage:'model',modelFallbackSince}]});
  await change();
  expect(card()?.textContent).toContain('正在等待备用模型');
  bridge.activity.mockResolvedValue({items:[{...task,executionStage:'model',modelFallbackSince,runnerStatus:'heartbeat_stale'}]});
  await change();
  expect(card()?.textContent).toContain('执行进度暂未更新');
  expect(card()?.textContent).not.toContain('正在等待备用模型');
  await click(card()!);
  expect(Object.fromEntries(new URLSearchParams(location.search))).toMatchObject({view:'assistant',id:'task-a',section:'task-origin'});
  bridge.activity.mockResolvedValue({items:[]});
  await change();
  expect(card()).toBeNull();
});
it('hides offline activity immediately and shows only the fresh result on reconnect', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const task = { id:'task-a', name:'核对采购附件', state:'running', executionStage:'model' };
  bridge.activity.mockResolvedValue({ items: [task] });
  await mount();
  const card = () => host.querySelector('.mist-side-ai');
  expect(card()?.textContent).toContain('正在等待模型');
  let finishOld: (value: unknown) => void = () => {};
  bridge.activity.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  await act(async () => window.dispatchEvent(new Event('bambook:agent-task-update')));
  const oldSignal = bridge.activity.mock.lastCall?.[1]?.signal as AbortSignal;

  online.mockReturnValue(false);
  await act(async () => window.dispatchEvent(new Event('offline')));
  expect(oldSignal.aborted).toBe(true);
  expect(card()).toBeNull();
  await act(async () => window.dispatchEvent(new Event('bambook:agent-task-update')));
  expect(bridge.activity).toHaveBeenCalledTimes(2);

  online.mockReturnValue(true);
  bridge.activity.mockResolvedValue({ items: [{ ...task, state:'queued', retrying:true }] });
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(bridge.activity).toHaveBeenCalledTimes(3);
  expect(card()?.textContent).toContain('等待模型重试');
  await act(async () => finishOld({ items: [task] }));
  expect(card()?.textContent).toContain('等待模型重试');
});
it('discards an activity response from a previous workspace before rendering the new sidebar', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  let complete!: (value: unknown) => void;
  bridge.activity.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await mount();
  const signal = bridge.activity.mock.calls[0][1].signal as AbortSignal;
  bridge.workspace = workspace('workspace-b', 'SO-TWO');
  await act(async () => root!.render(<ReferenceApp/>));
  expect(signal.aborted).toBe(true);
  await act(async () => complete({items:[{id:'old-task',name:'原公司的任务',state:'running'}]}));
  expect(host.querySelector('.mist-side-ai')).toBeNull();
  expect(bridge.activity).toHaveBeenCalledWith('/api/mist/workspaces/workspace-b/personal-agent/activity', expect.anything());
});
async function send(question:string){const drawer=getByRole(document.body,'dialog',{name:uiText('小竹')}),field=getByRole(drawer,'textbox',{name:uiText('输入问题')}) as HTMLTextAreaElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,question);field.dispatchEvent(new Event('input',{bubbles:true}));});await click(getByRole(drawer,'button',{name:uiText('发送')}));}
it('keeps the original drawer and local overview without an automatic model request',async()=>{await mount();const drawer=await open();expect(drawer.textContent).not.toContain('本地记录查询');expect(drawer.textContent).not.toContain('尚未连接模型服务');expect(bridge.fetch).not.toHaveBeenCalled();expect(queryByRole(drawer,'button',{name:'完整版'})).not.toBeNull();});
it('sends no record by default, only the explicit question and bounded history',async()=>{bridge.fetch.mockResolvedValue(response({mode:'read_only',text:'Review this suggestion.',revision:2,sources:[]}));await mount();await open();await send('What should happen next?');expect(bridge.fetch).toHaveBeenCalledTimes(1);const [path,init]=bridge.fetch.mock.calls[0];expect(path).toBe('/api/mist/workspaces/workspace-a/assistant');expect(JSON.parse(init.body)).toEqual({message:'What should happen next?',history:[],sourceIds:[]});expect(init.headers['X-Test-Auth']).toBe('authenticated');expect(document.body.textContent).toContain('Review this suggestion.');expect(bridge.workspace.run).not.toHaveBeenCalled();});
it('includes the current order only after selection and opens its returned source',async()=>{bridge.fetch.mockResolvedValue(response({mode:'read_only',text:'Selected-source reply.',revision:2,sources:[{id:'orders:order-a',entityId:'order-a',label:'SO-ONE',view:'orders/detail'}]}));await mount();const drawer=await open();await click(getByRole(drawer,'button',{name:'引用当前来源：SO-ONE'}));await send('Review this order.');expect(JSON.parse(bridge.fetch.mock.calls[0][1].body).sourceIds).toEqual(['orders:order-a']);await click(getByRole(drawer,'button',{name:'SO-ONE'}));expect(new URLSearchParams(location.search).get('view')).toBe('orders/detail');expect(new URLSearchParams(location.search).get('id')).toBe('order-a');});
it('keeps a failed question with retry and never claims a business write',async()=>{bridge.fetch.mockResolvedValueOnce(response({error:{message:'Server model unavailable'}},false)).mockResolvedValueOnce(response({mode:'read_only',text:'Retried suggestion.',revision:2,sources:[]}));await mount();const drawer=await open();await send('Keep this question.');expect(drawer.textContent).toContain('Keep this question.');expect(drawer.textContent).toContain('Server model unavailable');await click(getByRole(drawer,'button',{name:'重试此问题'}));expect(JSON.parse(bridge.fetch.mock.calls[1][1].body).message).toBe('Keep this question.');expect(drawer.textContent).toContain('Retried suggestion.');expect(bridge.workspace.run).not.toHaveBeenCalled();});
it('retries the same drawer question once with its original business reference', async () => {
  let complete:(reply:unknown)=>void=()=>{};
  bridge.fetch.mockResolvedValueOnce(response({error:{message:'模拟模型暂不可用'}},false))
    .mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  await mount();
  const drawer=await open();
  await click(getByRole(drawer,'button',{name:'引用当前来源：SO-ONE'}));
  await send('核对原始交期');
  const retry=getByRole(drawer,'button',{name:'重试此问题'});
  await act(async()=>{retry.click();retry.click();});
  expect(bridge.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(bridge.fetch.mock.calls[1][1].body)).toEqual(JSON.parse(bridge.fetch.mock.calls[0][1].body));
  expect(drawer.textContent?.match(/核对原始交期/g)).toHaveLength(1);
  await act(async()=>complete(response({mode:'read_only',text:'已重新核对原始交期',revision:2,sources:[]})));
  expect(drawer.textContent).toContain('已重新核对原始交期');
  expect(queryByRole(drawer,'button',{name:'重试此问题'})).toBeNull();
});

it('opens the failed drawer question as an unsent read-only draft without releasing a new request', async () => {
  bridge.fetch.mockResolvedValueOnce(response({error:{message:'模拟查询失败'}},false));
  await mount();
  const drawer=await open();
  await click(getByRole(drawer,'button',{name:'引用当前来源：SO-ONE'}));
  await send('继续核对未完成的问题');
  await click(getByRole(drawer,'button',{name:'完整版'}));
  expect(new URLSearchParams(location.search).get('section')).toBe('read-only');
  expect(bridge.fetch).toHaveBeenCalledTimes(1);
  const again=await open();
  expect(again.textContent).not.toContain('继续核对未完成的问题');
});
it('moves the unsent drawer draft to the full read-only route without posting it', async () => {
  await mount();
  const drawer=await open();
  await click(getByRole(drawer,'button',{name:'引用当前来源：SO-ONE'}));
  const field=getByRole(drawer,'textbox',{name:'输入问题'}) as HTMLTextAreaElement;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'尚未发送的订单问题');
    field.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await click(getByRole(drawer,'button',{name:'完整版'}));
  expect(new URLSearchParams(location.search).get('section')).toBe('read-only');
  expect(bridge.fetch).not.toHaveBeenCalled();
  const again=await open();
  expect((getByRole(again,'textbox',{name:'输入问题'}) as HTMLTextAreaElement).value).toBe('');
});

it('keeps the failed question in the drawer when its source is no longer visible', async () => {
  bridge.fetch.mockResolvedValueOnce(response({error:{message:'模拟查询失败'}},false));
  await mount();
  const drawer=await open();
  await click(getByRole(drawer,'button',{name:'引用当前来源：SO-ONE'}));
  await send('带来源的失败问题');
  bridge.workspace={...bridge.workspace,state:{...bridge.workspace.state,orders:[]}};
  await act(async()=>root!.render(<ReferenceApp/>));
  await click(getByRole(drawer,'button',{name:'完整版'}));
  expect(bridge.fetch).toHaveBeenCalledTimes(1);
  const again=await open();
  expect(again.textContent).toContain('带来源的失败问题');
});

it('rejects a returned source whose entity differs from the requested source',async()=>{bridge.fetch.mockResolvedValue(response({mode:'read_only',text:'Mismatched response',revision:2,sources:[{id:'orders:order-a',entityId:'other-order',label:'Wrong order',view:'orders/detail'}]}));await mount();const drawer=await open();await click(getByRole(drawer,'button',{name:'引用当前来源：SO-ONE'}));await send('Review source');expect(drawer.textContent).toContain('助手响应格式无效');expect(drawer.textContent).not.toContain('Mismatched response');expect(queryByRole(drawer,'button',{name:'Wrong order'})).toBeNull();});
it.each(['workspace','identity'])('aborts and discards an old answer after a %s change',async kind=>{let finish!:(value:any)=>void;bridge.fetch.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await mount();await open();await send('Old private question');const signal=bridge.fetch.mock.calls[0][1].signal as AbortSignal;if(kind==='workspace')bridge.workspace=workspace('workspace-b','SO-TWO');else bridge.sessionKey='session-b';await act(async()=>root!.render(<ReferenceApp/>));expect(signal.aborted).toBe(true);await act(async()=>finish(response({mode:'read_only',text:'Old private answer',revision:2,sources:[]})));await open();expect(document.body.textContent).not.toContain('Old private answer');expect(document.body.textContent).not.toContain('Old private question');});
it('does not expose an assistant or send model requests without ai permission',async()=>{bridge.canAsk=false;await mount();await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'j',metaKey:true,bubbles:true,cancelable:true})));expect(queryByRole(document.body,'dialog',{name:uiText('小竹')})).toBeNull();expect(queryByRole(document.body,'button',{name:uiText('问小竹')})).toBeNull();expect(bridge.fetch).not.toHaveBeenCalled();});
it('provides the full assistant page without replacing the drawer trigger',async()=>{await mount();const drawer=await open();await click(getByRole(drawer,'button',{name:'完整版'}));expect(new URLSearchParams(location.search).get('view')).toBe('assistant');expect(queryByRole(document.body,'dialog',{name:uiText('小竹')})).toBeNull();await open();expect(queryByRole(document.body,'dialog',{name:uiText('小竹')})).not.toBeNull();});

it('carries only verified drawer replies into follow-ups and preserves the receipt on expansion', async () => {
  bridge.fetch.mockResolvedValueOnce(response({mode:'read_only',text:'旧订单答复',revision:2,sources:[],contextToken:'old-token'}))
    .mockResolvedValueOnce(response({mode:'read_only',text:'有效追问结果',revision:2,sources:[],contextToken:'next-token'}))
    .mockResolvedValueOnce(response({mode:'read_only',text:'本轮结果',revision:3,sources:[],contextToken:'fresh-token'}));
  await mount();
  const drawer = await open();
  await send('先核对这张订单');
  await send('继续上一轮');
  expect(JSON.parse(bridge.fetch.mock.calls[1][1].body).history).toEqual([
    {role:'user',content:'先核对这张订单'}, {role:'assistant',content:'旧订单答复',contextToken:'old-token'},
  ]);
  bridge.activity.mockImplementation(async (url:string, init?:RequestInit) => url.endsWith('/history-access')
    ? {allowedTokens:JSON.parse(String(init?.body)).tokens.filter((token:string)=>token==='fresh-token')} : {items:[]});
  bridge.workspace = {...bridge.workspace, workspace:{...bridge.workspace.workspace,revision:3}};
  await act(async()=>root!.render(<ReferenceApp/>));
  expect(drawer.textContent).not.toContain('旧订单答复');
  await send('核对本轮');
  expect(JSON.parse(bridge.fetch.mock.calls[2][1].body).history).toEqual([]);
  await click(getByRole(drawer,'button',{name:'完整版'}));
  expect(new URLSearchParams(location.search).get('section')).toBe('read-only');
  const shared=JSON.parse(sessionStorage.getItem('mist.assistant.conversation:session-a:workspace-a')!);
  expect(shared.messages).toHaveLength(6);
  expect(shared.messages.slice(-2)).toEqual([{role:'user',content:'核对本轮'},expect.objectContaining({
    role:'assistant',content:'本轮结果',contextToken:'fresh-token',revision:3,sources:[],
  })]);
});

it('passes the current device language on every question without saving company settings',async()=>{bridge.fetch.mockResolvedValue(response({mode:'read_only',text:'Short answer.',revision:2,sources:[]}));writeDevice('locale','en-US');await mount();await open();await send('First question');expect(bridge.fetch.mock.calls[0][1].headers['X-Bambook-Locale']).toBe('en-US');await act(async()=>writeDevice('locale','zh-CN'));await send('Second question');const body=JSON.parse(bridge.fetch.mock.calls[1][1].body);expect(bridge.fetch.mock.calls[1][1].headers['X-Bambook-Locale']).toBe('zh-CN');expect(body).not.toHaveProperty('locale');expect(body.history).toContainEqual({role:'assistant',content:'Short answer.',contextToken:expect.any(String)});expect(bridge.workspace.run).not.toHaveBeenCalled();});

it('sends the resolved device language to AI and follows a system language change',async()=>{const languages=vi.spyOn(navigator,'languages','get').mockReturnValue(['en-GB']);bridge.fetch.mockResolvedValue(response({mode:'read_only',text:'Short answer.',revision:2,sources:[]}));writeDevice('locale','system');await mount();await open();await send('Hello');expect(bridge.fetch.mock.calls[0][1].headers['X-Bambook-Locale']).toBe('en-US');languages.mockReturnValue(['zh-CN']);await act(async()=>window.dispatchEvent(new Event('languagechange')));await send('你好');expect(bridge.fetch.mock.calls[1][1].headers['X-Bambook-Locale']).toBe('zh-CN');expect(readLocalPreference()).toBe('system');expect(bridge.workspace.run).not.toHaveBeenCalled();});

function readLocalPreference(){return JSON.parse(localStorage.getItem('bambook.device.locale')!);}
