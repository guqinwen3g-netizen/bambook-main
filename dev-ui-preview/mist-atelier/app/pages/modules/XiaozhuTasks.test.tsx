// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {MistRoot} from '../../../../../components/mist';
const seam=vi.hoisted(()=>({api:vi.fn(),chat:true}));
vi.mock('../../runtime/auth',()=>({useMistSession:()=>({sessionKey:'A',user:{id:'sales'},hasPermission:()=>seam.chat})}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>({workspace:{id:'ws'}}),mistApiRequest:(...a:any[])=>seam.api(...a)}));
vi.mock('../../nav',()=>({useNav:()=>({go:vi.fn(),route:{view:'assistant',section:'tasks'}})}));
vi.mock('../AgentTasks',()=>({AgentTasks:()=><div>任务列表</div>}));
import {XiaozhuTasks} from './XiaozhuTasks';
let host:HTMLDivElement,root:Root;
const paint=()=>act(async()=>root.render(<MistRoot><XiaozhuTasks open onClose={()=>undefined}/></MistRoot>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;seam.chat=true;seam.api.mockReset();seam.api.mockResolvedValue({month:'2026-11',scope:'mine',items:[{ownerId:'sales',ownerName:'顾言',tasks:2,modelTurns:5,runtimeMs:0}]});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('lists the delegated tasks and this month usage',async()=>{await paint();await act(async()=>{await Promise.resolve();});expect(document.body.textContent).toContain('任务列表');expect(document.body.textContent).toContain('模型调用 5 次');expect(seam.api.mock.calls[0][0]).toContain('/personal-agent/usage?month=');});
it('reads nothing without AI permission',async()=>{seam.chat=false;await paint();expect(document.body.textContent).toContain('无 AI 使用权限');expect(seam.api).not.toHaveBeenCalled();});
