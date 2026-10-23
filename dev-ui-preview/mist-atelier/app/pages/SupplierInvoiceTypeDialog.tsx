import React from 'react';
import {Banner,Button,Dialog,Field,FormGrid,Select,TextArea} from '../../../../components/mist';
import {SUPPLIER_INVOICE_TYPES,type SupplierBill,type SupplierInvoiceType} from '../../../../server/src/shared/mistPayables';
import {uiText} from '../../../../services/interfaceLanguage';
import {useMistWorkspace} from '../runtime/workspace';
import {DraftFiles} from './modules/fulfillmentKit';

export function SupplierInvoiceTypeDialog({bill,onClose}:{bill:SupplierBill;onClose:()=>void}){
 const workspace=useMistWorkspace();
 const [invoiceType,setInvoiceType]=React.useState<SupplierInvoiceType|''>(bill.invoiceType||''),[reason,setReason]=React.useState(''),[fileIds,setFileIds]=React.useState([...bill.fileIds]);
 const [working,setWorking]=React.useState(false),[uploading,setUploading]=React.useState(false),[failure,setFailure]=React.useState('');
 const live=React.useRef(true),lock=React.useRef(false);React.useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const busy=working||uploading||workspace.saving||!!workspace.pending;
 const save=async()=>{
  if(busy||lock.current||!invoiceType||!reason.trim())return;lock.current=true;setWorking(true);setFailure('');
  try{await workspace.run({type:'payable.bill.classify',payload:{id:bill.id,invoiceType,reason:reason.trim(),fileIds}});if(live.current)onClose();}
  catch(error){if(live.current)setFailure(error instanceof Error?error.message:'票种未保存');}
  finally{lock.current=false;if(live.current)setWorking(false);}
 };
 return <Dialog open title={uiText('核对票种')} onClose={()=>{if(!busy)onClose();}} footer={<><Button disabled={busy} onClick={onClose}>{uiText('取消')}</Button><Button variant="primary" loading={working} disabled={busy||!invoiceType||!reason.trim()||invoiceType==='vat-special'&&!fileIds.length} onClick={()=>void save()}>{uiText('保存')}</Button></>}>
  {failure&&<Banner tone="bad" title={uiText('票种未保存')}>{uiText(failure)}</Banner>}
  <FormGrid>
   <Field label={uiText('发票类型')} required><Select aria-label={uiText('发票类型')} value={invoiceType} disabled={busy} onChange={event=>setInvoiceType(event.target.value as SupplierInvoiceType)} options={[{value:'',label:'请选择发票类型'},...Object.entries(SUPPLIER_INVOICE_TYPES).map(([value,label])=>({value,label}))]}/></Field>
   <Field label={uiText('核对依据')} required full><TextArea aria-label={uiText('核对依据')} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></Field>
   <Field label={uiText('发票原件')} required={invoiceType==='vat-special'} full><DraftFiles ids={fileIds} onChange={setFileIds} onBusyChange={setUploading} disabled={working||workspace.saving||!!workspace.pending} hint="上传发票原件"/></Field>
  </FormGrid>
 </Dialog>;
}
