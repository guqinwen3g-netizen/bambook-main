import type {AgentProposalCommandBody} from '../../../../server/src/shared/mistAgentProposals';
import type {MistState} from '../../../../server/src/shared/mistWorkspace';
import {developmentReferenceReadKeys,type DevelopmentReferenceAccess,type DevelopmentReferenceCommand} from '../../../../server/src/shared/mistDevelopmentSampleReferences';
import {fulfillmentPositions,sampleLoanRemaining,type FulfillmentSample} from '../../../../server/src/shared/mistFulfillment';
import {normalizeDevelopmentDelivery,normalizeDevelopmentPostage,type IncomingPostage} from '../../../../server/src/shared/mistDevelopmentIncoming';
import {sampleUnitAllowsDecimal} from '../../../../server/src/shared/mistDevelopmentDomain';
import {productionSupplierUnavailableReason} from '../../../../server/src/shared/mistSupplierStatus';
import {platformBusinessDate} from '../../../../server/src/shared/mistPlatform';
import {isCalendarDay} from '../../../../server/src/shared/mistBusinessClock';
import {stableJson} from '../../../../server/src/shared/stableJson';
import type {DevelopmentTaskProposalReview} from './developmentTaskProposalDetails';
const titles:Record<string,string>={'development.reference.add':'引用参考实物','development.reference.remove':'撤回参考实物','development.reference.dispatch':'参考实物借送工厂','development.reference.return':'参考实物归还'};
const keys=(v:unknown,allowed:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const text=(v:unknown,max=1000):v is string=>typeof v==='string'&&!!v.trim()&&v.trim().length<=max;
const quantity=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const valueAt=(state:MistState,path:string[])=>{let v:any=state;for(const p of path)v=p.startsWith('k:')?v?.[p.slice(2)]:Array.isArray(v)?v.find(r=>r?.id===p.slice(2)):undefined;return v;};
function origin(state:MistState,sample:FulfillmentSample){const source=sample.source;if(source.kind==='manual')return source.description||'手工登记';if(source.kind==='version'){const d=state.devs.find(d=>d.id===source.devId),v=state.versions.find(v=>v.id===source.versionId);return d&&v?d.code+' · '+v.label:'开发返样';}if(source.kind==='developmentIncoming'){const d=state.devs.find(d=>d.id===source.devId);return d?d.code+' · 原来样':'开发来样';}return state.orders.find(o=>o.id===source.orderId)?.code||'订单样品';}
export function developmentReferenceSourceFingerprint(command:DevelopmentReferenceCommand,state:MistState,access:DevelopmentReferenceAccess|undefined){
 const p=command.payload,caps=access?.referencesByDev[p.devId]||[],ids=command.type==='development.reference.dispatch'?command.payload.items.map(i=>i.referenceId):command.type==='development.reference.remove'?[command.payload.referenceId]:command.type==='development.reference.return'?command.payload.items.map(i=>state.fulfillment.sampleMovements.find(m=>m.id===i.loanId)?.referenceTransfer?.referenceId):[];
 return stableJson([access?.writableDevIds.includes(p.devId)===true,command.type==='development.reference.add'?access?.writableSampleIds.includes(command.payload.sampleId):undefined,ids.map(id=>caps.find(c=>c.referenceId===id)),developmentReferenceReadKeys(state,command).map(path=>[path,valueAt(state,path)])]);
}
/** Current response capability is authority only for UI review, never a model-supplied snapshot or a source grant. */
export function developmentReferenceProposalDetails(command:AgentProposalCommandBody,state:MistState|null|undefined,access:DevelopmentReferenceAccess|undefined,now?:string):DevelopmentTaskProposalReview|null{
 const title=titles[command.type];if(!title)return null;const unavailable=(reason='参考实物资料已变化或当前不可办理'):DevelopmentTaskProposalReview=>({title,reason,rows:[],fingerprint:''});
 if(!state||!access)return unavailable('参考资料尚未读取，请重新读取');const p=command.payload,dev=state.devs.find(d=>d.id===p?.devId);if(!dev||!access.writableDevIds.includes(dev.id))return unavailable();
 if((command.type==='development.reference.dispatch'||command.type==='development.reference.return')&&(!keys(p.delivery,['kind','recipient','address','carrier','trackingNo','evidence'])||p.note!==undefined&&(typeof p.note!=='string'||p.note.length>1000)))return unavailable();
 if(command.type==='development.reference.dispatch'&&!keys(p.postage,['amount','currency','zeroReason']))return unavailable();
 const rows:DevelopmentTaskProposalReview['rows']=[],caps=access.referencesByDev[dev.id]||[],selectedCaps:unknown[]=[],add=(field:string,value:string)=>rows.push({field,path:'referenceReview.'+rows.length,value});add('开发案',dev.code+' · '+dev.name);
 const refs=dev.sampleReferences||[],samples=state.fulfillment.samples,at=now||state.settings.businessClock?.at||new Date().toISOString(),today=platformBusinessDate(at);
 const facts=(s:FulfillmentSample)=>{add('实物',s.code+' · '+s.name);add('形态规格',[s.category,s.form,s.size,s.color].filter(Boolean).join(' · '));add('原登记量',s.quantity+' '+s.unit);add('当前可用',s.available+' '+s.unit);add('原来源',origin(state,s));};
 const deliveryRows=(value:any)=>{const d=normalizeDevelopmentDelivery(value);add('交接方式',d.kind==='courier'?'快递':'当面交接');add('收件人',d.recipient);add('收件地址',d.address);if(d.kind==='courier'){add('快递公司',d.carrier);add('运单号',d.trackingNo);}else add('交接依据',d.evidence);};
 try{
  if(command.type==='development.reference.add'){
   if(dev.closure||!keys(p,['devId','sampleId','purpose','fileIds'])||!text(p.purpose))return unavailable();const s=samples.find(s=>s.id===p.sampleId);if(!s||!access.writableSampleIds.includes(s.id)||!s.code)return unavailable();const fileIds=p.fileIds===undefined?[]:p.fileIds;
   if(!Array.isArray(fileIds)||new Set(fileIds).size!==fileIds.length||fileIds.length>100||fileIds.some(id=>typeof id!=='string'||!s.fileIds.includes(id)||!state.files.some(f=>f.id===id)))return unavailable('参考原件不可读取，请重新核对');
   facts(s);add('参考用途',p.purpose.trim());if(fileIds.length)add('选用原件',fileIds.map(id=>state.files.find(f=>f.id===id)!.name).join('、'));
  }else if(command.type==='development.reference.remove'){
   if(!keys(p,['devId','referenceId','reason'])||!text(p.reason))return unavailable();const e=caps.find(e=>e.referenceId===p.referenceId);if(!e?.canRemove)return unavailable('引用尚未归还、已撤回或当前不能撤回');selectedCaps.push(e);
   const r=refs.find(r=>r.id===p.referenceId),s=r&&samples.find(s=>s.id===r.sampleId);if(e.readable&&(!r||!s))return unavailable();add('引用',s?s.code+' · '+s.name:'来源不可读的引用');add('撤回理由',p.reason.trim());
  }else if(command.type==='development.reference.dispatch'){
   if(dev.closure||!keys(p,['devId','taskVersionId','items','sentAt','expectedReturn','delivery','postage','note'])||!isCalendarDay(p.sentAt)||p.sentAt>today||p.expectedReturn&&(!isCalendarDay(p.expectedReturn)||p.expectedReturn<p.sentAt))return unavailable('请核对准确工厂任务与实际寄送日');
   const v=state.versions.find(v=>v.id===p.taskVersionId&&v.devId===dev.id&&dev.versionIds.includes(v.id));if(!v?.task||v.minor||v.taskEnd||v.archivedAt||v.qcDecision&&v.qcDecision.kind!=='rework')return unavailable('工厂任务已结束或不可读取');
   const supplier=state.market.suppliers.find(s=>s.id===v.factoryId);if(!supplier||productionSupplierUnavailableReason(supplier,today))return unavailable('工厂资料不可读取或当前不可用');
   const created=(v.roundId?state.rounds?.find(r=>r.id===v.roundId&&r.devId===dev.id)?.createdAt:undefined)||dev.createdAt;if(created&&Number.isFinite(Date.parse(created))&&p.sentAt<platformBusinessDate(created))return unavailable('寄送日不得早于工厂任务建立日');
   if(!Array.isArray(p.items)||!p.items.length||p.items.length>100||new Set(p.items.map(i=>JSON.stringify([i?.referenceId,i?.sourceLocation]))).size!==p.items.length)return unavailable();
   add('工厂任务',v.label+' · '+supplier.name);add('实际寄送日',p.sentAt);if(typeof p.expectedReturn==='string'&&p.expectedReturn)add('预计归还日',p.expectedReturn);const totals=new Map<string,number>();
   for(const item of p.items){if(!keys(item,['referenceId','quantity','sourceLocation'])||!quantity(item.quantity)||typeof item.sourceLocation!=='string')return unavailable();const e=caps.find(e=>e.referenceId===item.referenceId),r=refs.find(r=>r.id===item.referenceId),s=r&&samples.find(s=>s.id===r.sampleId);if(!e?.readable||!e.canDispatch||!r||r.withdrawn||!s||!access.writableSampleIds.includes(s.id))return unavailable(e?.blocker||'参考实物不可借送');selectedCaps.push(e);
    const position=fulfillmentPositions(s).find(pos=>pos.location===item.sourceLocation);if(!position||item.quantity>position.available||!sampleUnitAllowsDecimal(s.unit)&&!Number.isInteger(item.quantity)||s.sizeQuantities&&item.quantity!==s.quantity)return unavailable('借送数量或本次位置已变化');const total=(totals.get(s.id)||0)+item.quantity;totals.set(s.id,total);if(total>s.available)return unavailable('当前可用量不足');
    add('借送实物',s.code+' · '+s.name);add('形态规格',[s.form,s.size,s.color].filter(Boolean).join(' · '));add('本次借送',item.quantity+' '+s.unit);add('本次出库位置',item.sourceLocation||'未记录位置');
   }
   deliveryRows(p.delivery);const cost=normalizeDevelopmentPostage(p.postage as IncomingPostage);add('我方邮费',cost.amount+' '+cost.currency);if(cost.amount===0)add('零支出原因',cost.zeroReason);add('原物归还','须归还');if(typeof p.note==='string'&&p.note.trim())add('寄送说明',p.note.trim());
  }else{
   if(!keys(p,['devId','dispatchId','items','receivedAt','delivery','note'])||!isCalendarDay(p.receivedAt)||p.receivedAt>today||!Array.isArray(p.items)||!p.items.length||p.items.length>100||new Set(p.items.map(i=>JSON.stringify([i?.loanId,i?.location]))).size!==p.items.length)return unavailable();const totals=new Map<string,number>();
   add('实际归还日',p.receivedAt);
   for(const item of p.items){if(!keys(item,['loanId','quantity','location'])||!quantity(item.quantity)||typeof item.location!=='string')return unavailable();const loan=state.fulfillment.sampleMovements.find(m=>m.id===item.loanId&&m.kind==='lend'),out=loan?.referenceTransfer;if(!loan||!out||out.direction!=='out'||out.devId!==dev.id||out.dispatchId!==p.dispatchId||p.receivedAt<out.occurredAt)return unavailable('原借出资料已变化或不属于本次归还');
    const e=caps.find(e=>e.referenceId===out.referenceId),r=refs.find(r=>r.id===out.referenceId),s=samples.find(s=>s.id===loan.sampleId),snap=r?.snapshots.find(s=>s.id===out.snapshotId);if(!e?.canReturn||!e.readable||!r||r.sampleId!==loan.sampleId||!s||!snap||!access.writableSampleIds.includes(s.id))return unavailable('原借出或实物当前不可办理');selectedCaps.push(e);
    const total=(totals.get(loan.id)||0)+item.quantity;totals.set(loan.id,total);if(total>sampleLoanRemaining(state,loan.id)||!sampleUnitAllowsDecimal(s.unit)&&!Number.isInteger(item.quantity)||s.sizeQuantities&&item.quantity!==s.quantity)return unavailable('本次归还超过未归还量或单位不符');
    const v=state.versions.find(v=>v.id===out.taskVersionId&&v.devId===dev.id);if(!v)return unavailable();add('原借出',snap.facts.code+' · '+v.label+' · '+out.occurredAt);add('本次归还',item.quantity+' '+snap.facts.unit);add('归还位置',item.location||'未记录位置');
   }deliveryRows(p.delivery);if(typeof p.note==='string'&&p.note.trim())add('归还说明',p.note.trim());
  }
 }catch(e){return unavailable(e instanceof Error?e.message:'参考资料无法完整核对');}
 if(rows.length>250||rows.some(r=>r.value.length>2500))return unavailable('内容过多，请在开发案内核对办理');
 const typed=command as DevelopmentReferenceCommand;
 return{title,reason:'',rows,fingerprint:stableJson([command,selectedCaps,developmentReferenceSourceFingerprint(typed,state,access)])};
}
