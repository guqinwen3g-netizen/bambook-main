// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole} from '@testing-library/dom';
import {MistRoot} from '../../../../../components/mist';
import {createMistState} from '../../../../../server/src/shared/mistWorkspace';
import {Nav} from '../../nav';
import {DashboardPage} from './PlatformPages';

const seam=vi.hoisted(()=>({state:null as any,loading:false,error:'',refresh:vi.fn()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>({...seam,workspace:{id:'dashboard-read',access:{canManageCompany:true}}})}));
vi.mock('../../runtime/auth',()=>{const useMistSession=()=>({sessionKey:'finance',user:{id:'finance',displayName:'财务'},hasPermission:()=>true});return{useMistSession,useOptionalMistSession:useMistSession};});
let host:HTMLDivElement,root:Root;
const render=(section?:string)=>act(()=>root.render(<MistRoot><Nav.Provider value={{route:{view:'dashboard',section},go:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><DashboardPage/></Nav.Provider></MistRoot>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;seam.state=null;seam.loading=false;seam.error='读取失败';seam.refresh.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it.each([undefined,'team','team-weekly'])('does not turn unread %s business into zero orders or no receivables',section=>{
 render(section);expect(host.textContent).toContain('业务数据未读取');expect(host.textContent).not.toContain('履行中订单');expect(host.textContent).not.toContain('没有未收应收');expect(host.textContent).not.toContain('正在读取团队数据');expect(host.querySelector('[role="table"]')).toBeNull();
});
it('keeps loading separate from a real empty business overview and allows a failed read retry',async()=>{
 seam.loading=true;seam.error='';render();expect(host.textContent).toContain('正在读取业务数据');expect((getByRole(host,'button',{name:'刷新',exact:true})as HTMLButtonElement).disabled).toBe(true);
 seam.loading=false;seam.error='读取失败';render();await act(async()=>getByRole(host,'button',{name:'刷新',exact:true}).click());expect(seam.refresh).toHaveBeenCalledOnce();
 seam.error='';seam.state=createMistState({id:()=>'',now:'2026-11-18T04:00:00Z',actorName:'财务'},'empty');render();expect(host.textContent).toContain('履行中订单');expect(host.textContent).toContain('没有未收应收');expect(host.textContent).not.toContain('业务数据未读取');
});

it('labels completed production without claiming an unshipped order is fully fulfilled',()=>{
 seam.error='';seam.state=createMistState({id:()=>'',now:'2026-11-18T04:00:00Z',actorName:'财务'},'empty');
 seam.state.orders=[{id:'production-complete',code:'SO-PRODUCTION-COMPLETE',customerId:'c',customer:'模拟客户',type:'garment',due:'2026-12-12',qty:12,amount:504,currency:'USD',progress:100,state:'出运准备中',tone:'warn',governance:{status:'approved',contract:{kind:'external'}}}];
 seam.state.productions=[{id:'production',orderId:'production-complete',pct:100}];
 seam.state.fulfillment.shipments=[{id:'first',state:'ready',lines:[{orderId:'production-complete',quantity:8}]},{id:'tail',state:'ready',lines:[{orderId:'production-complete',quantity:4}]}];
 const original=structuredClone(seam.state);render();
 expect(getByRole(host,'columnheader',{name:'生产进度',exact:true})).toBeTruthy();
 expect(getByRole(host,'columnheader',{name:'生产进度',exact:true}).closest('[role="table"]')?.closest('[data-report-results]')).toBeTruthy();
 expect(host.textContent).not.toContain('履行进度');
 const row=getByRole(host,'row',{name:/SO-PRODUCTION-COMPLETE/});expect(row.textContent).toContain('100%');expect(row.textContent).toContain('出运准备中');
 expect(seam.state).toEqual(original);
});
