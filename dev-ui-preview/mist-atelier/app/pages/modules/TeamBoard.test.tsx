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
  expect(rowOf('离职同事').textContent).toContain('已不在本空间');
  await click(rowOf('离职同事'));
  expect(document.querySelector('[data-team-member="gone"]')!.textContent).toContain('去办理成员交接');
  await click(rowOf('顾言'));
  const drawer=document.querySelector('[data-team-member="demo-sales"]') as HTMLElement;
  expect(queryByRole(drawer,'button',{name:/^督办 /})).toBeNull();
  expect(drawer.textContent).toContain('督办需要客户管理主管权限');
});

it('scopes a group supervisor to members of the same business group',()=>{
  const garmentOnly=members.map(m=>m.id==='demo-reviewer'?{...m,groups:['garment' as const]}:m.id==='demo-buyer'?{...m,groups:['fabric' as const]}:m);
  act(()=>root.render(<MistRoot><ToastProvider><TeamBoard state={state} members={garmentOnly} viewer={{id:'demo-reviewer',owner:false}} can busy={false} run={run} go={go}/></ToastProvider></MistRoot>));
  const table=getByRole(host,'table',{name:'团队在手'});
  expect(table.textContent).toContain('顾言');expect(table.textContent).not.toContain('沈禾');
  expect(host.textContent).toContain('与你同业务组（成衣）的成员');
});
