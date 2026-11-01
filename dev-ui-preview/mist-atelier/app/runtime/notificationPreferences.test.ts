import {describe,it,expect} from 'vitest';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
import {mistDailyDigest,visibleMistNotifications} from './notificationPreferences';
it('uses the canonical personal-account permission for task reminders while retaining the exact Mist route',()=>{
 const state=fixture();state.notifications=[];const notice={id:'agent-task:task:key',title:'Agent待补充资料',detail:'核对交期',at:'2026-11-01T00:00:00Z',readAt:null,target:{view:'account',id:'task',section:'agents'}};
 expect(visibleMistNotifications(state,view=>view==='account-settings',[notice])).toEqual([notice]);expect(visibleMistNotifications(state,()=>false,[notice])).toEqual([]);expect(notice.target.view).toBe('account');
});
const fixture=()=>createMistState({id:()=>crypto.randomUUID(),now:'2026-10-13T00:00:00Z',actorName:'测试'},'empty');
describe('workspace notification preferences',()=>{
 it('filters disabled categories and unreadable targets without deleting stored facts',()=>{
  const state=fixture();state.notifications=['qc','shipping','suggestion','general'].map(category=>({id:category,title:category,detail:'',at:'2026-10-13',readAt:null,category:category as any,target:{view:category==='shipping'?'shipments':'development/detail'}}));
  state.settings.notifications.qc=false;state.settings.notifications.suggestions=false;
  expect(visibleMistNotifications(state,()=>true).map(n=>n.id)).toEqual(['shipping','general']);
  expect(visibleMistNotifications(state,v=>v!=='shipments').map(n=>n.id)).toEqual(['general']);
  expect(state.notifications).toHaveLength(4);
 });
 it('generates no digest until enabled and never combines different currencies',()=>{
  const state=fixture();state.invoices=[{id:'usd-a',code:'a',orderId:'o',order:'o',customer:'c',due:'2026-10-13',currency:'USD',amount:0.1,open:0.1},{id:'usd-b',code:'b',orderId:'o',order:'o',customer:'c',due:'2026-10-13',currency:'USD',amount:0.2,open:0.2},{id:'cny',code:'c',orderId:'o',order:'o',customer:'c',due:'2026-10-13',currency:'CNY',amount:10,open:10}];
  expect(mistDailyDigest(state,'2026-10-13',()=>true)).toEqual([]);state.settings.notifications.digest=true;
  expect(mistDailyDigest(state,'2026-10-13',()=>true).map(n=>n.detail)).toEqual(['0.30 USD · 2 张发票','10.00 CNY · 1 张发票']);
  expect(mistDailyDigest(state,'2026-10-13',()=>false)).toEqual([]);
 });
 it('links due tasks to their exact source and excludes future or finished tasks',()=>{
  const state=fixture();state.settings.notifications.digest=true;state.tasks=[{id:'due',title:'准确任务',kind:'qc',due:'2026-10-13',done:false,target:{view:'development/detail',id:'dev',versionId:'version'}},{id:'future',title:'未来',kind:'qc',due:'2026-10-14',done:false,target:{view:'development/detail'}},{id:'done',title:'完成',kind:'qc',due:'2026-10-12',done:true,target:{view:'development/detail'}}];
  expect(mistDailyDigest(state,'2026-10-13',()=>true)).toEqual([{id:'task:due',label:'准确任务',detail:'今天到期',target:{view:'development/detail',id:'dev',versionId:'version'}}]);
 });
 it('keeps claim work without a deadline distinct from due or overdue work',()=>{
  const state=fixture();state.settings.notifications.digest=true;const target={view:'claims',id:'exact-claim'};
  state.tasks=[{id:'undated',title:'生成售后履行单据',kind:'claim-execution:disposition',due:'',done:false,target},{id:'today',title:'已约今天',kind:'business',due:'2026-10-13',done:false,target},{id:'overdue',title:'已约昨日',kind:'business',due:'2026-10-12',done:false,target},{id:'future',title:'未来期限',kind:'business',due:'2026-10-14',done:false,target}];
  expect(mistDailyDigest(state,'2026-10-13',()=>true).map(row=>row.detail)).toEqual(['未定期限','今天到期','已过期 · 2026-10-12']);expect(mistDailyDigest(state,'2026-10-13',view=>view!=='claims')).toEqual([]);
  expect(state.tasks[0].due).toBe('');
 });
 it('shows a readable general claim decision even when QC and shipping reminders are disabled',()=>{
  const state=fixture();state.settings.notifications.qc=false;state.settings.notifications.shipping=false;state.notifications=[{id:'claim-decision',category:'general',title:'售后处置已批准',detail:'实际负责人 · 核对通过',at:'2026-10-13',readAt:null,target:{view:'claims',id:'exact-claim'}}];
  expect(visibleMistNotifications(state,view=>view==='claims')).toHaveLength(1);expect(visibleMistNotifications(state,view=>view!=='claims')).toEqual([]);
 });
});

it('summarizes known handover and production actions without changing archived notes or visibility',()=>{
 const state=fixture();state.orders.push({id:'order',code:'SO-G-1'} as any);state.productions.push({id:'production',code:'FUL-1'} as any);const note='客户确认的完整交接说明，应留在原始记录';state.notifications=[{id:'handoff',title:'交接后勤：'+note,detail:'业务员',at:'2026-10-13',readAt:null,category:'shipping',target:{view:'orders/detail',id:'order'}},{id:'move',title:'更新工序为 done',detail:'业务员',at:'2026-10-13',readAt:null,category:'general',target:{view:'production-board',id:'production'}}];const before=structuredClone(state.notifications);const rows=visibleMistNotifications(state,()=>true);expect(rows.map(row=>row.title)).toEqual(['SO-G-1 · 后勤交接','FUL-1 · 待出运']);expect(rows[0].detail).toBe('业务员');expect(state.notifications).toEqual(before);expect(visibleMistNotifications(state,view=>view!=='orders').map(row=>row.id)).toEqual(['move']);
});

it('keeps a QC continuation note in the source while showing a short task identity',()=>{
 const state=fixture();state.fulfillment.qcTasks.push({id:'ship-qc',code:'QC-SHIP'} as any);const note='已核对一件船样及需求方确认，按本票继续出运';state.notifications=[{id:'continued',title:'业务确认继续：'+note,detail:'林澈',at:'2026-10-13',readAt:null,category:'qc',target:{view:'qc-workbench',id:'ship-qc'}},{id:'user',title:'客户要求：'+note,detail:'林澈',at:'2026-10-13',readAt:null,category:'qc',target:{view:'qc-workbench',id:'ship-qc'}}];const before=structuredClone(state.notifications);expect(visibleMistNotifications(state,()=>true).map(row=>row.title)).toEqual(['QC-SHIP · 业务已继续','客户要求：'+note]);expect(state.notifications).toEqual(before);
});

it('summarises the legacy generated claim notice without rewriting the stored message or target',()=>{
 const state=fixture(),detail='业务员 林澈 已通知质检、跟单与工厂（平湖启程服饰）配合核实；通知工厂不代表认定责任或答应客户金额。';state.notifications=[{id:'claim-notice',title:'CLM-1 · 新客诉待关注',detail,at:'2026-10-13',readAt:null,category:'general',target:{view:'claims',id:'claim'}}];const before=structuredClone(state.notifications);
 expect(visibleMistNotifications(state,()=>true)[0]).toMatchObject({title:'CLM-1 · 新客诉',detail:'林澈 · 平湖启程服饰',target:{view:'claims',id:'claim'}});expect(state.notifications).toEqual(before);
});
