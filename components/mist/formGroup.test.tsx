// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import {Checkbox,Field,TextInput} from './form';

it('gives a multi-checkbox group its own name without changing individual control labels or toggling them from the group caption',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);let changes=0;
 try{await act(async()=>root.render(<Field group label="业务属性" full hint="影响本部门全部成员"><Checkbox checked onChange={()=>changes++} label="面料业务"/><Checkbox checked={false} onChange={()=>changes++} label="成衣业务"/></Field>));const group=host.querySelector('[role="group"]')!,caption=document.getElementById(group.getAttribute('aria-labelledby')!)!;expect(caption.textContent).toBe('业务属性');expect(group.hasAttribute('data-full')).toBe(true);const controls=[...host.querySelectorAll('input')];expect(controls.map(c=>[...c.labels!].map(l=>l.textContent))).toEqual([['面料业务'],['成衣业务']]);await act(async()=>caption.click());expect(changes).toBe(0);await act(async()=>controls[0].click());expect(changes).toBe(1);
 }finally{act(()=>root.unmount());host.remove();}
});
it('keeps the ordinary implicit single-input label and required marker',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{await act(async()=>root.render(<Field label="客户名称" required><TextInput defaultValue="Pine Studio"/></Field>));const input=host.querySelector('input')!;expect(input.labels).toHaveLength(1);expect(input.labels![0].tagName).toBe('LABEL');expect(input.labels![0].querySelector('.mist-field-label')?.textContent).toBe('客户名称*');expect(host.querySelector('[role="group"]')).toBeNull();
 }finally{act(()=>root.unmount());host.remove();}
});
it('keeps separate labelled groups distinct and retains the existing error and layout attributes',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{await act(async()=>root.render(<><Field group label="面料" error="请选择" full><Checkbox checked={false} label="塔丝隆" onChange={()=>{}}/></Field><Field group label="成衣"><Checkbox checked={false} label="外套" onChange={()=>{}}/></Field></>));const groups=[...host.querySelectorAll('[role="group"]')];expect(new Set(groups.map(g=>g.getAttribute('aria-labelledby'))).size).toBe(2);expect(groups.map(g=>document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['面料','成衣']);expect(groups[0].getAttribute('data-error')).toBe('true');expect(groups[0].className).toBe('mist-field');
 }finally{act(()=>root.unmount());host.remove();}
});
