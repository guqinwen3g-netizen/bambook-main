// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {getByRole,queryByRole} from '@testing-library/dom';
import {MistRoot} from '../../../../../components/mist';
import {frozenCreditDocumentFixture,CREDIT_DOCUMENT_IDS as ids,CREDIT_DOCUMENT_NOW as now} from '../../../../../server/src/mist/__tests__/creditDocumentsFixture';
import {prepareCreditDocumentSnapshot,type MistCreditPrintVersion} from '../../../../../server/src/shared/mistCreditDocuments';
import {ClaimCreditDocuments} from './ClaimCreditDocuments';
let host:HTMLDivElement,root:Root,state:ReturnType<typeof frozenCreditDocumentFixture>;
const prepare=vi.fn(async()=>({})),issue=vi.fn(async()=>({})),download=vi.fn(async()=>({})),openEditor=vi.fn();
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();state=frozenCreditDocumentFixture({id:'proof',name:'proof.pdf',mimeType:'application/pdf',size:20,storageKey:'space/proof',createdAt:now});for(const fn of [prepare,issue,download,openEditor])fn.mockClear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const credit=()=>state.platform.credits[0];
function print(revision:number,previous?:string):MistCreditPrintVersion{const snapshot=prepareCreditDocumentSnapshot(state,ids.credit,ids.source,{now,actorId:'writer',actorName:'业务员'});snapshot.printRevision=revision;if(previous)snapshot.correction={correctsPrintId:previous,reason:'Internal correction record'};return{id:'print-'+revision,version:revision,sourceVersionId:ids.source,sourceFingerprint:snapshot.sourceFingerprint,templateId:snapshot.templateId,templateVersion:snapshot.templateVersion,snapshot,snapshotFingerprint:'a'.repeat(64),issuedAt:now,issuedById:'writer',issuedBy:'业务员',fileId:'file-'+revision,fileName:'CN-v'+revision+'.pdf',sha256:'b'.repeat(64),bytes:100};}
function render(write=true,cancelled=false){act(()=>root.render(<MistRoot><ClaimCreditDocuments credit={credit()} cancelled={cancelled} read write={write} busy={false} perform={fn=>fn()} prepare={prepare} issue={issue} download={download} openEditor={openEditor}/></MistRoot>));}
async function click(name:string){await act(async()=>getByRole(host,'button',{name,exact:true}).click());}
it('keeps first issue separate from correction and binds it to the real business source',async()=>{render();expect(queryByRole(host,'button',{name:'更正文书'})).toBeNull();await click('预览草稿 V1');expect(prepare).toHaveBeenCalledWith(ids.credit,ids.source);await click('签发正式 V1');expect(issue).toHaveBeenCalledWith(ids.credit,ids.source);});
it('shows all immutable print revisions and corrects only the current print on the same approved source',async()=>{
 const first=print(1);credit().printVersions=[first,print(2,first.id)];render();expect(host.textContent).toContain('历史版本');expect(host.textContent).not.toContain('Internal correction record');
 await click('下载正式 V1');expect(download).toHaveBeenLastCalledWith(ids.credit,'print-1');await click('下载正式 V2');expect(download).toHaveBeenLastCalledWith(ids.credit,'print-2');
 await click('预览更正');expect(prepare).toHaveBeenLastCalledWith(ids.credit,ids.source);await click('更正文书');const spec=openEditor.mock.calls[0][0];expect(spec.description).toContain('V2');await spec.submit({reason:'Fix customer document'});expect(issue).toHaveBeenLastCalledWith(ids.credit,ids.source,{correctsPrintId:'print-2',reason:'Fix customer document'});
 await click('文书记录');expect(host.textContent).toContain('Internal correction record');
});
it('keeps finance/read-only viewers and cancelled cases from correcting originals',()=>{credit().printVersions=[print(1)];render(false);expect(queryByRole(host,'button',{name:'更正文书'})).toBeNull();expect(getByRole(host,'button',{name:'下载正式 V1'})).toBeTruthy();render(true,true);expect(queryByRole(host,'button',{name:'更正文书'})).toBeNull();});
