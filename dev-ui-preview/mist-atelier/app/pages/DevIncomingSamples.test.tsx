// @vitest-environment jsdom
import React,{act}from'react';
import{createRoot,type Root}from'react-dom/client';
import{beforeEach,afterEach,expect,it,vi}from'vitest';
import{fireEvent,getByRole,queryByRole}from'@testing-library/dom';
import{MistRoot,ToastProvider}from'../../../../components/mist';
import{applyMistCommand,createMistState,type MistContext,type DevelopmentValues}from'../../../../server/src/shared/mistWorkspace';
import{withTestFactories}from'../../../../server/src/shared/__tests__/utils/devFactories';
import{Nav}from'../nav';
const store=vi.hoisted(()=>({state:null as any,workspace:null as any,loading:false,saving:false,pending:null as any,error:'',run:vi.fn(),recover:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn(),refresh:vi.fn(),dismissError:vi.fn()}));
const permissions=vi.hoisted(()=>({read:true,write:true}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../runtime/auth',()=>({useOptionalMistSession:()=>({sessionKey:'session',user:{id:'sales',displayName:'业务员'},hasPermission:(p:string)=>p==='products:read'?permissions.read:permissions.write}),useMistSession:()=>({sessionKey:'session',user:{id:'sales',displayName:'业务员'},hasPermission:()=>permissions.write})}));
import{DevIncomingSamplesCard}from'./DevIncomingSamples';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLElement,devId:string,ctx:MistContext;let capability:any;const go=vi.fn();
const dev=()=>store.state.devs.find((d:any)=>d.id===devId);
const render=()=>act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'development/detail',id:devId},go,theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><DevIncomingSamplesCard state={store.state} dev={dev()} access={capability}/></Nav.Provider></ToastProvider></MistRoot>));
const apply=(c:any)=>{const r=applyMistCommand(store.state,c,ctx);store.state=r.state;return r.result;};
beforeEach(()=>{let n=0;ctx={id:()=>`ui-incoming-${++n}`,now:'2026-11-18T04:00:00Z',actorName:'业务员',actorId:'sales',members:[{id:'sales',name:'业务员',active:true},{id:'same-name',name:'收件人',active:true}]};store.state=withTestFactories(createMistState(ctx,'empty'));store.state.customers.push({id:'c',name:'客户',code:'C'}as any);const values:DevelopmentValues={domain:'fabric',name:'棉斜纹',customer:'c',style:'COT',season:'SS27',category:'梭织',kind:'new',fabric:'客户目标',color:'目标色',target:'',sizeBase:'目标尺码',goal:'核对来样',factories:['测试面料厂','实际测试面料厂'],due:'2026-11-22',collaborators:[],sampleQuantity:9,sampleForm:'米样',sampleUnit:'米',targetUnit:'米',targetCurrency:'CNY'};devId=String(apply({type:'development.submit',payload:{values,fileIds:[]}}).devId);store.workspace={id:'space',revision:7};capability={readableDevIds:[devId],writableDevIds:[devId]};permissions.read=true;permissions.write=true;store.loading=false;store.saving=false;store.pending=null;store.error='';store.run.mockReset();store.run.mockImplementation(async c=>{const result=apply(c);store.workspace={...store.workspace,revision:store.workspace.revision+1};render();return{result,revision:store.workspace.revision};});store.dismissError.mockReset();store.recover.mockReset();go.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);render();});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const fill=(label:string,value:string)=>act(()=>fireEvent.change(getByRole(document.body,'textbox',{name:label,exact:true}),{target:{value}}));
const input=(label:string,value:string)=>act(()=>fireEvent.change(getByRole(document.body,'spinbutton',{name:label,exact:true}),{target:{value}}));
const date=(label:string,value:string)=>act(()=>fireEvent.change(document.querySelector<HTMLInputElement>('input[aria-label="'+label+'"]')!,{target:{value}}));
const choose=(label:string,value:string)=>act(()=>fireEvent.change(getByRole(document.body,'combobox',{name:label,exact:true}),{target:{value}}));
const click=async(label:string)=>{await act(async()=>getByRole(document.body,'button',{name:label,exact:true}).click());};
const seed=()=>{const r=apply({type:'development.incoming.receive',payload:{devId,receivedAt:'2026-11-18',name:'棉斜纹',form:'米样',quantity:2.75,unit:'米',size:'150cm',color:'军绿',location:'A01',contact:'客户联系人',fileIds:[],note:''}});render();return r.sampleIds as string[];};
async function parcel(){seed();await click('寄工厂');choose('工厂任务',store.state.versions.find((v:any)=>v.devId===devId).id);input('本次数量 1','.5');date('实际寄送日','2026-11-18');fill('收件人','收件人');fill('收件地址','工厂样品室');fill('快递公司','顺丰');fill('运单号','SF-LOCAL');input('我方邮费','12');}
it('does not invent an empty readable ledger or creation authority when server capability is missing or denied',()=>{
 capability=undefined;render();expect(host.textContent).not.toContain('暂无来样');expect(queryByRole(host,'button',{name:'登记来样'})).toBeNull();capability={readableDevIds:[],writableDevIds:[]};render();expect(host.textContent).not.toContain('暂无来样');seed();capability={readableDevIds:[devId],writableDevIds:[]};render();expect(host.textContent).toContain('2.75');expect(queryByRole(host,'button',{name:'登记来样'})).toBeNull();
});
it('requires actual intake quantity and preserves target specifications separately from the original',async()=>{
 await click('登记来样');expect((getByRole(document.body,'spinbutton',{name:'实际数量'})as HTMLInputElement).value).toBe('');expect((getByRole(document.body,'textbox',{name:'尺码'})as HTMLInputElement).value).toBe('');expect((getByRole(document.body,'textbox',{name:'颜色'})as HTMLInputElement).value).toBe('');await click('登记入库');expect(store.run).not.toHaveBeenCalled();fill('来样形态','米样');choose('实际单位','米');input('实际数量','2.75');date('实际收样日','2026-11-18');fill('存放位置','A01');await click('登记入库');expect(store.run).toHaveBeenCalledTimes(1);expect(store.run.mock.calls[0][0]).toMatchObject({type:'development.incoming.receive',payload:{quantity:2.75,form:'米样',unit:'米',color:'',size:'',fileIds:[]}});expect(store.state.versions.every((v:any)=>v.returnedAt===null&&v.qc===null)).toBe(true);expect(host.textContent).toContain('2.75');
});
it('dispatches to the exact factory and can record a partial original return after closure without restarting QC or duplicating cost',async()=>{
 await parcel();await click('登记寄厂');expect(store.run.mock.calls[0][0]).toMatchObject({type:'development.incoming.dispatch',payload:{postage:{amount:12,currency:'CNY'},items:[{quantity:.5,sourceLocation:'A01'}]}});expect(store.state.fulfillment.sampleMovements.find((m:any)=>m.kind==='lend').borrowerId).toBe('');apply({type:'development.close',payload:{devId,kind:'archived',reason:'暂告结束'}});render();expect((getByRole(host,'button',{name:'登记来样'})as HTMLButtonElement).disabled).toBe(true);await click('登记原样退回');input('本次数量 1','.25');date('实际退回日','2026-11-18');fill('归还位置 1','B02');fill('收件人','业务员');fill('收件地址','公司样品室');fill('快递公司','顺丰');fill('运单号','SF-RETURN');await click('登记退回');expect(store.state.fulfillment.samples[0].available).toBe(2.5);expect(dev().billing.expenses).toHaveLength(1);expect(dev().closure).toBeTruthy();expect(store.state.fulfillment.qcTasks).toEqual([]);
});
it('retains entered quantity and blocks a synchronized source change before any command',async()=>{
 await parcel();store.state.versions.find((v:any)=>v.devId===devId).task.commonRequirements='另一份要求';render();expect((getByRole(document.body,'spinbutton',{name:'本次数量 1'})as HTMLInputElement).value).toBe('.5');expect((getByRole(document.body,'button',{name:'登记寄厂'})as HTMLButtonElement).disabled).toBe(true);expect(store.run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('来样或工厂任务已变化');
});
it('keeps an unknown result in its dialog and recovers the exact request without issuing another command',async()=>{
 await click('登记来样');fill('来样形态','米样');choose('实际单位','米');input('实际数量','2.75');date('实际收样日','2026-11-18');
 store.run.mockImplementationOnce(async c=>{store.pending={kind:'command',requestId:'lost-incoming',command:c};render();throw Error('结果待核对');});
 await click('登记入库');expect(store.run).toHaveBeenCalledTimes(1);const dialog=getByRole(document.body,'dialog',{name:'登记来样',exact:true});expect((getByRole(dialog,'spinbutton',{name:'实际数量'})as HTMLInputElement).value).toBe('2.75');expect((getByRole(dialog,'button',{name:'登记入库'})as HTMLButtonElement).disabled).toBe(true);
 store.recover.mockImplementationOnce(async()=>{const result=apply(store.pending.command);store.pending=null;render();return{result,revision:8};});await click('核对原操作结果');expect(store.recover).toHaveBeenCalledTimes(1);expect(store.run).toHaveBeenCalledTimes(1);expect(queryByRole(document.body,'dialog',{name:'登记来样',exact:true})).toBeNull();expect(store.state.fulfillment.samples).toHaveLength(1);
});
