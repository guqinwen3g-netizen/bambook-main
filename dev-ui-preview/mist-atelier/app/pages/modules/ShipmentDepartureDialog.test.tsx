// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {getByRole} from '@testing-library/dom';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {MistRoot,ToastProvider} from '../../../../../components/mist';
import {createMistState} from '../../../../../server/src/shared/mistWorkspace';
import type {FulfillmentShipment} from '../../../../../server/src/shared/mistFulfillment';
import {Nav} from '../../nav';
const store=vi.hoisted(()=>({workspace:{id:'company-a'},state:null as ReturnType<typeof createMistState>|null,saving:false,pending:null as any,run:vi.fn(),uploadFile:vi.fn(),downloadFile:vi.fn(),recover:vi.fn(),commandRecovery:null as any}));
vi.mock('../../runtime/workspace',()=>({useMistWorkspace:()=>store}));
vi.mock('../../runtime/auth',()=>({useMistSession:()=>({user:{id:'ops'},sessionKey:'ops',hasPermission:()=>true}),useOptionalMistSession:()=>({user:{id:'ops'},sessionKey:'ops',hasPermission:()=>true})}));
import {ShipmentDepartureDialog} from './ShipmentDepartureDialog';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLElement,root:Root,shipment:FulfillmentShipment;const close=vi.fn();
const render=()=>act(()=>root.render(<MistRoot><ToastProvider><Nav.Provider value={{route:{view:'shipments',id:'shipment'},go:vi.fn(),theme:'light',toggleTheme:vi.fn(),openPalette:vi.fn(),openAI:vi.fn()}}><ShipmentDepartureDialog shipment={shipment} onClose={close}/></Nav.Provider></ToastProvider></MistRoot>));
beforeEach(()=>{vi.clearAllMocks();store.workspace={id:'company-a'};store.pending=null;store.commandRecovery=null;store.state=createMistState({id:()=>crypto.randomUUID(),now:'2026-11-13T12:00:00Z',actorName:'后勤',actorId:'ops'} as any,'empty');shipment={id:'shipment',code:'SHP',customerId:'customer',customer:'Customer',domain:'garment',consignee:'Customer',mode:'sea',portOfLoading:'上海',portOfDischarge:'目的港',incoterm:'FOB',plannedDate:'2026-11-13',booking:'BOOK',lines:[],note:'',fileIds:[],state:'ready',requestedBy:'业务',requesterId:'sales',createdAt:'2026-11-13T10:00:00Z'};store.state.fulfillment.shipments=[structuredClone(shipment)];host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('dismisses a stale departure form after the confirmed current record has departed, without submitting again',async()=>{
 store.run.mockImplementationOnce(async(command:any)=>{store.pending={workspaceId:'company-a',actorId:'ops',requestId:'original',kind:'command',command};throw new Error('服务器不可达或超时，请检查网络');});render();
 const input=getByRole(document.body,'textbox',{name:'实际离港 / 起飞依据'}) as HTMLTextAreaElement;
 act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'已核对承运人离港通知');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>getByRole(document.body,'button',{name:'登记离港'}).click());expect(document.body.textContent).toContain('离港结果待核对');expect(close).not.toHaveBeenCalled();
 store.pending=null;store.state!.fulfillment.shipments[0].state='departed';render();expect(close).toHaveBeenCalledTimes(1);expect(store.run).toHaveBeenCalledTimes(1);
});
it('keeps the form for a still-ready source when an unrelated record or acknowledgement changes',()=>{
 render();store.state!.fulfillment.shipments.push({...shipment,id:'another',state:'departed'});store.commandRecovery={workspaceId:'company-a',actorId:'ops',requestId:'unrelated',revision:2};render();expect(close).not.toHaveBeenCalled();expect(store.run).not.toHaveBeenCalled();
});
it('dismisses the old company form without writing when the company changes',()=>{render();store.workspace={id:'company-b'};render();expect(close).toHaveBeenCalledTimes(1);expect(store.run).not.toHaveBeenCalled();});
it('dismisses a source which is no longer visible without retaining an actionable stale form',()=>{render();store.state!.fulfillment.shipments=[];render();expect(close).toHaveBeenCalledTimes(1);expect(store.run).not.toHaveBeenCalled();});
it('dismisses previously complete source data when the current scope only exposes part of the shipment',()=>{render();store.state!.fulfillment.shipments[0].hiddenCount=1;render();expect(close).toHaveBeenCalledTimes(1);expect(store.run).not.toHaveBeenCalled();});
it('dismisses the stale departure form when the source has been cancelled',()=>{render();store.state!.fulfillment.shipments[0].state='cancelled';render();expect(close).toHaveBeenCalledTimes(1);expect(store.run).not.toHaveBeenCalled();});
