// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {Sparkles} from 'lucide-react';
import {AIBrief} from './patterns';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
it('keeps summary rows static when they have no action',async()=>{const host=document.createElement('div'),root=createRoot(host);document.body.append(host);await act(async()=>root.render(<AIBrief icon={Sparkles} items={[{strong:'最新动态',text:'订单已交付'}]}/>));expect(host.textContent).toContain('订单已交付');expect(host.querySelector('button')).toBeNull();await act(async()=>root.unmount());host.remove();});
it('preserves source and question actions when supplied',async()=>{const host=document.createElement('div'),root=createRoot(host),open=vi.fn(),ask=vi.fn();document.body.append(host);await act(async()=>root.render(<AIBrief icon={Sparkles} items={[{strong:'订单',text:'查看来源',onClick:open}]} onAsk={ask}/>));const buttons=host.querySelectorAll('button');await act(async()=>{buttons[0].click();buttons[1].click();});expect(open).toHaveBeenCalledOnce();expect(ask).toHaveBeenCalledOnce();await act(async()=>root.unmount());host.remove();});
