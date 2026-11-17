// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getAllByRole,getByRole} from '@testing-library/dom';
import {MistRoot} from '../../../../../components/mist';
import {createMistState} from '../../../../../server/src/shared/mistWorkspace';
import {Nav} from '../../nav';
import {PlatformReportsPage} from './PlatformReports';

const seam=vi.hoisted(()=>({state:null as any,loading:false,error:'',refresh:vi.fn(),exportCsv:vi.fn()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>({...seam,workspace:{id:'read-state'}})}));
vi.mock('../../runtime/auth',()=>{const useMistSession=()=>({sessionKey:'finance-session',user:{id:'finance'},hasPermission:()=>true});return{useMistSession,useOptionalMistSession:useMistSession};});
vi.mock('./ModuleWorkbench',async()=>({...await vi.importActual<typeof import('./ModuleWorkbench')>('./ModuleWorkbench'),downloadModuleCsv:seam.exportCsv}));
vi.mock('./ReportSchedules',()=>({ReportSchedules:()=>null}));
let host:HTMLDivElement,root:Root;
const render=(section:string)=>act(()=>root.render(<MistRoot><Nav.Provider value={{route:{view:'reports',section},go:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><PlatformReportsPage/></Nav.Provider></MistRoot>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;seam.state=null;seam.loading=false;seam.error='读取失败';seam.exportCsv.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it.each(['sales','margin','aging','cash','orders','actual'])('does not turn a failed %s report into an empty-business conclusion or an export',section=>{
 render(section);expect(host.textContent).toContain('报表未读取');expect(host.textContent).not.toContain('当前范围没有订单');expect(host.textContent).not.toContain('没有未收应收');expect(host.textContent).not.toContain('没有符合条件的未完成订单');expect(getAllByRole(host,'button').some(b=>b.textContent==='导出 CSV'||b.textContent==='导出 Excel')).toBe(false);expect(host.querySelector('[role="table"]')).toBeNull();
});
it('shows loading, retries reading, and renders the real empty ledger only after a successful read',async()=>{
 seam.loading=true;seam.error='';render('sales');expect(host.textContent).toContain('正在读取报表');expect((getByRole(host,'button',{name:'刷新',exact:true})as HTMLButtonElement).disabled).toBe(true);
 seam.loading=false;seam.error='断网';render('sales');await act(async()=>getByRole(host,'button',{name:'刷新',exact:true}).click());expect(seam.refresh).toHaveBeenCalledOnce();
 seam.error='';seam.state=createMistState({id:()=>'',now:'2026-11-18T04:00:00Z',actorName:'财务'},'empty');render('sales');expect(host.textContent).toContain('当前范围没有订单');expect(host.textContent).not.toContain('报表未读取');expect(getByRole(host,'table',{name:'客户销售额',exact:true})).toBeTruthy();
});

function completedProductionBeforeDeparture(){
 seam.error='';seam.state=createMistState({id:()=>'',now:'2026-11-18T04:00:00Z',actorName:'财务'},'empty');
 seam.state.orders=[{id:'made',code:'SO-PRODUCTION-COMPLETE',customerId:'c',customer:'模拟客户',type:'garment',qty:12,amount:504,currency:'USD',createdAt:'2026-11-18T04:00:00Z',due:'2026-12-12',progress:100,state:'出运准备中',tone:'warn',governance:{status:'approved'}}];
 seam.state.productions=[{id:'production',orderId:'made',pct:100}];
 seam.state.fulfillment.shipments=[{id:'first',state:'ready',lines:[{orderId:'made',quantity:8}]},{id:'tail',state:'ready',lines:[{orderId:'made',quantity:4}]}];
}
it('names the 100 percent of an unshipped order as production progress',()=>{
 completedProductionBeforeDeparture();const original=structuredClone(seam.state);render('orders');
 const table=getByRole(host,'table',{name:'订单进度',exact:true});expect(getByRole(table,'columnheader',{name:'生产进度',exact:true})).toBeTruthy();
 const row=getByRole(table,'row',{name:/SO-PRODUCTION-COMPLETE/});expect(row.textContent).toContain('100%');expect(row.textContent).toContain('出运准备中');expect(seam.state).toEqual(original);
});
it('exports production progress with its explicit percent basis and unchanged shipping state',async()=>{
 completedProductionBeforeDeparture();render('orders');await act(async()=>getByRole(host,'button',{name:'导出 CSV',exact:true}).click());
 expect(seam.exportCsv).toHaveBeenCalledWith(expect.stringMatching(/^订单进度-/),['订单','客户','交期','生产进度%','交期状态','逾期天数','当前环节'],[expect.arrayContaining(['SO-PRODUCTION-COMPLETE',100,'出运准备中'])]);
});
