// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole} from '@testing-library/dom';
import {MistRoot} from '../../../../../components/mist';
const store=vi.hoisted(()=>({state:{files:[{id:'f1',name:'报价单.pdf'}]} as any,uploadFile:vi.fn(),downloadFile:vi.fn()}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
import {DraftFiles} from './fulfillmentKit';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);store.uploadFile.mockReset();});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=(ids:string[],onChange:(ids:string[])=>void,disabled=false)=>act(()=>root.render(<MistRoot><DraftFiles ids={ids} onChange={onChange} disabled={disabled}/></MistRoot>));
it('uploads new files into the draft ids and removes attached ones',async()=>{
  const onChange=vi.fn();store.uploadFile.mockResolvedValue({id:'f2',name:'邮件.png'});render(['f1'],onChange);
  expect(host.textContent).toContain('报价单.pdf');
  const input=host.querySelector('input[type="file"]') as HTMLInputElement;
  const file=new File(['x'],'邮件.png',{type:'image/png'});Object.defineProperty(input,'files',{value:[file]});
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(store.uploadFile).toHaveBeenCalledWith(file);expect(onChange).toHaveBeenLastCalledWith(['f1','f2']);
  await act(async()=>getByRole(host,'button',{name:'移除'}).click());expect(onChange).toHaveBeenLastCalledWith([]);
});
it('is read-only when disabled',()=>{render(['f1'],vi.fn(),true);expect(host.querySelector('input[type="file"]')).toBeNull();expect(host.textContent).not.toContain('移除');});
