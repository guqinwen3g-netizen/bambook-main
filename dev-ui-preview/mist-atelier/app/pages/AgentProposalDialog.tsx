import {customerCommandChangesCredit} from '../../../../server/src/shared/mistCustomerFieldAuthority';
import {stableJson} from '../../../../server/src/shared/stableJson';
import React from 'react';
import { ui, uiText } from '../../../../services/interfaceLanguage';
import { businessDate } from '../runtime/businessClock';
import { Banner, Button, Dialog, Field, KeyValue, PasswordInput, Pill, SignaturePad, TextArea, type SignatureValue } from '../../../../components/mist';
import { commandRequiresSignature } from '../runtime/signatureRules';
import { agentProposalRisk, AGENT_RISK_LABEL, type AgentProposal } from '../../../../server/src/shared/mistAgentProposals';
import type { MistCommand, MistState } from '../../../../server/src/shared/mistWorkspace';
import type { OrderGovernanceInput } from '../../../../server/src/shared/mistOrderGovernance';
import { reviewEmailAnalysis } from '../../../../server/src/shared/mistEmailReview';
import { emailLinkTarget } from '../../../../server/src/shared/mistEmail';
import { orderAmounts } from './orderAmounts';
import { paymentMethodLabel } from '../runtime/tradeOptions';

export function mailProposalDetails(proposal: AgentProposal, state?: MistState | null) {
  const { type, payload: p } = proposal.command;
  if (!type.startsWith('email.extraction.')) return null;
  const m = state?.email.messages.find(m => m.id === p.id);
  const missing = { reason: '邮件或整理版本已变化，请重新核对', subject: '', fields: [] as Array<{ label: string; value: string; quote?: string }>, note: '' };
  if (!m) return missing;
  if (type === 'email.extraction.review') {
    if (!m.analysis) return missing;
    try {
      const reviewed = reviewEmailAnalysis(m.analysis, p as any);
      return { subject: m.subject, reason: '', fields: [{ label: '分类', value: reviewed.category }, ...reviewed.fields.map(f => ({ label: f.field, value: f.value, quote: f.quote }))], note: reviewed.note };
    } catch { return missing; }
  }
  const submission = m.submissions.find(s => s.taskId === p.taskId);
  if (!submission || submission.resolution) return missing;
  return { subject: m.subject, reason: '', fields: [{ label: '业务对象', value: emailLinkTarget(state!, submission.link)?.label || '对象已不可用' }, { label: '处理结果', value: p.outcome === 'handled' ? '已处理' : '不适用' }], note: String(p.note || '') };
}

/**
 * 确认时列出将要执行的内容：按提议命令的 payload 逐项展开（嵌套对象按路径，数组逐项）。
 * 中风险超长值截断；高风险不截断——本人输入密码确认的必须是完整内容。超出显示上限时返回 omitted，调用方须禁用确认。
 */
const FIELD_LABEL: Record<string, string> = { acceptanceDate:'客户验收日',acceptanceBasis:'验收依据', grade:'客户等级', creditLimit:'信用额度', title: '标题', due: '期限', name: '名称', note: '备注', notes: '备注', amount: '金额', currency: '币种', date: '日期', start: '开始', end: '结束', status: '状态', reason: '原因', assigneeId: '负责人', ownerId: '负责人', customerId: '客户', supplierId: '供应商', orderId: '订单', quantity: '数量', qty: '数量', price: '单价', unitPrice: '单价', terms: '条款', email: '邮箱', phone: '电话', address: '地址', subject: '主题', body: '正文', to: '收件人', cc: '抄送', code: '编号', kind: '类型', type: '类型', decision: '决定', allocations: '分配', lines: '明细', items: '明细', billId: '应付单', invoiceId: '发票', paymentId: '付款', receiptId: '到账', id: '对象', target: '关联对象', view: '页面', tags: '标签', remark: '备注' };
/** 字段路径转成业务名称；包装层 patch / payload 不显示，未登记的字段保留原名，避免误译。 */
export function proposalFieldLabel(path: string): string {
  if (!path) return '内容';
  const parts = path.split('.').filter(part => part !== 'patch' && part !== 'payload');
  return parts.length ? parts.map(part => /^\d+$/.test(part) ? '第' + part + '项' : FIELD_LABEL[part] ?? part).join(' · ') : '内容';
}

const DEVELOPMENT_LABEL:Record<string,string>={draftId:'开发草稿',name:'开发对象',customer:'客户',style:'客户款号',season:'季节',category:'品类',kind:'开发类型',domain:'业务类型',fabric:'面料',color:'颜色',target:'目标价',sizeBase:'基码',goal:'开发要求',factories:'工厂',due:'目标日期',collaborators:'协作人',sampleQuantity:'样品数量',fileIds:'附件',initiator:'发起方',requestType:'客户要求类型',requestNote:'要求说明',charged:'收费',sampleForm:'样品形态',sampleUnit:'样品单位',targetCurrency:'目标价币种',targetUnit:'计价单位'};
const QUOTATION_LABEL:Record<string,string>={id:'报价草稿',previousId:'来源报价',customerId:'客户',season:'季节',validUntil:'有效期',deliveryTerms:'贸易术语',paymentTerms:'付款条件',fxRate:'报价汇率',fileIds:'附件',lines:'条目',productId:'产品档案',sourceDevId:'来源开发案',sourceVersionId:'来源版本',name:'品名',style:'客户款号',specification:'规格',unit:'计价单位',cost:'参考成本价',specs:'规格',sizeRange:'尺码段',mainFabric:'主面料',composition:'成分',weight:'克重（g/m²）',width:'门幅（cm）',moqQty:'MOQ 数量',moqUnit:'MOQ 单位'};
const RFQ_LABEL:Record<string,string>={id:'询价单',quoteId:'供应商报价',supplierId:'供应商',supplierIds:'供应商',fileIds:'附件',moq:'MOQ 数量',promisedDue:'承诺交期',validUntil:'报价有效期',declined:'谢绝报价',declineReason:'谢绝原因',orderId:'来源订单',lineId:'来源条目',deadline:'报价截止日',description:'采购内容',destination:'交付地点',kind:'采购内容',materialKind:'物料类别'};
function rfqSourceMissing(command:AgentProposal['command'],state?:MistState|null){
 if(command.type!=='rfq.quote'&&command.type!=='rfq.award')return false;
 const p=command.payload,r=state?.rfqs?.find(r=>r.id===p.id);if(!state||!r||r.state!=='open')return true;
 const filesMissing=(ids:unknown)=>Array.isArray(ids)&&ids.some(id=>typeof id==='string'&&!state.files.some(f=>f.id===id));
 if(command.type==='rfq.quote')return !r.supplierIds.includes(String(p.supplierId))||(!state.market.suppliers.some(s=>s.id===p.supplierId)&&!r.quotes.some(q=>q.supplierId===p.supplierId&&q.supplier))||filesMissing(p.fileIds);
 const q=r.quotes.find(q=>q.id===p.quoteId&&!q.supersededAt&&!q.declined);return !q||filesMissing(q.fileIds);
}
function quotationSourceMissing(command:AgentProposal['command'],state?:MistState|null){
  if(command.type!=='market.quotation.save'||!state)return false;
  const p=command.payload,input=p.input as Record<string,unknown>|undefined;
  if(!input||typeof input!=='object'||Array.isArray(input))return true;
  const missing=(id:unknown,rows:Array<{id:string}>)=>typeof id==='string'&&!!id&&!rows.some(r=>r.id===id);
  return missing(p.id,state.market.quotations)||missing(input.previousId,state.market.quotations)||missing(input.customerId,state.customers)
    ||Array.isArray(input.fileIds)&&input.fileIds.some(id=>missing(id,state.files))
    ||Array.isArray(input.lines)&&input.lines.some(line=>line&&typeof line==='object'&&(missing(line.productId,state.market.products)||missing(line.sourceDevId,state.devs)||missing(line.sourceVersionId,state.versions)));
}
const ORDER_LABEL:Record<string,string>={type:'订单类型',season:'季节 / 批次',due:'交期',name:'品名',nameEn:'英文品名',style:'款号 / 品号',unit:'单位',governance:'合同',poNumber:'PO / 合同号',confirmationFileIds:'客户依据',internalPurpose:'内部用途',receiver:'接收团队 / 负责人',paymentMethod:'付款方式',depositPercent:'定金比例（%）',preShipmentPercent:'出运前累计收款（%）',paymentNote:'付款条款',incoterm:'贸易术语',deliveryPlace:'交付地点',overPercent:'溢装上限（%）',shortPercent:'短装下限（%）',quantityBasis:'数量口径',quantityBasisNote:'数量依据',breakdown:'规格明细',composition:'成分',width:'门幅（cm）',weight:'克重（g/m²）',rows:'颜色明细',color:'颜色 / 色号',sizes:'尺码',quantities:'各码数量',sourceProductId:'来源产品',sourceDevId:'来源开发案',sourceVersionId:'来源版本',sourceQuotationId:'来源报价',sourceQuotationLineId:'来源报价条目',internalSupply:'内部供料',receiverId:'接收负责人',markupPercent:'内部加价（%）'};
function orderSourceMissing(command:AgentProposal['command'],state?:MistState|null){
  const contractDraft=command.type==='order.governance.saveDraft';
  if(command.type!=='order.create'&&!contractDraft)return false;
  if(!state)return true;
  const p=command.payload,contract=(contractDraft?p.input:p.governance) as Partial<OrderGovernanceInput>|undefined,missing=(id:unknown,rows:Array<{id:string}>)=>typeof id==='string'&&!!id&&!rows.some(row=>row.id===id);
  const patch=p.orderPatch as {ownerId?:unknown}|undefined;
  if(contractDraft&&!state.orders.some(order=>order.id===p.orderId))return true;
  const memberMissing=(id:unknown)=>typeof id==='string'&&!!id&&!state.members?.some(m=>m.userId===id);
  // Governance proposals can introduce new line IDs. Missing from the active
  // order is therefore not enough to reject one; known cross-order IDs are invalid.
  return missing(p.customerId,state.customers)||memberMissing(contractDraft?patch?.ownerId:p.ownerId)||memberMissing(contract?.internalSupply?.receiverId)
    ||Array.isArray(contract?.confirmationFileIds)&&contract.confirmationFileIds.some(id=>missing(id,state.files))
    ||Array.isArray(p.lines)&&p.lines.some(line=>line&&typeof line==='object'&&((contractDraft&&typeof line.id==='string'&&state.orderLines.some(row=>row.id===line.id&&row.orderId!==p.orderId))||missing(line.sourceProductId,state.market.products)||missing(line.sourceDevId,state.devs)||missing(line.sourceVersionId,state.versions)||missing(line.sourceQuotationId,state.market.quotations)
      ||typeof line.sourceQuotationLineId==='string'&&!!line.sourceQuotationLineId&&!state.market.quotations.find(q=>q.id===line.sourceQuotationId)?.lines.some(l=>l.id===line.sourceQuotationLineId)));
}
export function proposalFieldChanges(command: AgentProposal['command'], full = false, state?:MistState|null): { rows: Array<{ field: string; path: string; value: string }>; omitted: number } {
  const rows: Array<{ field: string; path: string; value: string }> = [], limit = full ? 200 : 40;
  const development=command.type==='development.saveDraft',quotation=command.type==='market.quotation.save',rfqCommand=command.type.startsWith('rfq.');
  const orderCreate=command.type==='order.create',orderContract=command.type==='order.governance.saveDraft';
  const currentOrder=orderContract?state?.orders.find(order=>order.id===command.payload.orderId):undefined;
  const currentContract=currentOrder?.governance?.changeDraft?.contract??currentOrder?.governance?.contract;
  const contractPatch=command.payload.orderPatch as {currency?:unknown}|undefined;
  if(orderCreate){
    const lines=command.payload.lines,contract=command.payload.governance as Partial<OrderGovernanceInput>|undefined;
    const total=orderAmounts(Array.isArray(lines)?lines.map(line=>({qty:line?.qty,price:line?.price})):[]);
    rows.push({field:contract?.kind==='internal'?'内部预算':'订单总金额',path:'order.total',value:total.total===null||!Array.isArray(lines)||!lines.length?'金额无效':total.total.toFixed(2)+' '+String(command.payload.currency||'')});
  }
  const rfq=rfqCommand?state?.rfqs?.find(r=>r.id===command.payload.id):undefined;
  const customerUpdate=['market.customer.update','customer.update'].includes(command.type),customer=customerUpdate?state?.customers.find(c=>c.id===command.payload.id):undefined;
  const creditChange=!!customer&&customerCommandChangesCredit(command,state);
  if(creditChange){
    const p=command.payload.patch as Record<string,unknown>,amount=p.creditLimit??customer!.creditLimit,denomination=String(p.currency??customer!.currency);
    const money=(value:unknown,currency:string)=>typeof value==='number'&&Number.isFinite(value)?value.toFixed(2)+' '+currency:'金额无效';
    rows.push({field:'客户',path:'customer',value:customer!.name+' · '+customer!.code},{field:'原信用额度',path:'credit.before',value:money(customer!.creditLimit,customer!.currency)},{field:'拟设信用额度',path:'credit.after',value:money(amount,denomination)});
  }
  let omitted = 0;
  const walk = (value: unknown, path: string) => {
    if(creditChange&&['id','patch.creditLimit','patch.currency'].includes(path))return;
    // mistMarket#sourceLine/save derives these from saved data; the input cannot set them.
    if(quotation&&/^(input\.(approvalHistory|requiresApproval)|input\.lines\.\d+\.(costBasis|family|marginFloor))(\.|$)/.test(path))return;
    // Image tokens select decoration, not a commercial term or a source object.
    if((orderCreate||orderContract)&&/^lines\.\d+\.img$/.test(path))return;
    if(orderContract&&currentContract&&path.startsWith('input.')){
      const key=path.slice(6).split('.')[0];
      if(stableJson((command.payload.input as Record<string,unknown>)[key])===stableJson((currentContract as unknown as Record<string,unknown>)[key]))return;
    }
    if (value && typeof value === 'object') {
      const entries = Array.isArray(value) ? value.map((child, i) => [String(i + 1), child] as const) : Object.entries(value);
      if (entries.length) { for (const [key, child] of entries) walk(child, path ? path + '.' + key : key); return; }
    }
    if (rows.length >= limit) { omitted++; return; }
    let text = typeof value === 'string' ? value : JSON.stringify(value) ?? '',field=proposalFieldLabel(path);
    if(customerUpdate&&path==='id')text=customer?customer.name+' · '+customer.code:'客户已不可见';
    if(orderCreate||orderContract){
      const key=path.split('.').at(-1);
      field=path.split('.').filter(p=>!orderContract||!['input','orderPatch'].includes(p)).map(p=>/^\d+$/.test(p)?'第'+p+'项':ORDER_LABEL[p]||FIELD_LABEL[p]||p).join(' · ');
      if(path==='orderId')text=currentOrder?.code||'订单已不可见';
      else if(path==='customerId')text=state?.customers.find(c=>c.id===value)?.name||'客户已不可见';
      else if(/^lines\.\d+\.id$/.test(path)){
        const line=state?.orderLines.find(line=>line.id===value&&line.orderId===currentOrder?.id)??currentOrder?.governance?.changeDraft?.lines.find(line=>line.id===value);
        const proposed=Array.isArray(command.payload.lines)?command.payload.lines.find(line=>line?.id===value):undefined;
        const proposedName=typeof proposed?.style==='string'&&proposed.style||typeof proposed?.name==='string'&&proposed.name;
        text=line?.style||line?.name||proposedName||'新增条目';
      }
      else if(key==='ownerId'||key==='receiverId')text=state?.members?.find(m=>m.userId===value)?.name||'负责人已不可见';
      else if(orderContract&&/^lines\.\d+\.price$/.test(path))text=typeof value==='number'&&Number.isFinite(value)?value.toFixed(2)+' '+String(contractPatch?.currency||currentOrder?.governance?.changeDraft?.orderPatch?.currency||currentOrder?.currency||''):'金额无效';
      else if(/^(governance|input)\.confirmationFileIds\.\d+$/.test(path))text=state?.files.find(f=>f.id===value)?.name||'附件已不可见';
      else if(key==='sourceProductId')text=value?state?.market.products.find(p=>p.id===value)?.name||'产品已不可见':'未指定';
      else if(key==='sourceDevId')text=value?state?.devs.find(d=>d.id===value)?.code||'开发案已不可见':'未指定';
      else if(key==='sourceVersionId')text=value?state?.versions.find(v=>v.id===value)?.label||'版本已不可见':'未指定';
      else if(key==='sourceQuotationId')text=value?state?.market.quotations.find(q=>q.id===value)?.code||'报价已不可见':'未指定';
      else if(key==='sourceQuotationLineId')text=value?state?.market.quotations.flatMap(q=>q.lines).find(l=>l.id===value)?.name||'报价条目已不可见':'未指定';
      else if(path==='type'||key==='group'||path.endsWith('breakdown.kind'))text=({garment:'成衣',fabric:'面料'} as Record<string,string>)[text]||text;
      else if(/^(governance|input)\.kind$/.test(path))text=({external:'外部客户订单',internal:'内部用途订单'} as Record<string,string>)[text]||text;
      else if(key==='paymentMethod')text=paymentMethodLabel(text);
      else if(key==='quantityBasis')text=({total:'按总量',size:'按尺码'} as Record<string,string>)[text]||text;
      else if(typeof value==='boolean')text=value?'是':'否';
      if(!text)text='未填写';
    }
    if(development){
      field=path.split('.').filter(p=>p!=='values').map(p=>/^\d+$/.test(p)?'第'+p+'项':DEVELOPMENT_LABEL[p]||FIELD_LABEL[p]||p).join(' · ');
      if(path==='draftId')text=state?.drafts.find(d=>d.id===value)?.values.name||'开发草稿';
      else if(/^fileIds\.\d+$/.test(path)&&state)text=state.files.find(f=>f.id===value)?.name||'附件已不可见';
      else if(path==='values.kind')text=({new:'全新开发',rev:'基于已有改版',copy:'复制其他客户款'} as Record<string,string>)[text]||text;
      else if(path==='values.domain')text=({garment:'成衣',fabric:'面料'} as Record<string,string>)[text]||text;
      else if(typeof value==='boolean')text=value?'是':'否';
      else if(text==='[]')text='未指定';
      if(!text)text='未填写';
    }
    if(quotation){
      field=path.split('.').filter(p=>p!=='input').map(p=>/^\d+$/.test(p)?'第'+p+'项':QUOTATION_LABEL[p]||FIELD_LABEL[p]||p).join(' · ');
      if(path==='id'||path==='input.previousId')text=state?.market.quotations.find(q=>q.id===value)?.code||'报价已不可见';
      else if(path==='input.customerId')text=state?.customers.find(c=>c.id===value)?.name||'客户已不可见';
      else if(/^input\.fileIds\.\d+$/.test(path))text=state?.files.find(f=>f.id===value)?.name||'附件已不可见';
      else if(/\.productId$/.test(path))text=value?state?.market.products.find(p=>p.id===value)?.name||'产品已不可见':'未指定';
      else if(/\.sourceDevId$/.test(path))text=value?state?.devs.find(d=>d.id===value)?.code||'开发案已不可见':'未指定';
      else if(/\.sourceVersionId$/.test(path))text=value?state?.versions.find(v=>v.id===value)?.label||'版本已不可见':'未指定';
      else if(typeof value==='boolean')text=value?'是':'否';
      else if(text==='[]')text='未指定';
      if(!text)text='未填写';
    }
    if(rfqCommand){
      const key=path.split('.').at(-1);
      field=path.split('.').filter(p=>p!=='input').map(p=>/^\d+$/.test(p)?'第'+p+'项':RFQ_LABEL[p]||FIELD_LABEL[p]||p).join(' · ');
      if(path==='id')text=rfq?.code||'询价单已不可见';
      else if(path==='quoteId'){const q=rfq?.quotes.find(q=>q.id===value);text=q?`${q.supplier} · ${q.price} ${q.currency}/${rfq!.unit}`:'报价已不可见';}
      else if(key==='supplierId'||/supplierIds\.\d+$/.test(path))text=state?.market.suppliers.find(s=>s.id===value)?.name||rfq?.quotes.find(q=>q.supplierId===value)?.supplier||'供应商已不可见';
      else if(/fileIds\.\d+$/.test(path))text=state?.files.find(f=>f.id===value)?.name||'附件已不可见';
      else if(key==='orderId')text=state?.orders.find(o=>o.id===value)?.code||'订单已不可见';
      else if(key==='lineId'){const line=state?.orderLines.find(l=>l.id===value);text=line?.style||line?.name||'条目已不可见';}
      else if(key==='kind')text=({processing:'加工服务',finished:'成品',material:'材料'} as Record<string,string>)[text]||text;
      else if(typeof value==='boolean')text=value?'是':'否';
      else if(text==='[]')text='未指定';
      if(!text)text='未填写';
    }
    rows.push({ field, path, value: !full && text.length > 200 ? text.slice(0, 200) + '…' : text });
  };
  walk(command.payload, '');
  return { rows, omitted };
}

export type ProposalAccountRow = { label: string; after: string; before?: string; mono?: boolean };

/**
 * 收款账户类提议逐项对照原值与新值。账号必须完整显示：摘要只有“修改银行账户”或尾号，本人无法据此核对收款去向。
 * 原记录不在本人可见范围时只列新值，不猜测原值。
 */
export function proposalAccountRows(command: AgentProposal['command'], state?: MistState | null): ProposalAccountRow[] | null {
  const p = command.payload as Record<string, unknown>, s = (v: unknown) => v === undefined || v === null ? '' : String(v).trim();
  const row = (label: string, after: unknown, before?: unknown, mono = false): ProposalAccountRow => ({ label, after: s(after), ...(before === undefined ? {} : { before: s(before) }), ...(mono ? { mono } : {}) });
  if (command.type === 'finance.account.save') {
    const old = p.id ? state?.bankAccounts?.find(a => a.id === p.id) : undefined;
    return [row('账户名称', p.name, old?.name), row('开户行', p.bankName, old?.bankName), row('银行账号', s(p.accountNo).replace(/\s+/g, ''), old?.accountNo, true),
      row('币种', s(p.currency).toUpperCase(), old?.currency), row('期初日期', p.openingDate, old?.openingDate), row('期初余额', p.openingBalance, old?.openingBalance)];
  }
  const profile = (p.companyProfile && typeof p.companyProfile === 'object' ? p.companyProfile : undefined) as Record<string, unknown> | undefined;
  if (command.type === 'settings.update' && profile && ['bankName', 'bankAccount', 'swift', 'bankAddress'].some(k => profile[k] !== undefined)) {
    const old = state?.settings?.companyProfile;
    return [row('开户行', profile.bankName ?? old?.bankName, old?.bankName), row('银行账号', s(profile.bankAccount ?? old?.bankAccount).replace(/\s+/g, ''), old?.bankAccount, true),
      row('SWIFT', s(profile.swift ?? old?.swift).toUpperCase(), old?.swift, true), ...(profile.bankAddress !== undefined || old?.bankAddress ? [row('开户行地址', profile.bankAddress ?? old?.bankAddress, old?.bankAddress)] : [])];
  }
  if (command.type === 'market.supplier.bank.save') {
    const supplier = state?.market?.suppliers?.find(x => x.id === p.supplierId), currency = s(p.currency).toUpperCase();
    const old = supplier?.bankAccounts?.find(a => a.state === 'active' && a.currency === currency);
    return [row('供应商', supplier?.name || p.supplierId), row('币种', currency), row('账户名称', p.accountName, old?.accountName), row('开户行', p.bankName, old?.bankName),
      row('银行账号', s(p.accountNo).replace(/\s+/g, ''), old?.accountNo, true), ...(p.swift || old?.swift ? [row('SWIFT', s(p.swift).toUpperCase(), old?.swift, true)] : []), row('核实记录', p.verification)];
  }
  return null;
}

/**
 * 本人确认 Agent 提议：确认后由服务端按本人身份执行提议里的原命令（完整权限与业务校验），失败时提议保持待确认。
 * 中、高风险都列出将要执行的具体内容；高风险另须本人密码。拒绝只记录结论，不改业务。
 */
export function AgentProposalDialog({ proposal, state, scopeKey = '', onClose, run, onDone, onRejection }: {
  proposal: AgentProposal | undefined; state?: MistState | null; scopeKey?: string; onClose: () => void; run: (command: MistCommand, options?: { reauth?: { password: string }; signature?: { svg: string } }) => Promise<unknown>; onDone: (message: string) => void; onRejection?: (message: string) => void;
}) {
  const [note, setNote] = React.useState(''), [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState(''), [password, setPassword] = React.useState(''), [signature, setSignature] = React.useState<SignatureValue | null>(null);
  const [pendingFailure,setPendingFailure]=React.useState(false),failureRef=React.useRef<HTMLDivElement>(null),alive=React.useRef(true);
  const active=React.useRef({scope:scopeKey,id:proposal?.id});
  if(active.current.scope!==scopeKey||active.current.id!==proposal?.id)active.current={scope:scopeKey,id:proposal?.id};
  React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  React.useLayoutEffect(()=>{if(failure)failureRef.current?.scrollIntoView?.({block:'nearest'});},[failure]);
  React.useEffect(() => { setNote(''); setFailure(''); setPassword(''); setSignature(null);setPendingFailure(false);setBusy(false); }, [proposal?.id,scopeKey]);
  if (!proposal) return null;
  const mail = mailProposalDetails(proposal, state);
  // 风险等级与服务端共用 agentProposalRisk：未登记的普通写入按中风险，付款、核销、审批等按高风险须输入密码。服务端仍会独立校验档位、密码与原业务权限。
  const risk = agentProposalRisk(proposal, state), detailed = risk !== 'low' && !mail;
  const account = detailed ? proposalAccountRows(proposal.command, state) : null;
  const orderCreate=proposal.command.type==='order.create';
  const fields = detailed ? proposalFieldChanges(proposal.command, risk === 'high'||orderCreate, state) : { rows: [], omitted: 0 };
  const draftSourceMissing=proposal.command.type==='development.saveDraft'&&state&&(
    proposal.command.payload.draftId&&!state.drafts.some(d=>d.id===proposal.command.payload.draftId)
    ||Array.isArray(proposal.command.payload.fileIds)&&proposal.command.payload.fileIds.some(id=>!state.files.some(f=>f.id===id)));
  const quoteSourceMissing=quotationSourceMissing(proposal.command,state);
  const rfqSourceUnavailable=rfqSourceMissing(proposal.command,state);
  const orderSourceUnavailable=orderSourceMissing(proposal.command,state);
  // 公司收款账户只对照银行字段；同一命令里的其他设置仍逐项列出。
  const changes = account && proposal.command.type !== 'settings.update' ? [] : account ? fields.rows.filter(r => !/^companyProfile\.(bankName|bankAccount|swift|bankAddress)$/.test(r.path)) : fields.rows;
  const incomplete = (risk === 'high'||orderCreate) && fields.omitted > 0;
  // Agent 起草的合同与资金类批准，由确认人本人当场签字；Agent 不能代签。
  const signing = commandRequiresSignature(proposal.command);
  const decide = async (command: MistCommand, message: string, reauth?: { password: string }, signed?: { svg: string }) => {
    if (busy||pendingFailure) return; const operation=active.current;setBusy(true); setFailure('');
    const sameScope=()=>alive.current&&active.current.scope===operation.scope&&(active.current===operation||active.current.id===undefined);
    try { await run(command, reauth || signed ? { ...(reauth ? { reauth } : {}), ...(signed ? { signature: signed } : {}) } : undefined);if(!sameScope())return;setPassword(''); setSignature(null); onDone(message); onClose(); }
    catch (error) {if(!alive.current||active.current!==operation)return;const text=error instanceof Error?error.message:String(error),uncertain=!!(error as {mistPendingCommand?:unknown})?.mistPendingCommand;
      // The provider checks the synchronous intent and exact message; a rendered pending flag may lag a known rejection.
      if(!uncertain)onRejection?.(text);setPassword('');setPendingFailure(uncertain);if(text===failure)failureRef.current?.scrollIntoView?.({block:'nearest'});setFailure(text);
    }
    finally {if(sameScope())setBusy(false);}
  };
  return <Dialog open onClose={() => { if (!busy) onClose(); }} width={560} title={uiText('确认 Agent 提议')}
    footer={<><Button disabled={busy} onClick={onClose}>{uiText('稍后')}</Button>
      <Button disabled={busy||pendingFailure} onClick={() => void decide({ type: 'agent.proposal.reject', payload: { id: proposal.id, ...(note.trim() ? { note: note.trim() } : {}) } }, '已拒绝提议')}>{uiText('拒绝')}</Button>
      <Button variant="primary" loading={busy} disabled={busy || pendingFailure || !!mail?.reason || !!proposal.taskBlocked || proposal.unavailable || !!draftSourceMissing || quoteSourceMissing || rfqSourceUnavailable || orderSourceUnavailable || incomplete || (risk === 'high' && !password) || (signing && !signature)} onClick={() => void decide({ type: 'agent.proposal.confirm', payload: { id: proposal.id } }, '已确认并执行', risk === 'high' ? { password } : undefined, signing && signature ? { svg: signature.svg } : undefined)}>{uiText('确认执行')}</Button></>}>
    <div className="mist-col" data-agent-proposal-dialog>
      {failure && <div ref={failureRef}><Banner tone={pendingFailure?'warn':'bad'} title={uiText(pendingFailure?'结果待核对':'没有执行')}>{failure}</Banner></div>}
      {draftSourceMissing&&<Banner tone="warn" title={uiText('草稿或附件已不可见，请重新核对')} />}
      {quoteSourceMissing&&<Banner tone="warn" title={uiText('报价或来源资料已不可见，请重新核对')} />}
      {rfqSourceUnavailable&&<Banner tone="warn" title={uiText('询价或报价依据已不可用，请重新核对')} />}
      {orderSourceUnavailable&&<Banner tone="warn" title={uiText('订单或来源资料已不可见，请重新核对')} />}
      {proposal.taskBlocked && <Banner tone="warn" title={uiText(proposal.taskBlocked)} />}
      <div className="mist-col" data-agent-proposal-summary>{proposal.summary.map((line, i) => <span key={i}>{line}</span>)}</div>
      <KeyValue items={[{ label: uiText('提出'), value: `${proposal.agentIdentity?.name || 'Agent'} · ${businessDate(proposal.createdAt)}` }, { label: uiText('执行身份'), value: proposal.owner }]} />
      <div className="mist-row" data-agent-proposal-risk={risk}><Pill tone={risk === 'high' ? 'bad' : risk === 'medium' ? 'warn' : 'neutral'}>{uiText(AGENT_RISK_LABEL[risk])}</Pill></div>
      {account && <div className="mist-col" data-agent-proposal-account><span className="mist-cell-strong">{uiText('收款账户')}</span>
        <KeyValue items={account.map(r => {
          const show = (v: string) => r.mono && v ? <span className="mist-mono">{v}</span> : v || '—';
          return { label: r.label, value: r.before !== undefined && r.before !== r.after
            ? <span className="mist-col" data-changed><span>{show(r.after)}</span><span className="mist-sub">{uiText('原')} · {show(r.before)}</span></span>
            : show(r.after) };
        })} />
      </div>}
      {changes.length > 0 && <div className="mist-col" data-agent-proposal-changes><span className="mist-cell-strong">{uiText('将要改动的字段')}</span>{changes.map((c, i) => <span key={i}>{c.field} · {c.value}</span>)}{fields.omitted > 0 && <span className="mist-sub">{ui`另有 ${fields.omitted} 项未显示`}</span>}</div>}
      {incomplete && <Banner tone="warn" title={uiText('内容过多，无法在此完整核对')}>{uiText('请拒绝后让 Agent 拆成较小的操作重新提交')}</Banner>}
      {mail && <div className="mist-col">
        {mail.reason ? <Banner tone="warn" title={uiText(mail.reason)} /> : <>
          <span className="mist-cell-strong">{mail.subject}</span>
          {mail.fields.map((f, i) => <div className="mist-col" key={i}><span>{uiText(f.label)} · {uiText(f.value)}</span>{f.quote && <span className="mist-sub">{uiText('原文依据')} · {f.quote}</span>}</div>)}
          {mail.note && <span className="mist-sub">{mail.note}</span>}
        </>}
      </div>}
      {risk === 'high' && <Field label={uiText('本人登录密码')} required><PasswordInput aria-label={uiText('本人登录密码')} autoComplete="current-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></Field>}
      {signing && <Field label={uiText('确认签字')} required><SignaturePad key={proposal.id} ariaLabel="确认签字" disabled={busy} onChange={setSignature} /></Field>}
      <Field label={uiText('拒绝原因')}><TextArea aria-label={uiText('拒绝原因')} rows={2} value={note} onChange={event => setNote(event.target.value)} /></Field>
    </div>
  </Dialog>;
}
