// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AssistantConversationProvider,useAssistantConversation} from '../../runtime/assistantConversation';
const seam=vi.hoisted(()=>({go:vi.fn(),chat:true}));
vi.mock('../../runtime/auth',()=>({useMistSession:()=>({sessionKey:'s',hasPermission:()=>seam.chat})}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>({workspace:{id:'w'}})}));
vi.mock('../../nav',()=>({useNav:()=>({go:seam.go})}));
import {XiaozhuLink} from './XiaozhuLink';
let root:Root,host:HTMLDivElement;
function Question(){return <output>{useAssistantConversation('s:w').question}</output>;}
const paint=()=>act(async()=>root.render(<AssistantConversationProvider scope="s:w"><XiaozhuLink question="核对到账"/><Question/></AssistantConversationProvider>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;sessionStorage.clear();seam.chat=true;seam.go.mockClear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('carries the question into the Xiaozhu page',async()=>{await paint();await act(async()=>host.querySelector('button')!.click());expect(seam.go).toHaveBeenCalledWith('assistant');expect(host.querySelector('output')!.textContent).toBe('核对到账');});
it('offers no link without AI permission',async()=>{seam.chat=false;await paint();expect(host.querySelector('button')).toBeNull();});
