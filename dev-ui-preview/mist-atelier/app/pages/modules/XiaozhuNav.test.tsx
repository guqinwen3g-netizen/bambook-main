// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getByRole} from '@testing-library/dom';
import {MistRoot} from '../../../../../components/mist';
import {XiaozhuNav,XiaozhuProposalList} from './XiaozhuNav';
import {conversationsOf} from '../../runtime/xiaozhuCowork';
let host:HTMLDivElement,root:Root;
const task=(o:any)=>({id:o.id,name:o.text,instructions:o.text,state:'succeeded',createdAt:o.at,updatedAt:o.at,result:'好',...o});
const props=(o:any={})=>({conversations:[],activeId:'',onSelect:vi.fn(),onNew:vi.fn(),confirmCount:0,runningCount:0,ruleCount:0,draftCount:0,onOpenConfirm:vi.fn(),onOpenTasks:vi.fn(),onOpenRules:vi.fn(),onOpenDrafts:vi.fn(),now:new Date('2026-11-09T12:00:00'),...o});
const paint=(node:React.ReactNode)=>act(async()=>root.render(<MistRoot>{node}</MistRoot>));
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('groups requests by conversation, newest first, and keeps old unnumbered requests together when close in time',()=>{
  const list=conversationsOf([task({id:'a',text:'交期',at:'2026-11-09T09:00:00Z',conversationId:'conv_aaaaaaaa'}),task({id:'b',text:'继续',at:'2026-11-09T09:05:00Z',conversationId:'conv_aaaaaaaa'}),task({id:'c',text:'邮件',at:'2026-11-09T10:00:00Z',conversationId:'conv_bbbbbbbb'}),task({id:'d',text:'旧一',at:'2026-11-01T09:00:00Z'}),task({id:'e',text:'旧二',at:'2026-11-01T09:10:00Z'}),task({id:'f',text:'旧三',at:'2026-11-01T12:00:00Z'})] as any);
  expect(list.map(c=>[c.title,c.tasks.length])).toEqual([['邮件',1],['交期',2],['旧三',1],['旧一',2]]);
  expect(list.find(c=>c.title==='旧一')?.legacy).toBe(true);
});
it('lists conversations under day headings, marks the open one and switches',async()=>{
  const p=props({activeId:'x',conversations:[{id:'x',title:'今天的问题',lastAt:'2026-11-09T10:00:00',tasks:[],active:true},{id:'y',title:'昨天的问题',lastAt:'2026-11-08T10:00:00',tasks:[],active:false}]});
  await paint(<XiaozhuNav {...p}/>);
  expect(host.textContent).toContain('今天');expect(host.textContent).toContain('昨天');
  expect(getByRole(host,'button',{name:/今天的问题/}).getAttribute('aria-current')).toBe('true');
  await act(async()=>getByRole(host,'button',{name:'昨天的问题'}).click());expect(p.onSelect).toHaveBeenCalledWith('y');
  await act(async()=>getByRole(host,'button',{name:'新对话'}).click());expect(p.onNew).toHaveBeenCalled();
});
it('shows counts on the entries and opens each one',async()=>{
  const p=props({confirmCount:2,draftCount:1});await paint(<XiaozhuNav {...p}/>);
  await act(async()=>getByRole(host,'button',{name:/待我确认/}).click());expect(p.onOpenConfirm).toHaveBeenCalled();
  expect(getByRole(host,'button',{name:/待我确认/}).textContent).toContain('2');
  for(const [name,fn] of [['任务','onOpenTasks'],['自动规则','onOpenRules'],['草稿','onOpenDrafts']] as const){await act(async()=>getByRole(host,'button',{name:new RegExp(name)}).click());expect(p[fn]).toHaveBeenCalled();}
});
it('lists pending confirmations with their risk',async()=>{
  const open=vi.fn();await paint(<XiaozhuProposalList proposals={[{id:'p1',state:'pending',command:{type:'finance.payment.save',payload:{}},summary:['登记付款 100 USD']}] as any} onOpen={open}/>);
  expect(host.textContent).toContain('高风险');await act(async()=>(host.querySelector('.mist-xz-item') as HTMLButtonElement).click());expect(open).toHaveBeenCalledWith('p1');
});
