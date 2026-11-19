// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import {Checkbox,ChoiceCards,Field,TextInput} from './form';
import {getAllByRole,getByRole} from '@testing-library/dom';

it('moves and selects radio cards with arrow keys and keeps a single Tab stop',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);const changed:string[]=[];
 function Example(){const[value,setValue]=React.useState('fabric');return <Field group label="业务类型"><ChoiceCards ariaLabel="业务类型" value={value} onChange={next=>{changed.push(next);setValue(next);}} options={[{value:'fabric',title:'面料'},{value:'garment',title:'成衣'},{value:'service',title:'服务'}]}/></Field>;}
 const key=async(name:string)=>act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));});
 try{await act(async()=>root.render(<Example/>));let radios=getAllByRole(host,'radio');expect(radios.map(r=>r.tabIndex)).toEqual([0,-1,-1]);radios[0].focus();await key('ArrowRight');radios=getAllByRole(host,'radio');expect(document.activeElement).toBe(radios[1]);expect(radios[1].getAttribute('aria-checked')).toBe('true');expect(radios.map(r=>r.tabIndex)).toEqual([-1,0,-1]);await key('ArrowUp');expect(document.activeElement).toBe(radios[0]);await key('ArrowLeft');expect(document.activeElement).toBe(radios[2]);await key('Home');expect(document.activeElement).toBe(radios[0]);await key('End');expect(document.activeElement).toBe(radios[2]);expect(changed).toEqual(['garment','fabric','service','fabric','service']);const event=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});document.activeElement!.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
 }finally{act(()=>root.unmount());host.remove();}
});
it('offers the first unselected radio card on Tab and leaves disabled cards inert',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host);document.body.append(host);const changed:string[]=[];const options=[{value:'a',title:'客户要求'},{value:'b',title:'内部需求'}];
 try{await act(async()=>root.render(<ChoiceCards ariaLabel="发起方" value="" options={options} onChange={v=>changed.push(v)}/>));expect(getAllByRole(host,'radio').map(r=>r.tabIndex)).toEqual([0,-1]);await act(async()=>root.render(<ChoiceCards ariaLabel="发起方" value="a" options={options} disabled onChange={v=>changed.push(v)}/>));const radio=getByRole(host,'radio',{name:'客户要求'});await act(async()=>{radio.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));});expect(getAllByRole(host,'radio').map(r=>r.tabIndex)).toEqual([-1,-1]);expect(changed).toEqual([]);
 }finally{act(()=>root.unmount());host.remove();}
});

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
