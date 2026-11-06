// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MistRoot} from '../../../../components/mist';
import {internalDeliveryFixture} from '../../../../server/src/mist/__tests__/internalDelivery';
import {MemberHandover} from './MemberHandover';
const seam=vi.hoisted(()=>({workspace:{run:vi.fn(),pending:false} as any}));
vi.mock('../runtime/workspace',()=>({useMistWorkspace:()=>seam.workspace}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it('previews the open internal deliveries a departing receiver still has to count',()=>{
 const f=internalDeliveryFixture();f.send(6);
 const directory=f.context.members!.map(m=>({id:m.id,name:m.name,groups:m.groups})) as any;
 act(()=>root.render(<MistRoot><MemberHandover state={f.state} directory={directory} busy={false}/></MistRoot>));
 const from=host.querySelector('select[aria-label="交接原负责人"]') as HTMLSelectElement;
 expect([...from.options].map(o=>o.value)).toContain('warehouse');
 act(()=>{from.value='warehouse';from.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(host.querySelector('[data-handover-preview]')!.textContent).toContain('待接收内部交付 1 笔');
});
