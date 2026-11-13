// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {getByRole} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {AdminApprovalAuthorities} from './AdminApprovalAuthorities';
const bridge=vi.hoisted(()=>({assignments:[] as Array<{businessLine:string;userId:string}>,assigned:'',unavailable:''}));
vi.mock('../../runtime/auth',()=>({useMistSession:()=>({sessionKey:'company-admin',hasRole:()=>true,hasPermission:()=>true})}));
vi.mock('../../runtime/organization',()=>({organizationApi:{
 orderApprovalAuthorities:async()=>({users:[{id:'manager',displayName:'主管'}],assignments:bridge.assignments}),
 supplierApprovalAuthority:async(kind:string,family:string)=>{const key=kind+':'+family;if(key===bridge.unavailable)throw new Error('连接中断');return{item:{userIds:key===bridge.assigned?['manager']:[],version:1}};},
}}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;bridge.assignments=[];bridge.assigned='' ;bridge.unavailable='';host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function mount(){await act(async()=>root.render(<MistRoot><ToastProvider><AdminApprovalAuthorities/></ToastProvider></MistRoot>));}
it('does not claim order submission is blocked when the order uses default organization routing',async()=>{
 await mount();expect(host.textContent).not.toContain('在配置前无法提交审批');
 expect(getByRole(host,'row',{name:/成衣订单/}).textContent).toContain('按组织审批');
 expect(getByRole(host,'row',{name:/面料订单/}).textContent).toContain('按组织审批');
});
it('does not mark default supplier routing as missing, while keeping an explicitly assigned list visible',async()=>{
 bridge.assigned='purchase:garment';await mount();expect(host.textContent).not.toContain('审批资格未配置');
 const assigned=getByRole(host,'row',{name:/成衣采购合同/});expect(assigned.textContent).toContain('主管');expect(assigned.textContent).toContain('已配置');
 expect(getByRole(host,'row',{name:/面料采购合同/}).textContent).toContain('按组织审批');
});
it('keeps an explicit order assignee and an unavailable supplier list distinct from default routing',async()=>{
 bridge.assignments=[{businessLine:'garment',userId:'manager'}];bridge.unavailable='processing:garment';await mount();
 const order=getByRole(host,'row',{name:/成衣订单/});expect(order.textContent).toContain('主管');expect(order.textContent).toContain('已配置');
 const supplier=getByRole(host,'row',{name:/成衣加工合同/});expect(supplier.textContent).toContain('不可读取');expect(supplier.textContent).not.toContain('按组织审批');
});
