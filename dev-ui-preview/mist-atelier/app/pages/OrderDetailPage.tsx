import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
import {MistPresentedErrorContext} from '../runtime/errorPresentation';
import {RecordDisclosure} from './modules/pageKit';
import {OrderProductThumb} from './OrderProductThumb';
/** T5 单据详情：沿用原 Mist 结构，全部内容属于当前订单。 */
import React from 'react';
import { BadgeCheck, Factory, FileText, Handshake, Package, Pencil, Send, Ship, Wallet } from 'lucide-react';
import { BackLink, Banner, Button, Card, CardHeader, Checklist, DataTable, Dialog, Donut, Drawer, EmptyState, Field, FlowSteps, FormGrid, KeyValue, Meter, MistPage, Mono, ObjectCell, PageHeader, Pill, Select, SummaryBar, TextArea, TextInput, Thumb, UploadZone, useToast } from '../../../../components/mist';
import type { View } from '../../../../types';
import type { MistOrder, MistOrderLine } from '../../../../server/src/shared/mistWorkspace';
import { fmt } from '../data';
import { useNav } from '../nav';
import { useMistWorkspace } from '../runtime/workspace';
import { useOptionalMistSession } from '../runtime/auth';
import { memberSelectOptions, workspaceMembers } from '../runtime/members';
import { downloadMistCsv, mistDate } from './OrderListPage';
import { formatOrderQuantity, orderAmounts, sumOrderMoney } from './orderAmounts';
import {createOrderGovernance,type OrderGovernanceInput,type OrderGovernanceFields,type OrderGovernanceLine} from '../../../../server/src/shared/mistOrderGovernance';
import { OrderLineFulfillment } from './OrderLineFulfillment';
import { OrderLineQuotationValue, OrderLineSourceValue, lineQuotation } from './orderLineSource';
import { OrderBreakdownEditor } from './OrderBreakdownEditor';
import { OrderChangeImpactList } from './OrderChangeImpactList';
import { OrderTerminationBanner, OrderTerminationButton, orderLocked } from './OrderTermination';
import { fulfillmentProductionQcPassed, fulfillmentProductionFact } from '../../../../server/src/shared/mistFulfillment';
import { lineShipping } from './orderLineTrack';
import { isLineClosed } from '../../../../server/src/shared/mistOrderClosure';
import { orderLineFacts } from '../../../../server/src/shared/mistOrderChangeImpact';
import { toleranceText } from '../../../../server/src/shared/mistOrderClosure';
import { breakdownDiff, breakdownShort, breakdownTotal, normalizeOrderBreakdown, type OrderLineBreakdown } from '../../../../server/src/shared/mistOrderBreakdown';
import {orderFundingCoveredAmount} from '../../../../server/src/shared/mistOrderFunding';
import { FileName } from '../runtime/files';
import { useDevice } from '../runtime/devicePreferences';
import { GarmentFulfillmentFields, garmentFulfillmentLabel, cmtIncludedLabel } from './GarmentFulfillmentFields';
import type { GarmentFulfillmentFields as FulfillmentFields } from '../../../../server/src/shared/mistInternalFabric';
import { InternalSupplyFields } from './InternalSupplyFields';
import { InternalFabricPanel } from './InternalFabricPanel';

function OrderContractDialog({order,open,onClose}:{order:MistOrder&{governance?:OrderGovernanceFields};open:boolean;onClose:()=>void}){
 const w=useMistWorkspace(),toast=useToast(),session=useOptionalMistSession(),members=workspaceMembers(w.workspace,w.state,session?.user);const [contract,setContract]=React.useState<OrderGovernanceInput>(()=>createOrderGovernance({id:()=>'',now:'',actorName:''}).contract),[reason,setReason]=React.useState(''),[failure,setFailure]=React.useState(''),[busy,setBusy]=React.useState(false);
 const active=React.useRef(true),lock=React.useRef(false);React.useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 React.useEffect(()=>{if(open){setContract(structuredClone(order.governance?.changeDraft?.contract||order.governance?.contract||createOrderGovernance({id:()=>'',now:'',actorName:''}).contract));setReason(order.governance?.changeDraft?.reason||'');setFailure('');}},[open,order.id]);
 const disabled=busy||w.loading||w.saving||!!w.pending||orderLocked(order)||order.governance?.status==='pending'||order.governance?.changeDraft?.status==='pending';
 const save=async()=>{if(lock.current||disabled)return;if(contract.internalSupply&&!members.some(member=>member.id===contract.internalSupply?.receiverId&&member.groups.includes('garment'))){setFailure('请选择成衣接收负责人');return;}lock.current=true;setBusy(true);setFailure('');try{await w.run({type:'order.governance.saveDraft',payload:{orderId:order.id,input:contract,...(order.governance?.changeDraft?{lines:order.governance.changeDraft.lines,orderPatch:order.governance.changeDraft.orderPatch}:{}),...(order.governance?.status==='approved'?{reason}: {})}});if(active.current){toast(order.governance?.status==='approved'?'变更草稿已保存，原批准内容继续生效':'合同资料已保存');onClose();}}catch(e){if(active.current)setFailure(e instanceof Error?e.message:'合同资料未保存');}finally{lock.current=false;if(active.current)setBusy(false);}};
 const upload=async(files:File[])=>{if(lock.current||disabled)return;lock.current=true;setBusy(true);setFailure('');try{for(const file of files){const stored=await w.uploadFile(file);if(active.current)setContract(c=>({...c,confirmationFileIds:[...new Set([...c.confirmationFileIds,stored.id])]}));}}catch(e){if(active.current)setFailure(e instanceof Error?e.message:'原件上传未完成');}finally{lock.current=false;if(active.current)setBusy(false);}};
 return <Dialog open={open} onClose={()=>{if(!busy)onClose();}} title={uiText(order.governance?.status==='approved'?'拟议合同变更':'合同与审批资料')} width={820} footer={<><Button disabled={busy} onClick={onClose}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={disabled} onClick={()=>void save()}>{uiText(order.governance?.status==='approved'?'保存变更草稿':'保存合同资料')}</Button></>}>
  {failure&&<Banner tone="bad" title={uiText("资料未保存")}>{failure}</Banner>}<FormGrid>
   <Field label={uiText("订单用途")}><Select value={contract.kind} disabled={disabled||!!order.replacementSource} onChange={e=>setContract(c=>{const {internalSupply:_old,...rest}=c;return {...rest,kind:e.target.value as OrderGovernanceInput['kind']};})} options={[{value:'external',label:'外部客户订单'},{value:'internal',label:'内部用途订单'}]}/></Field>
   {contract.kind==='external'?<Field label={uiText("PO / 合同号")}><TextInput value={contract.poNumber} onChange={e=>setContract(c=>({...c,poNumber:e.target.value}))}/></Field>:<InternalSupplyFields type={order.type} value={contract} members={members} onChange={setContract} disabled={disabled}/>}
   {contract.kind==='external'&&!order.replacementSource&&<><Field label={uiText("付款方式")}><Select value={contract.paymentMethod} onChange={e=>setContract(c=>({...c,paymentMethod:e.target.value as OrderGovernanceInput['paymentMethod']}))} options={['TT','LC','OA','OTHER']}/></Field><Field label={uiText("定金比例（%）")}><TextInput aria-label={uiText("定金比例（%）")} type="number" min="0" max="100" value={contract.depositPercent??''} onChange={e=>setContract(c=>({...c,depositPercent:e.target.value===''?null:Number(e.target.value)}))}/></Field>
   {contract.paymentMethod==='TT'&&<Field label={uiText("出运前累计收款（%）")}><TextInput aria-label={uiText("出运前累计收款（%）")} type="number" min="0" max="100" step="0.01" value={contract.preShipmentPercent??''} onChange={e=>setContract(c=>({...c,preShipmentPercent:e.target.value===''?null:Number(e.target.value)}))}/></Field>}</>}
   <Field label={uiText(contract.kind==='internal'?'交付方式':'贸易术语')}><TextInput value={contract.incoterm} onChange={e=>setContract(c=>({...c,incoterm:e.target.value}))}/></Field><Field label={uiText(contract.kind==='internal'?'交付地点':'指定地点 / 港口')}><TextInput value={contract.deliveryPlace} onChange={e=>setContract(c=>({...c,deliveryPlace:e.target.value}))}/></Field>{order.type==='garment'&&<><Field label={uiText("数量口径")}><Select aria-label={uiText("数量口径")} value={contract.quantityBasis||''} placeholder={uiText("待核对")} onChange={e=>setContract(c=>({...c,quantityBasis:(e.target.value||undefined) as OrderGovernanceInput['quantityBasis']}))} options={[{value:'total',label:'按总量'},{value:'size',label:'按尺码'}]}/></Field>{contract.quantityBasis&&<Field label={uiText("数量依据")} required><TextInput aria-label={uiText("数量依据")} value={contract.quantityBasisNote||''} onChange={e=>setContract(c=>({...c,quantityBasisNote:e.target.value}))}/></Field>}</>}{!order.replacementSource&&<><Field label={uiText("溢装上限 %")}><TextInput aria-label={uiText("溢装上限 %")} readOnly={!!order.replacementSource} type="number" min="0" max="10" step="0.1" value={contract.overPercent??''} onChange={e=>setContract(c=>({...c,overPercent:e.target.value===''?null:Number(e.target.value)}))}/></Field><Field label={uiText("短装下限 %")}><TextInput aria-label={uiText("短装下限 %")} readOnly={!!order.replacementSource} type="number" min="0" max="10" step="0.1" value={contract.shortPercent??''} onChange={e=>setContract(c=>({...c,shortPercent:e.target.value===''?null:Number(e.target.value)}))}/></Field></>}<Field label={uiText(order.replacementSource?'补发约定':contract.kind==='internal'?'交接约定':'付款条款原文')} full><TextArea readOnly={!!order.replacementSource} value={contract.paymentNote} onChange={e=>setContract(c=>({...c,paymentNote:e.target.value}))}/></Field>
   {order.governance?.status==='approved'&&<Field label={uiText("变更原因")} required full><TextArea value={reason} onChange={e=>setReason(e.target.value)}/></Field>}
  </FormGrid><div className="mist-section"><UploadZone title={uiText(contract.kind==='internal'?'上传内部依据':'上传客户 PO / 书面确认依据')} onFiles={files=>void upload(files)}/>{contract.confirmationFileIds.map(id=>{const file=w.state?.files.find(f=>f.id===id);return <div className="mist-row" key={id}>{file?<FileName file={file} files={contract.confirmationFileIds.map(x=>w.state?.files.find(f=>f.id===x))}/>:<span>{uiText("附件不可用")}</span>}<span className="mist-spacer"/>{file&&<Button variant="quiet" onClick={()=>void w.downloadFile(file).catch(e=>setFailure(e.message))}>{uiText("下载")}</Button>}<Button variant="quiet" disabled={disabled} onClick={()=>setContract(c=>({...c,confirmationFileIds:c.confirmationFileIds.filter(f=>f!==id)}))}>{uiText("移除")}</Button></div>;})}</div>
 </Dialog>;
}

function editableLineSnapshot(line:MistOrderLine):OrderGovernanceLine{
 const source=line as MistOrderLine&Partial<OrderGovernanceLine>;
 return{id:line.id,name:line.name,style:line.style,img:line.img,qty:line.qty,unit:line.unit,price:line.price,...(source.sourceProductId?{sourceProductId:source.sourceProductId}:{}),...(source.sourceDevId?{sourceDevId:source.sourceDevId}:{}),...(source.sourceVersionId?{sourceVersionId:source.sourceVersionId}:{}),...(source.breakdown?{breakdown:structuredClone(source.breakdown)}:{}),...(source.fulfillmentMode?{fulfillmentMode:source.fulfillmentMode,cmtIncludedItems:source.cmtIncludedItems}: {})};
}
function OrderLineDialog({order,line,lines,onClose}:{order:MistOrder;line:MistOrderLine|null;lines:MistOrderLine[];onClose:()=>void}){
 const workspace=useMistWorkspace(),toast=useToast();
 const [fulfillment,setFulfillment]=React.useState<FulfillmentFields>({});
 const [values,setValues]=React.useState({quantity:'',price:'',reason:''}),[breakdown,setBreakdown]=React.useState<OrderLineBreakdown|undefined>(),[failure,setFailure]=React.useState(''),[busy,setBusy]=React.useState(false);
 const live=React.useRef(true),lock=React.useRef(false),generation=React.useRef(0);
 React.useEffect(()=>{live.current=true;return()=>{live.current=false;generation.current++;};},[]);
 React.useEffect(()=>{generation.current++;const current=order.governance?.changeDraft?.lines.find(item=>item.id===line?.id)||line;setFulfillment(current?.fulfillmentMode?{fulfillmentMode:current.fulfillmentMode,cmtIncludedItems:current.cmtIncludedItems}:{});setValues({quantity:current?String(current.qty):'',price:current?String(current.price):'',reason:order.governance?.changeDraft?.reason||''});setBreakdown((current as Partial<OrderGovernanceLine>|null)?.breakdown?structuredClone((current as Partial<OrderGovernanceLine>).breakdown):undefined);setFailure('');setBusy(false);lock.current=false;},[order.id,line?.id]);
 const approved=order.governance?.status==='approved';
 const facts=line&&workspace.state?orderLineFacts(workspace.state,line.id):null,floor=approved&&facts&&facts.floor>0?facts:null;
 const disabled=busy||workspace.loading||workspace.saving||!!workspace.pending||!!workspace.pendingCreate||orderLocked(order)||order.governance?.status==='pending'||order.governance?.changeDraft?.status==='pending';
 const save=async()=>{
  if(!line||disabled||lock.current)return;
  if(breakdown){try{normalizeOrderBreakdown(order.type,breakdown);}catch(error){setFailure(error instanceof Error?error.message:'分色分码填写有误');return;}}
  const quantity=breakdown?breakdownTotal(breakdown):Number(values.quantity),price=Number(values.price);
  if((!breakdown&&!values.quantity.trim())||!Number.isFinite(quantity)||quantity<=0||!values.price.trim()||!Number.isFinite(price)||price<0){setFailure('请填写大于零的订单数量及有效销售单价');return;}
  const proposal=order.governance?.changeDraft,baseLines=proposal?.lines||lines.map(editableLineSnapshot);
  if(!baseLines.some(item=>item.id===line.id)){setFailure('当前条目已不可用，请返回订单重新核对');return;}
  const ticket=generation.current;lock.current=true;setBusy(true);setFailure('');
  try{
   await workspace.run({type:'order.governance.saveDraft',payload:{orderId:order.id,input:proposal?.contract||order.governance?.contract||createOrderGovernance({id:()=>'',now:'',actorName:''}).contract,lines:baseLines.map(item=>{if(item.id!==line.id)return item;const {breakdown:_old,...rest}=item;return {...rest,qty:quantity,price,...(order.type==='garment'?fulfillment:{}),...(breakdown?{breakdown}:{})};}),...(proposal?{orderPatch:proposal.orderPatch}:{}),...(approved?{reason:values.reason}:{})}});
   if(live.current&&ticket===generation.current){toast(approved?'条目变更草稿已保存，原批准内容继续生效':'订单条目已保存');onClose();}
  }catch(error){if(live.current&&ticket===generation.current)setFailure(error instanceof Error?error.message:'条目未保存，请重试');}
  finally{if(live.current&&ticket===generation.current){lock.current=false;setBusy(false);}}
 };
 return <Dialog open={!!line} onClose={()=>{if(!busy)onClose();}} title={uiText("编辑订单条目")} description={uiText(line?`${order.code} · ${line.style} · ${line.name}`:undefined)} footer={<><Button disabled={busy} onClick={onClose}>{uiText("取消")}</Button><Button variant="primary" disabled={disabled} loading={busy} onClick={()=>void save()}>{uiText("保存条目")}</Button></>}>
  {failure&&<Banner tone="bad" title={uiText("条目未保存")}>{failure}</Banner>}
  {approved&&<p className="mist-note">{uiText("保存为待审批变更；原批准数量与单价继续生效。")}</p>}
  <FormGrid><Field label={uiText("订单数量")} required hint={<>{uiText(breakdown?'由分色分码合计':line?.unit)}{floor&&<span data-line-floor>{uiText(" · 不得低于 ")}{formatOrderQuantity(floor.floor)} {line?.unit}{uiText("（已完工 ")}{formatOrderQuantity(floor.completed)}{uiText(" · 已排出运 ")}{formatOrderQuantity(floor.shipped)}）</span>}</>}><TextInput aria-label={uiText("订单数量")} readOnly={!!order.replacementSource} type="number" min="0" step="any" value={breakdown?String(breakdownTotal(breakdown)):values.quantity} disabled={disabled||!!breakdown} onChange={event=>setValues(current=>({...current,quantity:event.target.value}))}/></Field><Field label={uiText("销售单价")} required hint={uiText(order.currency)}><TextInput aria-label={uiText("销售单价")} readOnly={!!order.replacementSource} type="number" min="0" step="0.01" value={values.price} disabled={disabled} onChange={event=>setValues(current=>({...current,price:event.target.value}))}/></Field>{order.type==='garment'&&<GarmentFulfillmentFields value={fulfillment} disabled={disabled} onChange={setFulfillment}/>}<div className="mist-field" role="group" aria-label={uiText("分色分码")} style={{gridColumn:'1 / -1'}}><span className="mist-field-label">{uiText("分色分码")}</span><OrderBreakdownEditor type={order.type} unit={uiText(line?.unit||'')} value={breakdown} disabled={disabled} onChange={setBreakdown}/></div>{approved&&<Field label={uiText("变更原因")} required full><TextArea aria-label={uiText("变更原因")} value={values.reason} disabled={disabled} onChange={event=>setValues(current=>({...current,reason:event.target.value}))}/></Field>}</FormGrid>
 </Dialog>;
}

type OrderChangeRow={id:string;label:string;before:string;after:string};
function orderChangeRows(governance:OrderGovernanceFields|undefined,files:ReadonlyArray<{id:string;name:string}>):OrderChangeRow[]{
 const before=governance?.approvedSnapshot,after=governance?.changeDraft;if(!before||!after)return[];
 const rows:OrderChangeRow[]=[];
 const add=(id:string,label:string,oldValue:string,newValue:string,changed=oldValue!==newValue)=>{if(changed)rows.push({id,label,before:oldValue||'—',after:newValue||'—'});};
 const price=(value:number,currency:string)=>Number.isFinite(value)?`${fmt(value,2)} ${currency}`:'无法核对';
 for(const id of new Set([...before.lines.map(line=>line.id),...after.lines.map(line=>line.id)])){
  const oldLine=before.lines.find(line=>line.id===id),newLine=after.lines.find(line=>line.id===id),label=(newLine||oldLine)!.style||(newLine||oldLine)!.name;
  if(!oldLine||!newLine){const describe=(line:OrderGovernanceLine|undefined,currency:string)=>line?`${line.name} · ${formatOrderQuantity(line.qty)} ${line.unit} × ${price(line.price,currency)}`:'—';add(id,label,describe(oldLine,before.currency),describe(newLine,after.orderPatch.currency));continue;}
  add(id+'-fulfillment',label+' · 履约模式',garmentFulfillmentLabel(oldLine),garmentFulfillmentLabel(newLine));
  add(id+'-cmt',label+' · CMT 包含',cmtIncludedLabel(oldLine),cmtIncludedLabel(newLine));
  add(id+'-quantity',label+' · 数量',`${formatOrderQuantity(oldLine.qty)} ${oldLine.unit}`,`${formatOrderQuantity(newLine.qty)} ${newLine.unit}`,oldLine.qty!==newLine.qty||oldLine.unit!==newLine.unit);
  for(const row of breakdownDiff(oldLine.breakdown,newLine.breakdown))add(id+'-cell-'+row.key,label+' · '+row.label,row.before,row.after,true);
  add(id+'-price',label+' · 单价',price(oldLine.price,before.currency),price(newLine.price,after.orderPatch.currency),oldLine.price!==newLine.price||before.currency!==after.orderPatch.currency);
 }
 const oldTotal=orderAmounts(before.lines),newTotal=orderAmounts(after.lines);
 add('total','订单总额',oldTotal.total===null?'无法核对':price(oldTotal.total,before.currency),newTotal.total===null?'无法核对':price(newTotal.total,after.orderPatch.currency));
 const purpose=(kind:OrderGovernanceInput['kind'])=>kind==='internal'?'内部用途订单':'外部客户订单';
 add('kind','订单用途',purpose(before.contract.kind),purpose(after.contract.kind));
 add('internal-purpose','内部用途',before.contract.internalPurpose,after.contract.internalPurpose);
 add('receiver','接收团队 / 负责人',before.contract.receiver,after.contract.receiver,before.contract.receiver!==after.contract.receiver||before.contract.internalSupply?.receiverId!==after.contract.internalSupply?.receiverId);
 add('po','PO / 合同号',before.contract.poNumber,after.contract.poNumber);
 const oldFiles=before.contract.confirmationFileIds,newFiles=after.contract.confirmationFileIds,fileNames=(ids:string[])=>ids.map(id=>files.find(file=>file.id===id)?.name||'附件不可用').join('、');
 add('files','合同附件',fileNames(oldFiles),fileNames(newFiles),[...oldFiles].sort().join('|')!==[...newFiles].sort().join('|'));
 add('payment-method','付款方式',before.contract.paymentMethod,after.contract.paymentMethod);
 add('deposit','定金比例',before.contract.depositPercent===null?'未配置':before.contract.depositPercent+'%',after.contract.depositPercent===null?'未配置':after.contract.depositPercent+'%');
 add('shipment-payment','出运前累计收款',before.contract.preShipmentPercent==null?'待核对':before.contract.preShipmentPercent+'%',after.contract.preShipmentPercent==null?'待核对':after.contract.preShipmentPercent+'%');
 add('payment-note','合同付款条款',before.contract.paymentNote,after.contract.paymentNote);
 add('incoterm','贸易术语',before.contract.incoterm,after.contract.incoterm);
 add('place','指定地点',before.contract.deliveryPlace,after.contract.deliveryPlace);
 add('quantity-basis','数量口径',before.contract.quantityBasis==='size'?'按尺码':before.contract.quantityBasis==='total'?'按总量':'待核对',after.contract.quantityBasis==='size'?'按尺码':after.contract.quantityBasis==='total'?'按总量':'待核对');
 add('quantity-note','数量依据',before.contract.quantityBasisNote||'',after.contract.quantityBasisNote||'');
 add('tolerance','溢短装',toleranceText(before.contract),toleranceText(after.contract));
 add('due','交期',before.due,after.orderPatch.due);add('season','季节',before.season,after.orderPatch.season);
 return rows;
}

export function OrderDetailPage() {
  const presentedError=React.useContext(MistPresentedErrorContext);
  const density = useDevice('density');
  const { go, route } = useNav(), toast = useToast();
  const workspace=useMistWorkspace(),{ state, loading, error, run, refresh, saving, pending, recover } = workspace;
  const session = useOptionalMistSession(),members=workspaceMembers(workspace.workspace,state,session?.user);
  const canWriteOrders=!!session?.hasPermission('orders:write');
  const canReadShipping=!!session?.canAccessView?.('shipments' as View);
  const scope=`${workspace.workspace?.id||''}:${session?.sessionKey||''}:${session?.user?.id||''}:${route.id||''}`,activeScope=React.useRef(scope);activeScope.current=scope;
  const alive=React.useRef(true);React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const operation=React.useRef(false);
  const order = state?.orders.find(item => item.id === route.id);
  const lines = (state?.orderLines ?? []).filter(line => line.orderId === order?.id);
  const governance=(order as (MistOrder&{governance?:OrderGovernanceFields})|undefined)?.governance;
  const changeRows=orderChangeRows(governance,state?.files||[]);
  const approved=governance?.status==='approved';
  const internal=governance?.contract.kind==='internal';
  const locked=!!order&&orderLocked(order as MistOrder&{governance?:OrderGovernanceFields});
  const approvalPending=governance?.status==='pending'||governance?.changeDraft?.status==='pending'||locked;
  const terminated=governance?.status==='void'||governance?.status==='cancelled';
  const approvalLabel=governance?.status==='void'?'已作废':governance?.status==='cancelled'?'已取消':governance?.cancellation?.status==='pending'?'取消审批中':approved?'已批准':approvalPending?'待审批':governance?.status==='rejected'?'已退回':'草稿待补齐';
  const amounts = orderAmounts(lines);
  const lineAmounts = new Map(lines.map((line, index) => [line.id, amounts.items[index].amount]));
  const amountLabel = (amount: number | null | undefined) => amount == null ? '—' : fmt(amount, 2);
  const [lineId, setLineId] = React.useState<string | null>(route.orderLineId ?? null);
  const [lineEditorId,setLineEditorId]=React.useState<string|null>(null);
  const [documentOpen, setDocumentOpen] = React.useState(false), [editOpen, setEditOpen] = React.useState(false), [handoffOpen, setHandoffOpen] = React.useState(false),[contractOpen,setContractOpen]=React.useState(false),[reviewRoundId,setReviewRoundId]=React.useState<string|null>(null);
  const selectedRound=governance?.rounds.find(round=>round.id===reviewRoundId);
  const [edit, setEdit] = React.useState({ season: '', due: '', ownerId: '',reason:'' }), [note, setNote] = React.useState('');
  const [working, setWorking] = React.useState(false), [failure, setFailure] = React.useState('');
  React.useEffect(()=>{if(!canWriteOrders){setEditOpen(false);setContractOpen(false);setHandoffOpen(false);setLineEditorId(null);}},[canWriteOrders]);
  const busy=working||loading||saving||!!pending;
  React.useEffect(() => { setLineId(route.orderLineId ?? null); setFailure(''); }, [route.id, route.orderLineId]);
  React.useEffect(()=>{setLineEditorId(null);},[scope,lineId]);
  React.useEffect(()=>{operation.current=false;setWorking(false);setDocumentOpen(false);setEditOpen(false);setHandoffOpen(false);setContractOpen(false);setReviewRoundId(null);setNote('');setFailure('');},[scope]);
  const selectedLine = lines.find(line => line.id === lineId);
  const productions = (state?.productions ?? []).filter(item => item.orderId === order?.id && !item.closed);
  const invoices = (state?.invoices ?? []).filter(item => item.orderId === order?.id);
  const logisticsHandoff = state?.events.find(event => event.entityType === 'order' && event.entityId === order?.id && /^交接后勤(?:[:：]|$)/.test(event.text));
  const sameCurrencyReceipts=(state?.receipts??[]).filter(receipt=>receipt.currency===order?.currency),receiptIds=new Set(sameCurrencyReceipts.map(receipt=>receipt.id));
  const sameCurrencyInvoices=invoices.filter(invoice=>invoice.currency===order?.currency);
  const orderAllocations=(state?.allocations??[]).filter(allocation=>allocation.currency===order?.currency&&receiptIds.has(allocation.receiptId)&&sameCurrencyInvoices.some(invoice=>invoice.id===allocation.invoiceId));
  const reconciled=sumOrderMoney(orderAllocations.map(allocation=>allocation.amount));
  const received=(()=>{
    if(!state||!order)return sumOrderMoney([]);
    try{return sumOrderMoney([orderFundingCoveredAmount({...state,receipts:sameCurrencyReceipts,invoices:sameCurrencyInvoices,allocations:orderAllocations,orderFunding:{assignments:(state.orderFunding?.assignments??[]).filter(row=>row.currency===order.currency&&row.customerId===order.customerId)}},order.id)]);}
    catch(problem){return{total:null,cents:null,error:problem instanceof Error?problem.message:'已确认到账金额无效'};}
  })();
  const purchases=(state?.fulfillment.purchases||[]).filter(purchase=>purchase.orderId===order?.id);
  const shipments=(state?.fulfillment.shipments||[]).filter(shipment=>shipment.lines.some(line=>line.orderId===order?.id));
  const productionQc=(productionId:string)=>{const job=productions.find(job=>job.id===productionId);return !!state&&!!job&&!!fulfillmentProductionFact(state,job.id)?.completion&&fulfillmentProductionQcPassed(state,job);};
  const lineProgress=(line:MistOrderLine)=>{const jobs=productions.filter(job=>job.lineId===line.id),total=jobs.reduce((sum,job)=>sum+job.qty,0);return total?{made:Math.round(jobs.reduce((sum,job)=>sum+job.qty*job.pct,0)/total),qc:Math.round(jobs.reduce((sum,job)=>sum+(productionQc(job.id)?job.qty*100:0),0)/total)}:{made:0,qc:0};};
  const remaining = amounts.cents === null || received.cents === null ? null : Math.max(0, amounts.cents - received.cents) / 100;
  const quantities = [...new Set(lines.map(line => line.unit))].map(unit => ({ unit, quantity: lines.filter(line => line.unit === unit).reduce((sum, line) => sum + line.qty, 0) }));
  const act = async (command: Parameters<typeof run>[0], onSuccess?: () => void) => {
    if (busy||operation.current) return; const bound=scope;operation.current=true;setWorking(true);setFailure('');
    try { await run(command);if(alive.current&&activeScope.current===bound)onSuccess?.(); } catch (problem) { if(alive.current&&activeScope.current===bound)setFailure(problem instanceof Error ? problem.message : '保存失败，请重试'); } finally { if(alive.current&&activeScope.current===bound){operation.current=false;setWorking(false);} }
  };
  const columns = [
    { key: 'n', header: '款式', width: 'minmax(170px,1.6fr)', render: (line: MistOrderLine) => <ObjectCell thumb={<OrderProductThumb line={line} category={order?.type ?? 'garment'}/>} name={line.name} meta={<><Mono>{line.style}</Mono> · <span data-line-breakdown={line.id}>{uiText(breakdownShort((line as MistOrderLine&{breakdown?:OrderLineBreakdown}).breakdown))}</span></>} /> },
    { key: 'q', header: '数量', width: '80px', align: 'right' as const, hideOnMobile: true, render: (line: MistOrderLine) => <span className="mist-num">{formatOrderQuantity(line.qty)} {uiText(line.unit)}</span> },
    { key: 'p', header: `单价 ${order?.currency ?? ''}`, width: '76px', align: 'right' as const, hideOnMobile: true, render: (line: MistOrderLine) => <span className="mist-num">{amountLabel(lineAmounts.get(line.id) == null ? null : line.price)}</span> },
    { key: 'g', header: '生产进度', width: 'minmax(110px,1.2fr)', hideOnMobile: true, render: (line: MistOrderLine) => {const progress=lineProgress(line);return <Meter segments={[{ value: progress.qc, tone: 'ok' as const }, { value: Math.max(0, progress.made - progress.qc) }]} caption={ui`${progress.made}% · 已 QC ${progress.qc}%`} />;} },
    { key: 's', header: '小计', width: '90px', align: 'right' as const, render: (line: MistOrderLine) => <b className="mist-cell-strong mist-num">{amountLabel(lineAmounts.get(line.id))}</b> },
  ];
  if (!order) return <MistPage><BackLink onClick={() => go('orders')}>{uiText("订单管理")}</BackLink><Banner tone={error ? 'bad' : 'neutral'} title={uiText(loading ? '正在读取订单' : '没有找到此订单')} actions={<Button onClick={() => void refresh()}>{uiText("重新读取")}</Button>}>{error || (loading ? '请稍候' : '订单可能已移除，请返回订单列表。')}</Banner></MistPage>;
  const replacement=!!order.replacementSource;
  return <MistPage>
    <BackLink onClick={() => go('orders', undefined, { customerId: route.customerId,section:order.type })}>{uiText("订单管理")}</BackLink>
    <PageHeader description={ui`${order.customer} · ${order.season} · ${lines.length} 个条目 · 负责人 ${order.owner}`} eyebrow={uiText("订单履约 · 订单")} title={uiText(order.code)}
      actions={<>{order.replacementSource&&state?.platform.claims.some(c=>c.id===order.replacementSource!.claimId)&&<Button onClick={()=>go('claims',order.replacementSource!.claimId)}>{uiText('售后来源')}</Button>}{canWriteOrders&&<Button icon={Pencil} disabled={busy||approvalPending} onClick={() => { setEdit({ season: governance?.changeDraft?.orderPatch.season??order.season, due: governance?.changeDraft?.orderPatch.due??order.due, ownerId: order.ownerId,reason:governance?.changeDraft?.reason||'' }); setEditOpen(true); setFailure(''); }}>{uiText("编辑")}</Button>}{!internal&&<Button icon={FileText} onClick={() => setDocumentOpen(true)}>{uiText("装箱单草稿")}</Button>}{canWriteOrders&&<Button disabled={busy||approvalPending} onClick={()=>setContractOpen(true)}>{uiText("合同与审批资料")}</Button>}{!canWriteOrders||locked?null:!approved||governance?.changeDraft?<Button variant="primary" disabled={busy||approvalPending} onClick={()=>void act({type:'order.governance.submit',payload:{orderId:order.id}},()=>toast('已提交订单主单审批'))}>{uiText(approvalPending?'待审批':governance?.changeDraft?'提交变更审批':'提交主单审批')}</Button>:internal?null:<Button variant="primary" icon={Send} disabled={busy || !!order.handoffAt} onClick={() => { setHandoffOpen(true); setFailure(''); }}>{uiText(order.handoffAt ? '已交接后勤' : '交接后勤')}</Button>}{!internal&&order.handoffAt&&canReadShipping&&<Button variant="secondary" icon={Ship} onClick={()=>go('shipments',undefined,{section:'order:'+order.id,customerId:order.customerId})}>{uiText("出运准备")}</Button>}{state&&canWriteOrders&&<OrderTerminationButton state={state} order={order as MistOrder&{governance?:OrderGovernanceFields}} busy={busy} run={run} go={go}/>}</>} />
    <OrderTerminationBanner order={order as MistOrder&{governance?:OrderGovernanceFields}}/>
    {order.handoffAt && logisticsHandoff && <RecordDisclosure key={order.id+':handoff'} title="后勤交接记录"><KeyValue items={[{label:'经办人',value:logisticsHandoff.actor},{label:'时间',value:new Date(logisticsHandoff.at).toLocaleString(interfaceLocale())}]} />{logisticsHandoff.text.replace(/^交接后勤[:：]?/,'').trim() && <p>{logisticsHandoff.text.replace(/^交接后勤[:：]?/,'').trim()}</p>}</RecordDisclosure>}
    {(failure||error)&&(failure||error)!==presentedError&&!editOpen&&!handoffOpen && <Banner tone="bad" title={uiText("操作尚未完成")}>{failure || error}</Banner>}
    {pending&&!saving&&<Banner tone="warn" title={uiText("上一次操作结果待核对")} actions={<Button disabled={working||saving} onClick={()=>void recover().catch(problem=>setFailure(problem instanceof Error?problem.message:'原请求核对失败'))}>{uiText("核对原操作结果")}</Button>}/>}
    {amounts.error && <Banner tone="bad" title={uiText("订单金额无法核对")}>{amounts.error}{uiText("，请核对订单条目的数量与单价。")}</Banner>}
    {(received.error||reconciled.error) && <Banner tone="bad" title={uiText("收款金额无法核对")}>{received.error||reconciled.error}{uiText("，请核对到账归属与收款核销记录。")}</Banner>}
    <SummaryBar items={[
      { label: replacement?'客户收款':internal?'内部预算':'订单金额', value: replacement?uiText('无需收款'):amountLabel(amounts.total), unit: replacement?undefined:order.currency, hint: order.customer },
      { label: '总数量', value: quantities.length === 1 ? formatOrderQuantity(quantities[0].quantity) : quantities.map(item => `${formatOrderQuantity(item.quantity)} ${item.unit}`).join(' · '), unit: quantities.length === 1 ? quantities[0].unit : undefined, hint: `${lines.length} 个条目` },
      { label: '交期', value: order.due, hint: locked ? undefined : internal ? governance?.contract.deliveryPlace||'内部交接' : order.handoffAt ? `交接于 ${new Date(order.handoffAt).toLocaleString(interfaceLocale())}` : '待交接后勤' },
      { label: '当前状态', value: <Pill tone={order.tone}>{order.state}</Pill> }]} />
    <Card className="mist-section"><CardHeader title={uiText("合同与主单审批")} tools={<Pill tone={approved?'ok':approvalPending?'warn':'neutral'}>{approvalLabel}</Pill>}/><KeyValue items={[{label:'PO / 内部用途',value:governance?.contract.poNumber||governance?.contract.internalPurpose||'待填写'},...(internal?[{label:'接收负责人',value:governance?.contract.receiver||'待确认'},{label:'交接约定',value:governance?.contract.paymentNote||'待填写'}]:replacement?[{label:'客户收款',value:uiText('无需收款')},{label:'补发约定',value:governance?.contract.paymentNote||'待填写'}]:[{label:'付款方式',value:governance?.contract.paymentMethod||'待填写'},{label:'定金比例',value:governance?.contract.depositPercent==null?'未配置':governance.contract.depositPercent+'%'},...(governance?.contract.paymentMethod==='TT'?[{label:'出运前累计收款',value:governance.contract.preShipmentPercent==null?uiText('待核对'):governance.contract.preShipmentPercent+'%'}]:[]),{label:'合同付款条款',value:governance?.contract.paymentNote||'待填写'}]),{label:internal?'交付方式 / 地点':'贸易术语 / 地点',value:(governance?.contract.incoterm||'待填写')+' / '+(governance?.contract.deliveryPlace||'待填写')},{label:'溢短装',value:order.replacementSource?uiText('按批准数量'):toleranceText(governance?.contract)},...(order.type==='garment'?[{label:'数量口径',value:uiText(governance?.contract.quantityBasis==='size'?'按尺码':governance?.contract.quantityBasis==='total'?'按总量':'待核对')},{label:'数量依据',value:governance?.contract.quantityBasisNote||uiText('待核对')}]:[])]}/>{governance?.changeDraft&&<><Banner tone="warn" title={uiText("存在尚未生效的变更")}>{governance.changeDraft.reason}{governance.changeDraft.status!=='pending'&&<Button onClick={()=>void act({type:'order.governance.discardChange',payload:{orderId:order.id}})}>{uiText("放弃变更草稿")}</Button>}</Banner>{governance.approvedSnapshot?(changeRows.length?<DataTable ariaLabel={uiText("订单变更前后差异")} rows={changeRows} rowKey={row=>row.id} columns={[{key:'label',header:'变更项',render:row=>row.label},{key:'before',header:'当前生效',render:row=>row.before},{key:'after',header:'拟议变更',render:row=>row.after}]}/>:<p className="mist-note">{uiText("没有改变当前生效条款。")}</p>):<p className="mist-note">{uiText("原批准快照不可用，暂不能列出变更差异。")}</p>}{state&&<OrderChangeImpactList state={state} order={order} lines={governance.changeDraft.lines} go={go}/>}</>}{governance?.rounds.map((round,index)=><div className="mist-card-body" key={round.id}><b>{uiText("第 ")}{uiText(index+1)}{uiText(" 轮")}{uiText(round.kind==='change'?'变更':'主单')}{uiText("审批")}</b><p>{uiText(round.status==='pending'?'待审批':round.status==='approved'?'已批准':'已退回')} · {round.decidedName||round.decidedBy||'尚未决定'} · {round.note||round.reason||new Date(round.submittedAt).toLocaleString(interfaceLocale())}</p><Button variant="quiet" size="sm" onClick={()=>setReviewRoundId(round.id)}>{uiText("查看提交快照")}</Button></div>)}</Card>
    {!internal&&<Card as="section" className="mist-section"><CardHeader title={uiText("履约进度")} tools={<Pill tone={order.tone}>{order.state}</Pill>} /><FlowSteps nodes={[
      { label: '主单审批', caption: approvalLabel, icon: Handshake, state: approved?'done':locked?'todo':'now' },
      { label: '采购', caption: purchases.length?`${purchases.length} 张采购 · ${purchases.filter(p=>p.state==='approved').length} 已批`:locked?'未开始':'按条目计划', icon: Package, state: purchases.length&&purchases.every(p=>p.state==='approved') ? 'done' : purchases.length?'now':'todo' },
      { label: '生产', caption: productions.length ? `${productions.length} 个生产单` : locked?'未开始':'待安排', icon: Factory, state: productions.length && productions.every(item => !!state&&!!fulfillmentProductionFact(state,item.id)?.completion) ? 'done' : productions.length ? 'now' : 'todo' },
      { label: '尾期 QC', caption: lines.length&&lines.every(line => lineProgress(line).qc === 100) ? '已完成' : locked?'未检验':'待检验', icon: BadgeCheck, state: lines.length && lines.every(line => lineProgress(line).qc === 100) ? 'done' : productions.some(item => item.col === 'qc') ? 'now' : 'todo' },
      { label: '出运', caption: shipments.length?`${shipments.filter(shipment=>shipment.state==='departed').length} / ${shipments.length} 票已出运`:locked?'未出运':order.handoffAt ? '已交接后勤' : order.due, icon: Ship, state: lines.length&&lines.every(line=>isLineClosed(line)||!!state&&lineShipping(state,line).departed>=line.qty) ? 'done' : shipments.length||order.handoffAt ? 'now' : 'todo' },
      { label: '收款', caption: replacement?uiText('无需收款'):`已到账 ${amountLabel(received.total)} ${order.currency}`, icon: Wallet, state: replacement?'done':amounts.cents !== null && received.cents !== null && received.cents >= amounts.cents && amounts.cents > 0 ? 'done' : received.cents !== null && received.cents > 0 ? 'now' : 'todo' },
    ]} /></Card>}
    <section className="mist-grid">
      <Card className={internal?"mist-col-12":"mist-col-8"}><CardHeader title={uiText("条目")} tools={<span className="mist-muted">{uiText("生产 · 已 QC")}</span>} /><DataTable density={density} ariaLabel={uiText("订单条目")} rows={lines} rowKey={line => line.id} onRowClick={line => {setLineId(line.id);go('orders/detail',order.id,{customerId:route.customerId,section:order.type,orderLineId:line.id});}} columns={columns} /></Card>
      {!internal&&<div className="mist-col mist-col-4">
        <Card><CardHeader title={uiText("出运准备")} tools={<span className="mist-muted">{order.checklist.filter(item => item.done).length} / {order.checklist.length}</span>} /><Checklist items={order.checklist} onToggle={busy||locked||!canWriteOrders ? undefined : index => { const item = order.checklist[index]; void act({ type: 'order.checklist', payload: { orderId: order.id, itemId: item.id, done: !item.done } }); }} /></Card>
        <Card><CardHeader title={uiText("收款")} />{replacement?<KeyValue items={[{label:'客户收款',value:uiText('无需收款')}]}/>:remaining === null ? <Banner tone="warn" title={uiText("待核对订单金额")}>{uiText("金额核对完成后显示收款比例。")}</Banner> : <Donut centerLabel="已收" slices={[{ label: '已确认到账', value: received.total!, display: amountLabel(received.total), color: 'var(--mist-accent)' }, { label: '合同待收', value: remaining, display: amountLabel(remaining), color: 'transparent' }]} caption={<><span className="mist-note">{uiText("已核销 ")}{amountLabel(reconciled.total)} {order.currency}</span><Button variant="quiet" onClick={() => go('payment-vouchers',undefined,{section:'funding:'+order.id,customerId:order.customerId})}>{uiText("查看收款核销")}</Button></>} />}</Card>
      </div>}
    </section>
    <Drawer open={!!selectedLine} onClose={() => {setLineId(null);go('orders/detail',order.id,{customerId:route.customerId,section:order.type});}} title={uiText(selectedLine?.name ?? '订单条目')} sub={uiText(selectedLine?.style)} size="lg">
      {selectedLine && <div className="mist-col" data-module-detail>{state&&!internal&&<OrderLineFulfillment state={state} order={order} line={selectedLine} go={go} onCloseLine={canWriteOrders&&!locked?reason=>run({type:'order.governance.closeLine',payload:{orderId:order.id,lineId:selectedLine.id,reason}}):undefined}/>}<KeyValue items={[...(state?[{ label: '来源', value: <OrderLineSourceValue state={state} line={selectedLine} go={go}/> }]:[]),...(state&&lineQuotation(state,selectedLine,go)?[{ label: '来源报价', value: <OrderLineQuotationValue state={state} line={selectedLine} go={go}/> }]:[]), { label: '数量', value: `${formatOrderQuantity(selectedLine.qty)} ${selectedLine.unit}` }, { label: '单价', value: `${amountLabel(lineAmounts.get(selectedLine.id) == null ? null : selectedLine.price)} ${order.currency}` }, { label: '小计', value: `${amountLabel(lineAmounts.get(selectedLine.id))} ${order.currency}` }]} />
        <InternalFabricPanel key={`${scope}:${selectedLine.id}`} order={order} line={selectedLine} go={go}/>{canWriteOrders&&<Button icon={Pencil} disabled={busy||approvalPending} onClick={()=>setLineEditorId(selectedLine.id)}>{uiText("编辑条目")}</Button>}
        <CardHeader title={uiText("采购")} /><Button block disabled={busy||locked} onClick={()=>go('procurement',undefined,{orderLineId:selectedLine.id,section:'order:'+order.id,customerId:order.customerId})}>{uiText("准备采购草稿")}</Button>
        {!approved&&!locked&&<Banner tone="warn" title={uiText("仅可准备采购草稿")}>{uiText("主单批准前不能提交采购承诺、发出合同或进入生产。")}</Banner>}
        {purchases.filter(purchase=>purchase.lineId===selectedLine.id).map(purchase=><Button key={purchase.id} block onClick={()=>go('procurement',purchase.id,{orderLineId:selectedLine.id,section:'order:'+order.id,customerId:order.customerId})}>{uiText(['draft','rejected'].includes(purchase.state)?'查看采购草稿':'查看采购承诺')} {purchase.code}</Button>)}
        <CardHeader title={uiText("生产单")} />{productions.filter(item => item.lineId === selectedLine.id).map(item => <Button key={item.id} block onClick={() => go('production-board', undefined, { productionId: item.id, orderLineId: selectedLine.id })}>{item.code} · {item.factory} · {item.pct}%</Button>)}{shipments.filter(shipment=>shipment.lines.some(line=>line.lineId===selectedLine.id)).map(shipment=><Button key={shipment.id} block onClick={()=>go('shipments',shipment.id)}>{uiText("出运 ")}{shipment.code}</Button>)}</div>}
    </Drawer>
    <Dialog open={documentOpen} onClose={() => setDocumentOpen(false)} title={ui`装箱单草稿 · ${order.code}`} description={ui`${order.customer} · 仅订单计划数量；正式装箱与原件以具体出运为准。`} width={860}
      footer={<Button onClick={() => { downloadMistCsv(`${order.code}-装箱单草稿.csv`, ['订单', '款式', '品名', '数量', '单位'], lines.map(line => [order.code, line.style, line.name, line.qty, line.unit])); toast('已下载装箱单草稿'); }}>{uiText("下载草稿")}</Button>}><DataTable density={density} rows={lines} rowKey={line => line.id} columns={columns.filter(column => ['n', 'q'].includes(column.key))} />{shipments.length?shipments.map(shipment=><Button key={shipment.id} block onClick={()=>go('shipments',shipment.id)}>{uiText("打开正式出运 ")}{shipment.code}</Button>):<EmptyState compact title={uiText("尚未关联正式出运")}/>}</Dialog>
    <Dialog open={editOpen} onClose={() => { if (!busy) setEditOpen(false); }} title={uiText("编辑订单")} footer={<><Button onClick={() => setEditOpen(false)} disabled={busy}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={busy||approvalPending} onClick={() => void act(approved&&!governance?.changeDraft&&edit.season===order.season&&edit.due===order.due?{type:'order.update',payload:{orderId:order.id,ownerId:edit.ownerId}}:{type:'order.governance.saveDraft',payload:{orderId:order.id,input:governance?.changeDraft?.contract||governance?.contract||createOrderGovernance({id:()=>'',now:'',actorName:''}).contract,...(governance?.changeDraft?{lines:governance.changeDraft.lines}:{}),orderPatch:{...governance?.changeDraft?.orderPatch,season:edit.season,due:edit.due,ownerId:edit.ownerId},...(approved?{reason:edit.reason}: {})}},()=>{setEditOpen(false);toast(approved?'变更草稿已保存，原批准内容继续生效':'订单资料已保存');})}>{uiText("保存")}</Button></>}>
      {failure && <Banner tone="bad" title={uiText("保存失败")}>{failure}</Banner>}<FormGrid><Field label={uiText("季节")}><TextInput value={edit.season} onChange={event => setEdit(value => ({ ...value, season: event.target.value }))} /></Field><Field label={uiText("交期")}><TextInput type="date" value={mistDate(edit.due)?.toISOString().slice(0, 10) ?? edit.due} onChange={event => setEdit(value => ({ ...value, due: event.target.value }))} /></Field><Field label={uiText("负责人")}><Select aria-label={uiText("负责人")} value={edit.ownerId} onChange={event => setEdit(value => ({ ...value, ownerId: event.target.value }))} options={memberSelectOptions(members, { current: { id: order.ownerId, name: order.owner } })} /></Field>{approved&&<Field label={uiText("实质变更原因")} full><TextArea value={edit.reason} onChange={event=>setEdit(value=>({...value,reason:event.target.value}))}/></Field>}</FormGrid>
    </Dialog>
    <Dialog open={!!selectedRound} onClose={()=>setReviewRoundId(null)} title={uiText("主单审批提交快照")}>{selectedRound&&<><KeyValue items={[{label:'合同',value:selectedRound.snapshot.contract.poNumber||selectedRound.snapshot.contract.internalPurpose},...(selectedRound.snapshot.contract.kind==='internal'?[{label:'接收团队 / 负责人',value:selectedRound.snapshot.contract.receiver}]:[]),{label:'交期',value:selectedRound.snapshot.due},...(selectedRound.snapshot.contract.kind==='internal'?[{label:'交接约定',value:selectedRound.snapshot.contract.paymentNote}]:replacement?[{label:'客户收款',value:uiText('无需收款')}]:[{label:'付款条件',value:(selectedRound.snapshot.contract.paymentMethod==='OTHER'?uiText('其他'):selectedRound.snapshot.contract.paymentMethod)+' · '+selectedRound.snapshot.contract.paymentNote},...(selectedRound.snapshot.contract.paymentMethod==='TT'?[{label:'出运前累计收款',value:selectedRound.snapshot.contract.preShipmentPercent==null?uiText('待核对'):selectedRound.snapshot.contract.preShipmentPercent+'%'}]:[])]),{label:'实际审批人',value:selectedRound.decidedName||selectedRound.decidedBy||'待决定'},...selectedRound.snapshot.lines.map(line=>({label:line.style+' · '+line.name,value:`${line.qty} ${line.unit} × ${line.price} ${selectedRound.snapshot.currency}${order.type==='garment'?` · ${garmentFulfillmentLabel(line)} · CMT 包含：${cmtIncludedLabel(line)}`:''}`}))]}/>{selectedRound.snapshot.contract.confirmationFileIds.map(id=>{const file=state?.files.find(f=>f.id===id);return file?<div className="mist-file-row" key={id}><FileName file={file} files={selectedRound.snapshot.contract.confirmationFileIds.map(x=>state?.files.find(f=>f.id===x))}/><Button variant="quiet" onClick={()=>void workspace.downloadFile(file).catch(error=>setFailure(error.message))}>{uiText("下载")}</Button></div>:null;})}</>}</Dialog>
    <OrderContractDialog key={`contract:${scope}`} order={order} open={contractOpen} onClose={()=>setContractOpen(false)}/>
    <OrderLineDialog key={`line:${scope}`} order={order} line={lines.find(line=>line.id===lineEditorId)||null} lines={lines} onClose={()=>setLineEditorId(null)}/>
    <Dialog open={handoffOpen} onClose={() => { if (!busy) setHandoffOpen(false); }} title={uiText("交接后勤")} description={uiText(`${order.code} · ${order.customer}`)} footer={<><Button onClick={() => setHandoffOpen(false)} disabled={busy}>{uiText("取消")}</Button><Button variant="primary" loading={busy} onClick={() => void act({ type: 'order.handoff', payload: { orderId: order.id, note } }, () => { setHandoffOpen(false); setNote(''); toast('已交接后勤'); })}>{uiText("确认交接")}</Button></>}>
      {failure && <Banner tone="bad" title={uiText("交接失败")}>{failure}</Banner>}<Field label={uiText("交接说明")}><TextArea value={note} onChange={event => setNote(event.target.value)} /></Field>
    </Dialog>
  </MistPage>;
}
