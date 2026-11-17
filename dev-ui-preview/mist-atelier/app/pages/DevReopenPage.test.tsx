// @vitest-environment jsdom
import React,{act}from'react';
import{createRoot,type Root}from'react-dom/client';
import{beforeEach,afterEach,expect,it,vi}from'vitest';
import{fireEvent,getByRole,queryByRole}from'@testing-library/dom';
import{createMistState}from'../../../../server/src/shared/mistWorkspace';
import{Nav}from'../nav';
const store=vi.hoisted(()=>({current:null as any,write:true}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>store.current}));
vi.mock('../runtime/auth',()=>{const session=()=>({user:{id:'sales',displayName:'业务员'},hasPermission:(p:string)=>p==='products:write'?store.write:!p.startsWith('qc:')});return{useOptionalMistSession:session,useMistSession:session};});
import{DevDetailPage}from'./DevDetailPage';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;const go=vi.fn();
const render=()=>act(()=>root.render(<Nav.Provider value={{route:{view:'development/detail',id:'dev',versionId:'old-version'},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><DevDetailPage/></Nav.Provider>));
beforeEach(()=>{store.write=true;go.mockReset();const state=createMistState({id:()=>crypto.randomUUID(),now:'2026-11-18T04:00:00Z',actorName:'业务员'},'empty');
 const values={name:'羊毛外套',customer:'c',style:'ST-1',season:'AW',category:'外套',kind:'new',fabric:'羊毛',color:'灰',target:'',sizeBase:'M',goal:'版型',factories:['A厂'],due:'2026-11-21',collaborators:[],sampleQuantity:1};
 const v=(id:string,label:string)=>({id,devId:'dev',label,factory:'A厂',factoryId:'A厂',sample:'GW-1',sampleQuantity:1,size:'M',fabric:'羊毛',img:'coat',fileIds:[],returnedAt:'2026-11-18T04:00:00Z',qc:{result:'pass',reviewer:'QC',reviewedAt:'2026-11-18T04:00:00Z',report:'QC-1',opinion:''},confirmations:[],archivedAt:'2026-11-18T04:00:00Z',note:''});
 state.devs.push({id:'dev',code:'DEV-1',name:'羊毛外套',style:'ST-1',owner:'业务员',ownerId:'sales',customer:'客户',customerId:'c',due:'2026-11-21',dueRel:'待交付',stage:4,state:'已归档',tone:'neutral',ver:'R2-A-2',fac:1,img:'coat',factory:'A厂',sample:'GW-1',fabric:'羊毛',goal:'版型',currentVersionId:'current-version',versionIds:['old-version','current-version'],values,fileIds:[],createdAt:'2026-11-18T04:00:00Z',updatedAt:'2026-11-18T04:00:00Z',closure:{id:'close-1',kind:'archived',by:'业务员',byId:'sales',at:'2026-11-18T04:00:00Z',reason:'原结束原因'}}as any);state.versions.push(v('old-version','R1-A-1')as any,v('current-version','R2-A-2')as any);
 store.current={state,workspace:{id:'workspace',revision:7},loading:false,error:'',saving:false,pending:null,run:vi.fn(async()=>({result:{devId:'dev'},revision:8})),uploadFile:vi.fn(),downloadFile:vi.fn(),fileUrl:vi.fn()};host=document.createElement('div');document.body.append(host);root=createRoot(host);render();});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function open(){await act(async()=>getByRole(host,'button',{name:'更多',exact:true}).click());await act(async()=>getByRole(document.body,'button',{name:'恢复开发案',exact:true}).click());}
const reason=()=>getByRole(document.body,'textbox',{name:'恢复原因',exact:true})as HTMLTextAreaElement;
const fill=(text:string)=>act(()=>fireEvent.change(reason(),{target:{value:text}}));
it('binds the trusted close cycle and seen current version without changing a historical route',async()=>{
 await open();expect((getByRole(document.body,'button',{name:'确认恢复',exact:true})as HTMLButtonElement).disabled).toBe(true);fill('继续核对下一轮版型');await act(async()=>getByRole(document.body,'button',{name:'确认恢复',exact:true}).click());
 expect(store.current.run).toHaveBeenCalledWith({type:'development.reopen',payload:{devId:'dev',closureId:'close-1',expectedVersionId:'current-version',reason:'继续核对下一轮版型'}},{expectedRevision:7});expect(go).not.toHaveBeenCalled();
});
it('retains the reason and prevents a stale dialog from reopening a newer same-clock close cycle',async()=>{
 await open();fill('继续开发');store.current.state={...store.current.state,devs:[{...store.current.state.devs[0],closure:{...store.current.state.devs[0].closure,id:'close-2'}}]};store.current.workspace={id:'workspace',revision:8};render();
 expect(reason().value).toBe('继续开发');expect((getByRole(document.body,'button',{name:'确认恢复',exact:true})as HTMLButtonElement).disabled).toBe(true);expect(document.body.textContent).toContain('关闭记录或当前版本已变化');expect(store.current.run).not.toHaveBeenCalled();
});
it('owns a definite server rejection in the recovery dialog and retains exact inputs',async()=>{
 store.current.run.mockRejectedValueOnce(new Error('当前版本已变化，请重新核对后恢复'));await open();fill('继续开发');await act(async()=>getByRole(document.body,'button',{name:'确认恢复',exact:true}).click());expect(reason().value).toBe('继续开发');expect(document.body.textContent?.match(/当前版本已变化，请重新核对后恢复/g)).toHaveLength(1);expect(getByRole(document.body,'dialog',{name:'恢复开发案',exact:true})).toBeTruthy();
});
it('does not grant restoration from a display status or to a read-only role',async()=>{
 store.write=false;render();await act(async()=>getByRole(host,'button',{name:'更多',exact:true}).click());expect(queryByRole(document.body,'button',{name:'恢复开发案',exact:true})).toBeNull();expect(store.current.run).not.toHaveBeenCalled();
});
it('does not treat archived text without an explicit close record as reopen authority',async()=>{
 delete store.current.state.devs[0].closure;render();await act(async()=>getByRole(host,'button',{name:'更多',exact:true}).click());expect(queryByRole(document.body,'button',{name:'恢复开发案',exact:true})).toBeNull();
});
