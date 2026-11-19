// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getByRole,getAllByRole,within} from '@testing-library/dom';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState} from '../../../../../server/src/shared/mistWorkspace';
const bridge=vi.hoisted(()=>({value:null as any,userId:'reader'}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>bridge.value}));
vi.mock('../../runtime/auth',()=>{const useMistSession=()=>({user:{id:bridge.userId},hasPermission:()=>false});return{useMistSession,useOptionalMistSession:useMistSession};});
import {CustomerStatementCard} from './CustomerStatements';
let host:HTMLElement,root:Root;
const number=(i:number)=>'SOA-2026-'+String(i).padStart(4,'0');
function history(count=9,sameTime=false,customerId='customer'){
 const state=createMistState({id:()=>'',now:'2026-11-13T12:00:00Z',actorName:'Finance'},'empty');state.customers=[{id:customerId,name:'Customer'}] as any;
 state.customerStatements=Array.from({length:count},(_,index)=>{const i=index+1;return{id:'statement-'+i,customerId,statementNo:number(i),seq:i,fileId:'file-'+i,fileName:number(i)+'.pdf',asOf:'2026-11-13',generatedAt:sameTime?'2026-11-13T12:00:00Z':new Date(Date.UTC(2026,10,13,12,i)).toISOString(),generatedBy:'Finance',totals:[{currency:'USD',net:'10.00'}]} as any;});
 state.files=state.customerStatements.map(row=>({id:row.fileId,name:row.fileName,mimeType:'application/pdf',size:20,storageKey:'workspace/'+row.fileId,createdAt:row.generatedAt}));return state;
}
const render=(customerId='customer')=>act(()=>root.render(<MistRoot><ToastProvider><CustomerStatementCard customerId={customerId}/></ToastProvider></MistRoot>));
const rows=()=>getAllByRole(getByRole(host,'list',{name:'已生成的客户对账单',exact:true}),'listitem');
const more=()=>act(()=>getByRole(host,'button',{name:'更多记录',exact:true}).click());
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;bridge.userId='reader';bridge.value={workspace:{id:'workspace'},state:history(),run:vi.fn(),downloadFile:vi.fn().mockResolvedValue(undefined)};host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('keeps an archive older than eight records reachable and downloads its existing file without generating a replacement',async()=>{
 const before=structuredClone(bridge.value.state.customerStatements);render();expect(rows()).toHaveLength(8);expect(host.textContent).not.toContain(number(1));more();expect(rows()).toHaveLength(9);expect(()=>getByRole(host,'button',{name:'更多记录',exact:true})).toThrow();
 const old=rows().find(row=>row.textContent?.includes(number(1)))!;await act(async()=>within(old).getByRole('button',{name:'下载',exact:true}).click());expect(bridge.value.downloadFile).toHaveBeenCalledWith(bridge.value.state.files[0]);expect(bridge.value.run).not.toHaveBeenCalled();expect(bridge.value.state.customerStatements).toEqual(before);act(()=>getByRole(host,'button',{name:'收起记录',exact:true}).click());expect(rows()).toHaveLength(8);
});
it('orders same-clock archives by their sequence so a newly generated statement appears first',()=>{
 bridge.value.state=history(9,true);render();expect(rows()[0].textContent).toContain(number(9));expect(host.textContent).not.toContain(number(1));const button=getByRole(host,'button',{name:'更多记录',exact:true});button.focus();more();expect(rows().at(-1)!.textContent).toContain(number(1));expect(document.activeElement).toBe(button);expect(button.textContent).toBe('收起记录');
});
it.each(['company','customer','account'])('resets expanded history when the current %s changes',change=>{
 render();more();expect(rows()).toHaveLength(9);let customerId='customer';
 if(change==='company')bridge.value.workspace={id:'new-workspace'};
 if(change==='customer'){customerId='new-customer';bridge.value.state=history(9,false,customerId);}
 if(change==='account')bridge.userId='new-reader';
 render(customerId);expect(rows()).toHaveLength(8);expect(getByRole(host,'button',{name:'更多记录',exact:true})).toBeTruthy();expect(bridge.value.run).not.toHaveBeenCalled();
});
it('expands authorized partial summaries without exposing a full-document download',()=>{
 const state=history(10);state.partialStatements=state.customerStatements!.map(row=>({id:row.id,customerId:row.customerId,statementNo:row.statementNo,asOf:row.asOf,hiddenCount:1,sections:[{currency:'USD',lines:[{invoiceId:'visible-invoice',code:'VISIBLE',open:'5.00'}],hiddenCount:1}]})) as any;state.customerStatements=[];state.files=[];bridge.value.state=state;
 render();expect(rows()).toHaveLength(8);more();expect(rows()).toHaveLength(10);expect(host.textContent).toContain('部分可见');expect(()=>getByRole(host,'button',{name:'下载',exact:true})).toThrow();expect(bridge.value.run).not.toHaveBeenCalled();expect(bridge.value.downloadFile).not.toHaveBeenCalled();
});
