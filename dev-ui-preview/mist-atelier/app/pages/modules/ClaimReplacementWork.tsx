import React from 'react';
import {Button,Card,CardHeader,Facts,TextLink} from '../../../../../components/mist';
import {uiText} from '../../../../../services/interfaceLanguage';
import type {MistCommand,MistState} from '../../../../../server/src/shared/mistWorkspace';
import type {PlatformClaim} from '../../../../../server/src/shared/mistPlatform';
import {field,text,today} from './fulfillmentKit';
import type {ModuleEditorSpec} from './ModuleWorkbench';

export function ClaimReplacementWork({state,claim,canCreate,busy,open,command,onOrder}:{state:MistState;claim:PlatformClaim;canCreate:boolean;busy:boolean;open:(spec:ModuleEditorSpec)=>void;command:(c:MistCommand)=>Promise<unknown>;onOrder:(id:string)=>void}){
 const rows=claim.dispositions.filter(row=>row.kind==='Replace'&&row.state==='Executed');
 if(!rows.length)return null;
 return <>{rows.map(row=>{const order=state.orders.find(order=>order.replacementSource?.dispositionId===row.id),original=state.orders.find(order=>order.id===claim.orderId),files=[...new Set([...claim.fileIds,...row.fileIds])].flatMap(id=>{const file=state.files.find(file=>file.id===id);return file?[{value:id,label:file.name}]:[];});
 const create=()=>open({title:'生成补发订单',fields:[field('due','交期','date'),field('incoterm','贸易术语'),field('deliveryPlace','指定地点'),field('fileId','补发确认','select',true,files)],initialValues:{due:today(),incoterm:original?.governance?.contract.incoterm??'',deliveryPlace:original?.governance?.contract.deliveryPlace??'',fileId:''},submit:v=>command({type:'platform.claim.replacement.createOrder',payload:{id:row.id,due:text(v,'due'),incoterm:text(v,'incoterm'),deliveryPlace:text(v,'deliveryPlace'),confirmationFileIds:[text(v,'fileId')]}})});
 return <Card key={row.id} data-claim-replacement={row.id}><CardHeader title={uiText('换货补发')} tools={!row.replacementOrderId&&!order&&canCreate&&claim.state!=='Closed'?<Button disabled={busy} onClick={create}>{uiText('生成补发订单')}</Button>:undefined}/><div className="mist-card-body"><Facts items={[{label:'商品',value:row.goodsSource?.name??'—'},{label:'数量',value:row.quantity+' '+row.unit},{label:'客户收款',value:'无需收款'},{label:'补发订单',value:order?<TextLink onClick={()=>onOrder(order.id)}>{order.code}</TextLink>:row.replacementOrderId?'已生成':'待生成'}]}/></div></Card>;
 })}</>;
}
