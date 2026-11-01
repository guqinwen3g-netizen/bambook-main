// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getByRole,getAllByRole,getByText,queryByRole} from '@testing-library/dom';
import {MistRoot} from '../../../../components/mist';
const seam=vi.hoisted(()=>({api:vi.fn(),go:vi.fn(),identity:'A',userId:'A'}));
vi.mock('../runtime/auth',()=>({useMistSession:()=>({sessionKey:seam.identity,user:{id:seam.userId}})}));
vi.mock('../runtime/workspace',()=>({mistApiRequest:(...args:any[])=>seam.api(...args),useMistWorkspace:()=>({workspace:{id:'workspace'},state:{members:[]}})}));
vi.mock('../nav',()=>({useNav:()=>({go:seam.go})}));
import {AgentAuditHistory} from './AgentAuditHistory';
let root:Root,host:HTMLDivElement;
const entry=(id='one',name='财务甲',actorId='A')=>({requestId:id,at:'2026-10-31T08:00:00Z',actor:{id:actorId,name},source:'agent',phase:'executed',commandType:'calendar.save',requestedCommandType:'calendar.save',label:'保存日程',agentSessionId:'session',requestedRevision:0,baseRevision:0,committedRevision:1});
const detail=(accessKey='access-1',changes:any[]=[{path:['k:calendar','i:event','k:title'],label:'标题',operation:'replace',before:'原安排',after:'CONFIDENTIAL'}],nextOffset:number|null=null)=>({...entry(),command:{type:'calendar.save'},commandRestricted:false,changes,detailsRestricted:false,systemChangesOmitted:false,offset:0,totalChanges:nextOffset===null?changes.length:26,nextOffset,references:{},accessKey});
const paint=()=>root.render(<MistRoot><AgentAuditHistory/></MistRoot>);
const flush=async()=>{await act(async()=>{await Promise.resolve();await Promise.resolve();});};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;seam.identity='A';seam.userId='A';vi.clearAllMocks();localStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();localStorage.clear();});
it('reads the real API list/details without writing, and lets employees inspect before/after values',async()=>{
  seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/one?')?detail():{items:[entry()],nextCursor:null,canReadCompany:false}));
  act(paint);await flush();expect(getByRole(host,'table',{name:'Agent 操作记录'})).toBeTruthy();
  await act(async()=>getByText(host,'保存日程').click());await flush();
  const dialog=getByRole(document.body,'dialog',{name:'保存日程'});expect(dialog.textContent).toContain('修改前');expect(dialog.textContent).toContain('原安排');expect(dialog.textContent).toContain('CONFIDENTIAL');
  for(const [url,init] of seam.api.mock.calls){expect(url).toContain('/agent-audits');expect(init?.method).toBeUndefined();}
});
it('copies the exact authorized operation ID and displays mail folder values as business labels',async()=>{
  const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
  seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/one?')?detail('mail',[{path:['k:email','k:messages','i:mail','k:folder'],label:'文件夹',operation:'replace',before:'archive',after:'inbox'}]):{items:[entry()],nextCursor:null,canReadCompany:false}));
  act(paint);await flush();await act(async()=>getByText(host,'保存日程').click());await flush();expect(document.body.textContent).toContain('已归档');expect(document.body.textContent).toContain('收件箱');await act(async()=>getByRole(document.body,'button',{name:'复制操作编号'}).click());await flush();expect(copy).toHaveBeenCalledWith('one');expect(getByRole(document.body,'button',{name:'已复制'})).toBeTruthy();expect(seam.api.mock.calls.every(([,init])=>!init?.method)).toBe(true);
});
it('labels rejection of an Agent proposal without implying that the underlying business record was rejected',async()=>{
  seam.api.mockResolvedValue({items:[{...entry(),requestedCommandType:'agent.proposal.reject',phase:'rejected',source:'human_rejection'}],nextCursor:null,canReadCompany:false});act(paint);await flush();expect(getByText(host,'拒绝Agent提议')).toBeTruthy();
});
it('discards a delayed response after switching accounts',async()=>{
  let resolveOld!:(value:any)=>void;const old=new Promise(resolve=>{resolveOld=resolve;});
  seam.api.mockImplementationOnce(()=>old).mockResolvedValue({items:[entry('two','财务乙','B')],nextCursor:null,canReadCompany:false});
  act(paint);seam.identity='B';seam.userId='B';act(paint);await flush();
  await act(async()=>resolveOld({items:[entry('one','财务甲')],nextCursor:null,canReadCompany:true}));await flush();
  expect(host.textContent).toContain('财务乙');expect(host.textContent).not.toContain('财务甲');
});
it('clears already shown details when access changes during paging, and retries from the first page',async()=>{
  let count=0;seam.api.mockImplementation((url:string)=>{
    if(!url.includes('/one?'))return Promise.resolve({items:[entry()],nextCursor:null,canReadCompany:false});
    count++;return Promise.resolve(count===1?detail('old',Array.from({length:25},(_,i)=>({path:['k:calendar','i:event-'+i,'k:title'],label:'标题',operation:'replace',before:'原安排',after:'CONFIDENTIAL'})),25):{...detail('new',[]),detailsRestricted:true});
  });
  act(paint);await flush();await act(async()=>getByText(host,'保存日程').click());await flush();
  expect(document.body.textContent).toContain('CONFIDENTIAL');
  await act(async()=>getByRole(document.body,'button',{name:'更多变更'}).click());await flush();
  expect(document.body.textContent).not.toContain('CONFIDENTIAL');expect(document.body.textContent).toContain('可见范围已更新');
  await act(async()=>getByRole(document.body,'button',{name:'重新读取',exact:true}).click());await flush();
  expect(count).toBe(3);expect(document.body.textContent).toContain('部分明细受当前权限限制');
  act(()=>getAllByRole(document.body,'button',{name:'关闭',exact:true})[0].click());expect(queryByRole(document.body,'dialog')).toBeNull();
});
it('revalidates original input on demand and opens only the source supplied by the authorized detail',async()=>{
  seam.api.mockImplementation((url:string)=>{
    if(!url.includes('/one?'))return Promise.resolve({items:[entry()],nextCursor:null,canReadCompany:false});
    const payload=url.includes('includeCommand=true')?{note:'工厂已核对'}:undefined;
    return Promise.resolve({...detail(),command:{type:'calendar.save',...(payload?{payload}:{})},targets:[{view:'procurement',id:'purchase',label:'PO-2026-00001'}]});
  });
  act(paint);await flush();await act(async()=>getByText(host,'保存日程').click());await flush();
  expect(document.body.textContent).not.toContain('工厂已核对');
  await act(async()=>getByRole(document.body,'button',{name:'原始填写',exact:true}).click());await flush();
  expect(document.body.textContent).toContain('工厂已核对');
  await act(async()=>getByRole(document.body,'button',{name:'打开原单',exact:true}).click());
  expect(seam.go).toHaveBeenCalledWith('procurement','purchase');expect(queryByRole(document.body,'dialog')).toBeNull();
});
it('offers readable English labels without translating employee-entered business values',async()=>{
  localStorage.setItem('bambook.device.locale','"en-US"');
  const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/one?')?detail():{items:[entry()],nextCursor:null,canReadCompany:false}));
  act(paint);await flush();expect(getByRole(host,'table',{name:'Agent activity'})).toBeTruthy();expect(host.textContent).toContain('Save calendar event');expect(host.textContent).toContain('财务甲');
  await act(async()=>getByText(host,'Save calendar event').click());await flush();await act(async()=>getByRole(document.body,'button',{name:'Copy operation ID'}).click());await flush();expect(getByRole(document.body,'button',{name:'Copied'})).toBeTruthy();expect((getByRole(document.body,'textbox',{name:'Operation ID'}) as HTMLInputElement).value).toBe('one');
});
it('preserves the payable section when navigating back to a settlement',async()=>{
  seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/one?')?{...detail(),targets:[{view:'payment-vouchers',id:'settlement',section:'payables',label:'ST-1'}]}:{items:[entry()],nextCursor:null,canReadCompany:false}));
  act(paint);await flush();await act(async()=>getByText(host,'保存日程').click());await flush();await act(async()=>getByRole(document.body,'button',{name:'打开原单',exact:true}).click());
  expect(seam.go).toHaveBeenCalledWith('payment-vouchers','settlement',{section:'payables'});
});
it('allows explicitly available partial input and identifies it as partial',async()=>{
  seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/one?')?{...detail(),commandRestricted:true,commandAvailable:true,command:{type:'calendar.save',...(url.includes('includeCommand=true')?{payload:{note:'可见部分'}}:{})}}:{items:[entry()],nextCursor:null,canReadCompany:false}));
  act(paint);await flush();await act(async()=>getByText(host,'保存日程').click());await flush();
  const button=getByRole(document.body,'button',{name:'原始填写',exact:true}) as HTMLButtonElement;expect(button.disabled).toBe(false);
  await act(async()=>button.click());await flush();expect(document.body.textContent).toContain('可见部分');expect(document.body.textContent).toContain('部分可见');
});
it('does not translate user-entered notes that happen to match internal status words',async()=>{
  const change={path:['k:calendar','i:event','k:note'],label:'说明',operation:'replace',before:'pending',after:'active'};
  seam.api.mockImplementation((url:string)=>Promise.resolve(url.includes('/one?')?detail('access',[change]):{items:[entry()],nextCursor:null,canReadCompany:false}));
  act(paint);await flush();await act(async()=>getByText(host,'保存日程').click());await flush();
  const region=getByRole(document.body,'region',{name:'实际变更'});expect(region.textContent).toContain('pending');expect(region.textContent).toContain('active');expect(region.textContent).not.toContain('待处理');expect(region.textContent).not.toContain('在用');
});
