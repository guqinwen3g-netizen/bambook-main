import type {AgentProposalCommandBody} from '../../../../server/src/shared/mistAgentProposals';
import type {MistState} from '../../../../server/src/shared/mistWorkspace';
import {applyDevelopmentIncomingCommand,developmentIncomingReadKeys,type DevelopmentIncomingAccess,type DevelopmentIncomingCommand} from '../../../../server/src/shared/mistDevelopmentIncoming';
import {developmentInitiator} from '../../../../server/src/shared/mistDevelopmentDomain';
import {sampleLoanRemaining} from '../../../../server/src/shared/mistFulfillment';
import {stableJson} from '../../../../server/src/shared/stableJson';

type Row={field:string;path:string;value:string};
export type IncomingProposalDetails={title:string;reason:string;rows:Row[];fingerprint:string};
const TITLE:Record<string,string>={'development.incoming.receive':'登记来样','development.incoming.dispatch':'来样寄工厂','development.incoming.return':'原样退回'};
const keys=(value:unknown,allowed:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
function sourceValue(state:MistState,path:string[]){let value:any=state;for(const part of path){if(part.startsWith('k:'))value=value?.[part.slice(2)];else value=Array.isArray(value)?value.find(row=>row?.id===part.slice(2)):undefined;}return value;}
/** Human review only: execute the existing validator on a private clone, never produce a persisted fact. */
export function incomingProposalDetails(command:AgentProposalCommandBody,state:MistState|null|undefined,access:DevelopmentIncomingAccess|undefined,now:string):IncomingProposalDetails|null{
 const title=TITLE[command.type];if(!title)return null;
 const blocked=(reason:string):IncomingProposalDetails=>({title,reason,rows:[],fingerprint:''});
 if(!state)return blocked('正在读取来样资料，请稍后核对');
 const p=command.payload,dev=state.devs.find(dev=>dev.id===p.devId);
 if(!dev||!access?.readableDevIds.includes(dev.id)||!access.writableDevIds.includes(dev.id))return blocked('来样来源不可见或当前账号不能办理，请重新核对');
 const receive=command.type==='development.incoming.receive',dispatch=command.type==='development.incoming.dispatch';
 const allowed=receive?['devId','receivedAt','name','form','quantity','unit','size','color','location','contact','fileIds','note']:dispatch?['devId','taskVersionId','items','sentAt','returnExpected','expectedReturn','delivery','postage','note']:['devId','dispatchId','items','receivedAt','delivery','note'];
 if(!keys(p,allowed))return blocked('来样内容无法完整核对，请重新提交提议');
 if(receive){if(!Array.isArray(p.fileIds)||p.fileIds.some(id=>typeof id!=='string'||!state.files.some(file=>file.id===id)))return blocked('来样附件已不可见，请重新核对');}
 else if(!Array.isArray(p.items)||p.items.some(item=>!keys(item,dispatch?['sampleId','quantity','sourceLocation']:['loanId','quantity','location']))||!keys(p.delivery,['kind','recipient','address','carrier','trackingNo','evidence'])||dispatch&&!keys(p.postage,['amount','currency','zeroReason']))return blocked('来样内容无法完整核对，请重新提交提议');
 const body=command as DevelopmentIncomingCommand;
 try{let serial=0;applyDevelopmentIncomingCommand(structuredClone(state),body,{id:()=>`incoming-review-${++serial}`,actorId:'incoming-review',actorName:'本人',now});}catch(e){return blocked(e instanceof Error?e.message:'来样资料无法核对');}
 const rows:Row[]=[],add=(field:string,value:unknown)=>rows.push({field,path:'incoming.'+rows.length,value:String(value??'').trim()||'未记录'});
 add('开发案',dev.code+' · '+dev.name);if(receive)add('提供方',developmentInitiator(dev.values)==='customer'?dev.customer:dev.values.requester);
 const specimen=(id:string)=>state.fulfillment.samples.find(sample=>sample.id===id)!;
 const describe=(id:string)=>{const sample=specimen(id);return sample.code+' · '+sample.name+' · '+sample.form+' · '+sample.quantity+' '+sample.unit+([sample.size,sample.color].filter(Boolean).length?' · '+[sample.size,sample.color].filter(Boolean).join(' / '):'');};
 if(receive){add('实际收样日',p.receivedAt);add('来样',String(p.name)+' · '+p.form);add('实际数量',p.quantity+' '+p.unit);if(p.unit==='件')add('实物建档','每件独立编号');add('尺码 / 颜色',[p.size,p.color].filter(Boolean).join(' / '));add('存放位置',p.location);add('提供方联系人',p.contact);if((p.fileIds as string[]).length)add('附件',(p.fileIds as string[]).map(id=>state.files.find(file=>file.id===id)!.name).join('；'));}
 else{
  const dispatchBody=dispatch?body as Extract<DevelopmentIncomingCommand,{type:'development.incoming.dispatch'}>:null,returnBody=dispatch?null:body as Extract<DevelopmentIncomingCommand,{type:'development.incoming.return'}>;
  const loan=returnBody?state.fulfillment.sampleMovements.find(move=>move.id===returnBody.payload.items[0].loanId)!:null;
  const versionId=dispatchBody?.payload.taskVersionId||loan!.incomingTransfer!.taskVersionId,version=state.versions.find(version=>version.id===versionId&&version.devId===dev.id);
  if(!version)return blocked('原工厂任务已不可见，请重新核对');const supplier=state.market.suppliers.find(supplier=>supplier.id===version.factoryId);if(!supplier)return blocked('工厂资料已不可见，请重新核对');add('工厂任务',version.label+' · '+supplier.name);
  if(dispatchBody){add('实际寄送日',dispatchBody.payload.sentAt);for(const item of dispatchBody.payload.items){const sample=specimen(item.sampleId);if(!sample.incoming?.providerName||!sample.incoming.receivedAt)return blocked('原来样提供方或收样资料不完整，请重新核对');add('来样实物',describe(item.sampleId));add('实物提供方',sample.incoming.providerName);add('原收样日',sample.incoming.receivedAt);add('本次出库',item.quantity+' '+sample.unit+' · '+(item.sourceLocation||'位置未记录'));}add('是否需退原样',p.returnExpected?'需退回':'不需退回');if(p.expectedReturn)add('预计归还日',p.expectedReturn);const postage=dispatchBody.payload.postage;add('我方邮费',postage.amount.toFixed(2)+' '+postage.currency);if(postage.zeroReason)add(postage.amount===0?'零支出原因':'费用说明',postage.zeroReason);}
  else{add('实际退回日',returnBody!.payload.receivedAt);for(const item of returnBody!.payload.items){const original=state.fulfillment.sampleMovements.find(move=>move.id===item.loanId)!,sample=specimen(original.sampleId);if(!sample.incoming?.providerName||!sample.incoming.receivedAt)return blocked('原来样提供方或收样资料不完整，请重新核对');add('来样实物',describe(sample.id));add('实物提供方',sample.incoming.providerName);add('原收样日',sample.incoming.receivedAt);add('原借出',original.incomingTransfer!.occurredAt+' · '+original.quantity+' '+sample.unit+' · '+original.incomingTransfer!.delivery.recipient+' · '+original.incomingTransfer!.delivery.trackingNo);add('原借出未还',sampleLoanRemaining(state,original.id)+' '+sample.unit);add('本次退回',item.quantity+' '+sample.unit+' · '+(item.location||'位置未记录'));}}
  const delivery=(body as Exclude<DevelopmentIncomingCommand,{type:'development.incoming.receive'}>).payload.delivery;add('交接方式',delivery.kind==='courier'?'快递':'当面交接');add('收件人',delivery.recipient);add('收件地址',delivery.address);if(delivery.kind==='courier'){add('快递公司',delivery.carrier);add('运单号',delivery.trackingNo);}else add('交接依据',delivery.evidence);
 }
 if(p.note)add('备注',p.note);
 if(rows.length>200||rows.some(row=>row.value.length>2000))return blocked('内容过多，无法完整核对，请拆分提议');
 return{title,reason:'',rows,fingerprint:stableJson([command,developmentIncomingReadKeys(state,body).map(path=>[path,sourceValue(state,path)])])};
}
