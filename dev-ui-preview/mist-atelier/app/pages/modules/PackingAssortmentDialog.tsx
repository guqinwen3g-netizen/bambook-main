import React from 'react';
import {Button,DataTable,Dialog,TextInput,type Column} from '../../../../../components/mist';
import type {GarmentBreakdown} from '../../../../../server/src/shared/mistOrderBreakdown';
import type {PackingSku} from '../../../../../server/src/shared/mistPackingBreakdown';
import {uiText,ui} from '../../../../../services/interfaceLanguage';

export function PackingAssortmentDialog({carton,quantity,spec,value,readOnly=false,onClose,onSave}:{carton:string;quantity:number;spec:GarmentBreakdown;value?:PackingSku[];readOnly?:boolean;onClose:()=>void;onSave:(value:PackingSku[])=>void}){
 const [rows,setRows]=React.useState(()=>spec.rows.map(row=>({color:row.color,quantities:spec.sizes.map(size=>value?.find(cell=>cell.color===row.color&&cell.size===size)?.quantity||0)})));
 const total=rows.reduce((sum,row)=>sum+row.quantities.reduce((n,q)=>n+q,0),0),valid=rows.every(row=>row.quantities.every(q=>Number.isSafeInteger(q)&&q>=0))&&total===quantity;
 const columns:Column<typeof rows[number]>[]=[{key:'color',header:'颜色',render:row=>row.color},...spec.sizes.map((size,index):Column<typeof rows[number]>=>({key:size,header:size,align:'right',render:row=><TextInput disabled={readOnly} type="number" min={0} step={1} aria-label={ui`${row.color} · ${size} 数量`} value={row.quantities[index]} onChange={event=>setRows(current=>current.map(item=>item.color===row.color?{...item,quantities:item.quantities.map((q,i)=>i===index?Number(event.target.value):q)}:item))}/>}))];
 return <Dialog open title={ui`箱 ${carton} · 分色分码`} width={760} onClose={onClose} footer={<><span>{ui`合计 ${total} / ${quantity} 件`}</span><span className="mist-spacer"/><Button onClick={onClose}>{uiText(readOnly?'关闭':'取消')}</Button>{!readOnly&&<Button variant="primary" disabled={!valid} onClick={()=>onSave(rows.flatMap(row=>spec.sizes.map((size,i)=>({color:row.color,size,quantity:row.quantities[i]}))).filter(cell=>cell.quantity>0))}>{uiText('确定')}</Button>}</>}>
  <DataTable ariaLabel={uiText('本箱分色分码')} rows={rows} rowKey={row=>row.color} columns={columns}/>
 </Dialog>;
}
