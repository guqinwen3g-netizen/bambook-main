import React from 'react';
import { KeyValue, Pill } from '../../../../components/mist';
import { closureSource, orderLineClosures, toleranceText, type ClosableLine } from '../../../../server/src/shared/mistOrderClosure';
import { breakdownSummary } from '../../../../server/src/shared/mistOrderBreakdown';
import { uiText } from '../../../../services/interfaceLanguage';
import { businessWhen, RecordDisclosure } from './modules/pageKit';

/** Each submitted request owns its identity, quantities and decision; current fields cannot reconstruct it. */
export function OrderClosureHistory({line}:{line:ClosableLine}) {
 const records=orderLineClosures(line);
 if(!records.length)return null;
 return <RecordDisclosure title="结案记录"><div className="mist-col" role="list" aria-label={uiText('条目结案申请记录')}>{records.map(record=>{
  const source=closureSource(line,record),unit=source?' '+source.unit:'';
  return <div className="mist-section" role="listitem" key={record.id} data-line-closure-record={record.id}>
   <div className="mist-row"><Pill tone={record.status==='closed'?'ok':record.status==='pending'?'warn':'bad'}>{uiText(record.status==='closed'?'已结案':record.status==='pending'?'待审批':'已退回')}</Pill></div>
   <KeyValue items={[
    ...(source?[{label:'条目',value:source.style+' · '+source.name},{label:'合同',value:source.poNumber},{label:'溢短装',value:toleranceText(source.tolerance)},...(source.breakdown?[{label:'规格 / 分色分码',value:breakdownSummary(source.breakdown,source.unit)}]:[])]:[{label:'原申请资料',value:uiText('原申请资料未留存')}]),
    {label:'订单数量',value:record.ordered+unit},{label:'允许范围',value:record.min+'–'+record.max+unit},{label:'实际离港（结案数量）',value:record.quantity+unit},
    {label:'结案原因',value:record.reason},{label:'申请人',value:record.requesterName},{label:'申请时间',value:businessWhen(record.requestedAt)},
    ...(record.decidedName?[{label:'审批人',value:record.decidedName}]:[]),...(record.decidedAt?[{label:'审批时间',value:businessWhen(record.decidedAt)}]:[]),...(record.note?[{label:'审批意见',value:record.note}]:[]),
   ]}/>
  </div>;
 })}</div></RecordDisclosure>;
}
