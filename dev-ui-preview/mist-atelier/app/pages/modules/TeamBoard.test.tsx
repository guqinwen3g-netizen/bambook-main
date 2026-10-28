// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState,type MistState} from '../../../../../server/src/shared/mistWorkspace';
import {MIST_DEMO_ACCOUNTS} from '../../../../../server/src/shared/mistAccounts';
const store=vi.hoisted(()=>({state:null as any,loading:false,error:'',saving:false,pending:null,run:vi.fn(),refresh:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
import {TeamBoard} from './TeamBoard';
import {addBusinessDays,teamWeeklyReport,weekStartOf} from '../../../../../server/src/shared/mistTeam';
import {platformBusinessDate} from '../../../../../server/src/shared/mistPlatform';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root,state:MistState;const run=vi.fn(),go=vi.fn();
const members=MIST_DEMO_ACCOUNTS.map(a=>({id:a.id,name:a.name,groups:a.groups,owner:a.id==='demo-reviewer'}));
function render(can=true,viewer={id:'demo-reviewer',owner:true}){act(()=>root.render(<MistRoot><ToastProvider><TeamBoard state={state} members={members} viewer={viewer} can={can} busy={false} run={run} go={go}/></ToastProvider></MistRoot>));}
async function click(node:Element){await act(async()=>(node as HTMLElement).click());}
const rowOf=(name:string)=>[...host.querySelectorAll('[role="row"]')].find(r=>r.textContent?.includes(name))!;
beforeEach(()=>{let i=0;state=createMistState({id:()=>'t'+(++i),now:'2026-10-18T02:00:00Z',actorName:'周敏',actorId:'demo-reviewer'} as any,'demo');store.state=state;run.mockReset();run.mockResolvedValue({result:{id:'n1'}});go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it('lists every member with what they hold, and nudges a member on a specific order',async()=>{
  render();
  const table=getByRole(host,'table',{name:'团队在手'});
  expect(table.textContent).toContain('顾言');expect(table.textContent).toContain('沈禾');expect(table.textContent).toContain('周敏（本人）');
  await click(rowOf('顾言'));
  const drawer=document.querySelector('[data-team-member="demo-sales"]') as HTMLElement;
  expect(drawer.textContent).toContain('SO-G-2026-018');
  await click(getByRole(drawer,'button',{name:'督办 订单 SO-G-2026-018'}));
  const dialog=getByRole(document.body,'dialog',{name:/督办 顾言/});
  expect((getByRole(dialog,'textbox',{name:'督办事项'}) as HTMLInputElement).value).toContain('SO-G-2026-018');
  await click(getByRole(dialog,'button',{name:'发出督办'}));
  const order=state.orders.find(o=>o.code==='SO-G-2026-018')!;
  expect(run).toHaveBeenCalledWith({type:'team.nudge',payload:expect.objectContaining({assigneeId:'demo-sales',target:{view:'orders/detail',id:order.id},due:expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)})});
});

it('flags former accounts that still hold business, and hides nudging without supervisor permission or for oneself',async()=>{
  state.customers[0].ownerId='gone';state.customers[0].owner='离职同事';
  render(false);
  expect(rowOf('离职同事').textContent).toContain('已不在本公司');
  await click(rowOf('离职同事'));
  expect(document.querySelector('[data-team-member="gone"]')!.textContent).toContain('去办理成员交接');
  await click(rowOf('顾言'));
  const drawer=document.querySelector('[data-team-member="demo-sales"]') as HTMLElement;
  expect(queryByRole(drawer,'button',{name:/^督办 /})).toBeNull();
  expect(drawer.textContent).toContain('督办需要客户管理主管权限');
});

it('shows every member to a line supervisor and names the managed line (P4)',()=>{
  const garmentOnly=members.map(m=>m.id==='demo-reviewer'?{...m,groups:['garment' as const]}:m.id==='demo-buyer'?{...m,groups:['fabric' as const]}:m);
  act(()=>root.render(<MistRoot><ToastProvider><TeamBoard state={state} members={garmentOnly} viewer={{id:'demo-reviewer',owner:false}} can busy={false} run={run} go={go}/></ToastProvider></MistRoot>));
  const table=getByRole(host,'table',{name:'团队在手'});
  expect(table.textContent).toContain('顾言');expect(table.textContent).toContain('沈禾');
  expect(host.textContent).toContain('全部成员（你管理成衣业务线）');
});

it('switches to the weekly report, pages back a week and copies the text summary for the supervisor to send',async()=>{
  const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
  render();
  await click(getByRole(getByRole(host,'group',{name:'团队视图'}),'button',{name:/周报/}));
  const weekly=host.querySelector('[data-team-weekly]') as HTMLElement;const start=weekly.getAttribute('data-team-weekly')!;
  expect(getByRole(host,'table',{name:'团队周报'}).textContent).toContain('顾言');
  expect((getByRole(host,'button',{name:'下一周'}) as HTMLButtonElement).disabled).toBe(true);
  await click(getByRole(host,'button',{name:'上一周'}));
  expect(host.querySelector('[data-team-weekly]')!.getAttribute('data-team-weekly')).not.toBe(start);
  await click(getByRole(host,'button',{name:'复制周报文字'}));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('团队周报（'));
  expect(writeText.mock.calls[0][0]).toContain('· 顾言');
});

it('opens last week from the work reminder, archives it on the server, then shows the frozen archived version',async()=>{
  const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
  const today=platformBusinessDate(new Date()),last=addBusinessDays(weekStartOf(today),-7);
  const show=()=>act(()=>root.render(<MistRoot><ToastProvider><TeamBoard state={state} members={members} viewer={{id:'demo-reviewer',owner:true}} can busy={false} run={run} go={go} initialMode="week" initialWeek={last}/></ToastProvider></MistRoot>));
  show();
  expect(host.querySelector('[data-team-weekly]')!.getAttribute('data-team-weekly')).toBe(last);
  expect(host.textContent).toContain('尚未存档');
  await click(getByRole(host,'button',{name:'生成并存档'}));
  expect(run).toHaveBeenCalledWith({type:'team.weekly.archive',payload:{weekStart:last}});
  const live=teamWeeklyReport(state,members,{id:'demo-reviewer',owner:true},last,today);
  (state as any).teamReports=[{id:'wr',weekStart:last,weekEnd:addBusinessDays(last,6),generatedAt:'2026-10-19T01:30:00Z',generatedById:'demo-reviewer',generatedBy:'周敏',scope:'全部成员',report:live,text:'存档文字'}];
  show();
  expect(host.textContent).toContain('已存档 · 全部成员');
  expect(queryByRole(host,'button',{name:'生成并存档'})).toBeNull();
  await click(getByRole(host,'button',{name:'复制周报文字'}));
  expect(writeText).toHaveBeenCalledWith('存档文字');
});
it('does not offer archiving to viewers without supervisor permission',()=>{
  const today=platformBusinessDate(new Date()),last=addBusinessDays(weekStartOf(today),-7);
  act(()=>root.render(<MistRoot><ToastProvider><TeamBoard state={state} members={members} viewer={{id:'demo-sales',owner:false}} can={false} busy={false} run={run} go={go} initialMode="week" initialWeek={last}/></ToastProvider></MistRoot>));
  expect(queryByRole(host,'button',{name:'生成并存档'})).toBeNull();
});
