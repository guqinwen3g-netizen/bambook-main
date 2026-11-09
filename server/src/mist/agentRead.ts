/**
 * 工作助手业务读取（bambook_query / bambook_get / bambook_expand）。
 * 只在“按当前执行者权限裁剪后的公司状态”上运行：仓储先按账号权限 ∩ 委托上限投影，这里再按对象类型的读权限复核一次。
 * 列表返回摘要；单对象在响应预算内返回完整结构，超限明确标记不完整；单对象附带它引用且本人可见的附件清单（名称、类型、大小），不返回图片/附件字节。
 */
import type { TokenPayload } from '../auth/service';
import { hasScope } from '../auth/permissionService';
import type { PermissionScope } from '../_shared/rolePermissionMatrix';
import type { MistState } from '../shared/mistWorkspace';
import { emailSendEffectiveStatus, emailSendRecipients } from '../shared/mistEmail';
import { MistApiError } from './errors';

type ObjectType = { type: string; label: string; scope: PermissionScope; path: string[]; view: string; section?: string; linkId?: (row: any) => string | undefined; /** Rows that live inside parent records (generated documents) are flattened here instead of walked by `path`. */ flatten?: (state: MistState) => any[] };

/** 首批可读对象。view 与前端路由一致，链接由页面用 go(view, id) 打开。 */
export const AGENT_OBJECT_TYPES: ObjectType[] = [
  { type: 'email', label: '邮件', scope: 'emails:read', path: ['email', 'messages'], view: 'emails' },
  { type: 'email_draft', label: '邮件草稿', scope: 'emails:read', path: ['email', 'drafts'], view: 'emails' },
  { type: 'email_send', label: '邮件发送记录', scope: 'emails:read', path: ['email', 'sends'], view: 'emails', linkId:r=>r.supersededById?undefined:r.status==='sent'?r.sentMessageId:r.id },
  { type: 'customer', label: '客户', scope: 'relations:read', path: ['customers'], view: 'crm' },
  { type: 'contact', label: '联系人', scope: 'relations:read', path: ['contacts'], view: 'crm', linkId: r => r.customerId },
  { type: 'order', label: '订单', scope: 'orders:read', path: ['orders'], view: 'orders/detail' },
  { type: 'order_line', label: '订单行', scope: 'orders:read', path: ['orderLines'], view: 'orders/detail', linkId: r => r.orderId },
  { type: 'development', label: '开发单', scope: 'products:read', path: ['devs'], view: 'development/detail' },
  { type: 'dev_version', label: '开发版本', scope: 'products:read', path: ['versions'], view: 'development/detail', linkId: r => r.devId },
  { type: 'product', label: '产品档案', scope: 'products:read', path: ['market', 'products'], view: 'products' },
  { type: 'sample', label: '样品', scope: 'products:read', path: ['fulfillment', 'samples'], view: 'samples' },
  { type: 'quotation', label: '报价', scope: 'quotations:read', path: ['market', 'quotations'], view: 'quotations' },
  { type: 'supplier', label: '供应商', scope: 'suppliers:read', path: ['market', 'suppliers'], view: 'suppliers' },
  { type: 'purchase', label: '采购合同', scope: 'procurement:read', path: ['fulfillment', 'purchases'], view: 'procurement' },
  { type: 'receipt', label: '收货记录', scope: 'procurement:read', path: ['fulfillment', 'receipts'], view: 'procurement', linkId: r => r.purchaseId },
  // 应付链：结算、票据、预付计划、付款申请、供应商付款、核销分配、预付退款/转抵。行级范围已由仓储投影裁剪（业务员只到本人采购），这里只复核读权限。
  { type: 'payable_settlement', label: '采购结算', scope: 'invoices:read', path: ['payables', 'settlements'], view: 'payment-vouchers', section: 'payables' },
  { type: 'payable_bill', label: '供应商票据', scope: 'invoices:read', path: ['payables', 'bills'], view: 'payment-vouchers', section: 'payables' },
  { type: 'payment_plan', label: '付款计划', scope: 'invoices:read', path: ['payables', 'plans'], view: 'payment-vouchers', section: 'payables' },
  { type: 'payment_request', label: '付款申请', scope: 'invoices:read', path: ['payables', 'requests'], view: 'payment-vouchers', section: 'payables' },
  { type: 'supplier_payment', label: '供应商付款', scope: 'invoices:read', path: ['payables', 'payments'], view: 'payment-vouchers', section: 'payables' },
  { type: 'payment_allocation', label: '付款分配', scope: 'invoices:read', path: ['payables', 'allocations'], view: 'payment-vouchers', section: 'payables', linkId: r=>r.supplierPaymentId },
  { type: 'prepayment_move', label: '预付退款/转抵', scope: 'invoices:read', path: ['payables', 'prepaymentMoves'], view: 'procurement', linkId: r=>r.purchaseId },
  { type: 'production', label: '生产', scope: 'production:read', path: ['productions'], view: 'production-board' },
  { type: 'shipment', label: '出运', scope: 'shipments:read', path: ['fulfillment', 'shipments'], view: 'shipments' },
  // 出运单据（CI/PL/BL 等）：与报关与单证分区同一读权限；只给元数据与文件编号，不给文件字节，生成快照不入模型。
  { type: 'shipment_document', label: '出运单据', scope: 'customs:read', path: ['fulfillment', 'documents'], view: 'shipments', linkId: r => r.shipmentId },
  // 报价单、PI/SC 生成记录：嵌在报价/订单记录内，按所属记录的读权限展开；只给文件元数据，不给快照与字节。
  { type: 'quotation_document', label: '报价单文件', scope: 'quotations:read', path: ['market', 'quotations'], view: 'quotations', linkId: r => r.quotationId, flatten: state => ((state as any).market?.quotations ?? []).flatMap((q: any) => (q.documents ?? []).map((d: any) => ({ ...d, code: q.code, kind: 'QUOTATION' }))) },
  { type: 'order_document', label: '订单合同文件', scope: 'orders:read', path: ['orders'], view: 'orders/detail', linkId: r => r.orderId, flatten: state => ((state as any).orders ?? []).flatMap((o: any) => (o.documents ?? []).map((d: any) => ({ ...d, orderId: o.id, code: d.number }))) },
  // 收款与核销链、锁汇结汇、信用证、询价、索样、报表订阅：读权限与 access.ts 读分区一致，分区缺权限时仓储投影已清空，这里再复核一次。
  { type: 'receipt_record', label: '客户收款', scope: 'invoices:read', path: ['receipts'], view: 'receipts' },
  { type: 'receipt_allocation', label: '收款核销', scope: 'invoices:read', path: ['allocations'], view: 'receipts', linkId: r => r.receiptId },
  { type: 'finance_reversal', label: '财务冲正', scope: 'invoices:read', path: ['financeReversals'], view: 'receipts' },
  { type: 'customer_statement', label: '客户对账单', scope: 'invoices:read', path: ['customerStatements'], view: 'invoices' },
  // 月结：记录以月份为键（无 id），读取时用月份作 id；状态（已关/已重开）、关账人与重开原因都是公司内可见的账期事实。
  { type: 'period_close', label: '月结', scope: 'invoices:read', path: ['periodCloses'], view: 'receipts', flatten: state => ((state as any).periodCloses ?? []).filter((c: any) => c && typeof c.month === 'string').map((c: any) => ({ ...c, id: c.month, code: c.month, status: c.reopened ? 'reopened' : 'closed' })) },
  { type: 'bank_account', label: '公司银行账户', scope: 'vouchers:write', path: ['bankAccounts'], view: 'receipts' },
  { type: 'fx_record', label: '锁汇结汇', scope: 'vouchers:read', path: ['fxRecords'], view: 'receipts' },
  { type: 'letter_of_credit', label: '信用证', scope: 'customs:read', path: ['letterOfCredits'], view: 'shipments' },
  { type: 'rfq', label: '供应商询价', scope: 'procurement:read', path: ['rfqs'], view: 'procurement' },
  { type: 'sample_request', label: '客户索样', scope: 'products:read', path: ['sampleRequests'], view: 'samples' },
  { type: 'report_schedule', label: '报表订阅', scope: 'reports:read', path: ['reportSchedules'], view: 'reports' },
  // 出口退税：嵌在 exportRebate 内，读权限 tax:read；计税基数由仓储投影按 sensitive:tax_base 脱敏（金额置 0，标 taxMasked），这里不另行处理。
  { type: 'rebate_rate', label: '退税率版本', scope: 'tax:read', path: ['exportRebate', 'rates'], view: 'rebate' },
  { type: 'rebate_claim', label: '出口退税申报', scope: 'tax:read', path: ['exportRebate', 'claims'], view: 'rebate' },
  { type: 'invoice', label: '发票', scope: 'invoices:read', path: ['invoices'], view: 'invoices' },
  { type: 'risk', label: '风险', scope: 'risk:read', path: ['platform', 'risks'], view: 'risks' },
  { type: 'claim', label: '售后案件', scope: 'aftersales:read', path: ['platform', 'claims'], view: 'claims' },
];

const LABEL_FIELDS = ['code', 'sku', 'name', 'title', 'label', 'style', 'subject'];
const TEXT_LIMIT = 300;
const GET_LIMIT = 16_000;
export const QUERY_LIMIT_MAX = 20;
export const RELATED_LIMIT = 30;
const QUERY_RESULT_MAX = 20_000; // 留出公司等字段的空间，低于本机 Harness 的 24k 单工具上限。

function deny(code: string, message: string, status = 400): never { throw new MistApiError(code, message, status); }

function rows(state: MistState, type: ObjectType): any[] {
  if (type.flatten) return type.flatten(state).filter(r => r && typeof r === 'object' && typeof r.id === 'string').map(row => mailReadRecord(type.type, row));
  let value: any = state;
  for (const key of type.path) value = value?.[key];
  return Array.isArray(value) ? value.filter(r => r && typeof r === 'object' && typeof r.id === 'string').map(row=>mailReadRecord(type.type,row)) : [];
}
/** Only public mail facts are model-visible; request keys and the record-level transport response stay internal. */
const DOCUMENT_CONTENT_LIMIT = 2_000;
/** Shipment documents expose facts and file ids only; generated snapshots carry full party/price tables and stay out of the model context. */
function documentReadRecord(row:any){
  const content=typeof row.content==='string'?row.content:'';
  return{id:row.id,shipmentId:row.shipmentId,orderId:row.orderId,type:row.type,number:row.number,version:row.version,title:row.title,status:row.status,dueDate:row.dueDate,createdAt:row.createdAt,issuedAt:row.issuedAt,invoiceId:row.invoiceId,fileIds:row.fileIds,
    generated:Array.isArray(row.generated)?row.generated.map((g:any)=>({id:g.id,kind:g.kind,number:g.number,fileId:g.fileId,fileName:g.fileName,sha256:g.sha256,bytes:g.bytes,generatedAt:g.generatedAt,sealed:!!g.sealUseId})):[],
    ...(row.externalIssue?{externalIssue:{issuer:row.externalIssue.issuer,at:row.externalIssue.at}}:{}),
    ...(row.financeRejection?{financeRejection:{reason:row.financeRejection.reason,at:row.financeRejection.at}}:{}),
    content:content.slice(0,DOCUMENT_CONTENT_LIMIT),...(content.length>DOCUMENT_CONTENT_LIMIT?{contentTruncated:true}:{})};
}
/** Generated quotation / order files: file facts only; the stored snapshot holds prices, parties and terms and stays out of the model context. */
function generatedFileReadRecord(row:any){
  return{id:row.id,...(row.quotationId?{quotationId:row.quotationId}:{}),...(row.orderId?{orderId:row.orderId}:{}),code:row.code,kind:row.kind??row.orderKind,number:row.number,revision:row.revision,version:row.version,draft:row.draft,fileId:row.fileId,fileName:row.fileName,sha256:row.sha256,bytes:row.bytes,templateVersion:row.templateVersion,generatedAt:row.generatedAt,generatedBy:row.generatedBy,sealed:!!row.sealUseId};
}
/** Bank account numbers are masked to the last four digits; everything else about the account (name, balance basis, closure) stays readable. */
function bankAccountReadRecord(row:any){
  const no=typeof row.accountNo==='string'?row.accountNo.replace(/\s/g,''):'';
  return{...row,accountNo:no?'****'+no.slice(-4):''};
}
function mailReadRecord(type:string,row:any){
  if(type==='bank_account')return bankAccountReadRecord(row);
  // 报价和订单记录里内嵌的生成文件也不带快照，和单独读取文件一致。
  if((type==='order'||type==='quotation')&&Array.isArray(row.documents))return{...row,documents:row.documents.map(({snapshot:_snapshot,...document}:any)=>document)};
  if(type==='shipment_document')return documentReadRecord(row);
  if(type==='quotation_document'||type==='order_document')return generatedFileReadRecord(row);
  if(!['email_draft','email_send'].includes(type))return row;
  const common={id:row.id,subject:row.subject,accountId:row.accountId,...(type==='email_send'?{status:row.status,effectiveStatus:emailSendEffectiveStatus(row)}:{}),from:row.from,to:row.to,cc:row.cc,bcc:row.bcc,createdAt:row.createdAt,updatedAt:row.updatedAt,body:row.body,replyToId:row.replyToId};
  if(type==='email_draft')return{...common,updatedBy:row.updatedBy,template:row.template,links:row.links,fileIds:row.fileIds};
  const recipients=emailSendRecipients(row),recipientCounts={pending:0,accepted:0,rejected:0,failed:0,unknown:0};
  for(const recipient of recipients){const status=Object.prototype.hasOwnProperty.call(recipientCounts,recipient.status)?recipient.status:'unknown';recipientCounts[status]++;}
  const attempts=(row.attempts??[]).map((a:any)=>({at:a.at,actor:a.actor,outcome:a.outcome,code:a.code,message:a.message,recipients:a.recipients}));
  return{...common,draftId:row.draftId,sentMessageId:row.sentMessageId,forwardOfId:row.forwardOfId,supersededById:row.supersededById,createdBy:row.createdBy,createdById:row.createdById,recipients:recipients.map(r=>({address:r.address,role:r.role,status:r.status,reply:r.reply,at:r.at})),recipientCounts,attemptCount:attempts.length,latestAttempt:attempts.at(-1)??null,attempts,links:row.links,fileIds:row.fileIds};
}
function readable(actor: TokenPayload,excludeTypes:readonly string[] = []) { return AGENT_OBJECT_TYPES.filter(t => hasScope(actor, t.scope)&&!excludeTypes.includes(t.type)); }
function typeOf(name: unknown, actor: TokenPayload): ObjectType {
  const type = AGENT_OBJECT_TYPES.find(t => t.type === name);
  if (!type) deny('INVALID_INPUT', `不支持的对象类型；可用：${AGENT_OBJECT_TYPES.map(t => t.type).join(', ')}`);
  if (!hasScope(actor, type!.scope)) deny('FORBIDDEN', `当前账号无权读取${type!.label}`, 403);
  return type!;
}
function labelOf(row: any): string {
  for (const key of LABEL_FIELDS) if (typeof row[key] === 'string' && row[key].trim()) return row[key].trim().slice(0, 120);
  return row.id;
}
/** 去掉图片数据、截短长文本；嵌套对象只保留到给定深度。 */
function compact(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return value.startsWith('data:') ? '[图片数据已省略]' : value.length > TEXT_LIMIT ? value.slice(0, TEXT_LIMIT) + '…' : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth <= 0) return Array.isArray(value) ? `[${value.length} 项]` : '[对象]';
  if (Array.isArray(value)) { const head = value.slice(0, 20).map(v => compact(v, depth - 1)); return value.length > 20 ? [...head, `…另有 ${value.length - 20} 项`] : head; }
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'img').map(([k, v]) => [k, compact(v, depth - 1)]));
}
/** A small record must not lose facts merely because its review history is deeply nested. */
function completeDataWithinLimit(row:unknown):Record<string,unknown>|undefined{
  let remaining=GET_LIMIT,nodes=0,complete=true;
  const read=(value:any,depth:number):any=>{
    if(!complete)return;
    if(++nodes>10_000||depth>32){complete=false;return;}
    if(typeof value==='string'){
      if(value.startsWith('data:')||value.length>remaining){complete=false;return;}
      remaining-=JSON.stringify(value).length;
      if(remaining<0){complete=false;return;}return value;
    }
    if(value===null||typeof value==='number'||typeof value==='boolean'){remaining-=JSON.stringify(value).length;if(remaining<0)complete=false;return value;}
    if(value===undefined)return;
    if(typeof value!=='object'){complete=false;return;}
    remaining-=2;
    if(Array.isArray(value)){
      if(value.length>10_000){complete=false;return;}
      const result=[];for(const item of value){if(result.length)remaining--;result.push(read(item,depth+1));if(!complete)break;}return result;
    }
    const entries:Array<[string,unknown]>=[];
    for(const key of Object.keys(value)){
      // Binary image content is outside the business-record read contract, as in compact().
      if(key==='img'||value[key]===undefined)continue;
      remaining-=JSON.stringify(key).length+1+(entries.length?1:0);
      if(remaining<0){complete=false;break;}entries.push([key,read(value[key],depth+1)]);if(!complete)break;
    }
    return Object.fromEntries(entries);
  };
  const data=read(row,0);return complete&&data&&JSON.stringify(data).length<=GET_LIMIT?data:undefined;
}
function summary(row: any) {
  return Object.fromEntries(Object.entries(row).filter(([k, v]) => k !== 'img' && (v === null || ['string', 'number', 'boolean'].includes(typeof v))).slice(0, 14).map(([k, v]) => [k, compact(v, 0)]));
}
function link(type: ObjectType, row: any) {
  const id = type.linkId ? type.linkId(row) : row.id;
  return typeof id === 'string' && id ? `bambook://open?${new URLSearchParams({view:type.view,id,...(type.section?{section:type.section}:{})})}` : null;
}
function ref(type: ObjectType, row: any) { return { type: type.type, id: row.id as string, label: labelOf(row), link: link(type, row) }; }

export function agentCatalog(actor: TokenPayload) {
  return readable(actor).map(t => ({ type: t.type, label: t.label }));
}

export function agentQuery(state: MistState, actor: TokenPayload, input: { type?: unknown; q?: unknown; limit?: unknown },options:{excludeTypes?:readonly string[]}={}) {
  if (input.q !== undefined && typeof input.q !== 'string') deny('INVALID_INPUT', 'q 须为查询文字');
  const q = typeof input.q === 'string' ? input.q.trim().toLowerCase().slice(0, 200) : '';
  const limitRaw = input.limit === undefined ? 10 : Number(input.limit);
  if (!Number.isInteger(limitRaw) || limitRaw < 1) deny('INVALID_INPUT', 'limit 须为正整数');
  const limit = Math.min(limitRaw, QUERY_LIMIT_MAX);
  const types = input.type === undefined || input.type === '' ? readable(actor,options.excludeTypes) : [typeOf(input.type, actor)];
  const terms = q.split(/\s+/).filter(Boolean);
  const matches: Array<ReturnType<typeof ref> & { summary: Record<string, unknown> }> = [];
  let total = 0, size = 0;
  for (const type of types) for (const row of rows(state, type)) {
    if (terms.length) {
      const hay = JSON.stringify(summary(row)).toLowerCase();
      if (!terms.every(term => hay.includes(term))) continue;
    }
    total++;
    if (matches.length < limit) {
      const result = { ...ref(type, row), summary: summary(row) }, length = JSON.stringify(result).length + 1;
      if (size + length <= QUERY_RESULT_MAX) { matches.push(result); size += length; }
    }
  }
  return { results: matches, total, truncated: total > matches.length, readableTypes: types.map(t => t.type) };
}

function find(state: MistState, actor: TokenPayload, typeName: unknown, id: unknown) {
  const type = typeOf(typeName, actor);
  if (typeof id !== 'string' || !id || id.length > 200) deny('INVALID_INPUT', '对象编号无效');
  const row = rows(state, type).find(r => r.id === id || r.code === id || r.sku === id);
  if (!row) deny('NOT_FOUND', `${type.label}不存在或当前账号不可见`, 404);
  return { type, row };
}

const FILE_KEY = /^(fileId|fileIds|[a-z][A-Za-z]*FileIds?)$/;
const ATTACHMENTS_MAX = 30;
/** 对象（含明细、确认、邮件附件等嵌套记录）引用、且当前账号可见的附件；与 bambook_file_text 同一可见范围。 */
function attachmentsOf(state: MistState, row: unknown) {
  const ids = new Set<string>(); let nodes = 0;
  const walk = (value: any, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 6 || ++nodes > 5_000) return;
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    for (const [key, v] of Object.entries(value)) {
      if (FILE_KEY.test(key)) { if (typeof v === 'string' && v) ids.add(v); else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x) ids.add(x); }
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(row, 0);
  const files = new Map((state.files ?? []).map(f => [f.id, f]));
  const found = [...ids].flatMap(id => { const f = files.get(id); return f ? [{ fileId: f.id, name: f.name, mimeType: f.mimeType, size: f.size }] : []; });
  return found.length > ATTACHMENTS_MAX ? { attachments: found.slice(0, ATTACHMENTS_MAX), attachmentsTotal: found.length } : found.length ? { attachments: found } : {};
}

export function agentGet(state: MistState, actor: TokenPayload, typeName: unknown, id: unknown):ReturnType<typeof ref>&{data:Record<string,unknown>;truncated:boolean;readHint?:string;attachments?:Array<{fileId:string;name:string;mimeType:string;size:number}>;attachmentsTotal?:number} {
  const { type, row } = find(state, actor, typeName, id);
  const files=attachmentsOf(state,row);
  const complete=completeDataWithinLimit(row);
  if(complete)return{...ref(type,row),data:complete,truncated:false,...files};
  const mail=['email','email_draft','email_send'].includes(type.type);
  let data = compact(row, mail ? 5 : 3) as Record<string, unknown>;
  if(mail&&typeof row.body==='string')data.body=row.body.slice(0,10_000);
  let text = JSON.stringify(data);
  if (text.length > GET_LIMIT) {
    data = compact(row, 1) as Record<string, unknown>;
    if(type.type==='email_send'){Object.assign(data,{recipientCounts:row.recipientCounts,attemptCount:row.attemptCount,latestAttempt:compact(row.latestAttempt,3)});data.recipients=compact(row.recipients,3);}
    text = JSON.stringify(data);
  }
  if (text.length > GET_LIMIT) { data = summary(row);if(type.type==='email_send')Object.assign(data,{recipientCounts:row.recipientCounts,attemptCount:row.attemptCount,latestAttempt:compact(row.latestAttempt,3)}); }
  return { ...ref(type, row), data, truncated:true,readHint:'超出单次读取范围；当前结果不完整，请读取关联明细或交本人核对。',...files };
}

/** 关联对象：本对象字段直接引用的对象，以及字段引用了本对象的其它对象（均限当前可读类型）。 */
export function agentRelated(state: MistState, actor: TokenPayload, typeName: unknown, id: unknown,options:{excludeTypes?:readonly string[]}={}) {
  const { type, row } = find(state, actor, typeName, id);
  const idsOf = (r: any): string[] => Object.entries(r).flatMap(([k, v]) => !/(Id|Ids)$/.test(k) ? [] : typeof v === 'string' && v ? [v] : Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
  // 明细行里的引用也算（如票据 lines[].purchaseId、付款申请 lines[].billId），只展开一层。
  const scalarRefs = (r: any) => new Set([...idsOf(r), ...Object.values(r).flatMap(v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)).flatMap(idsOf) : [])]);
  const own = scalarRefs(row);
  const results: Array<ReturnType<typeof ref> & { relation: 'references' | 'referenced_by' }> = [];
  let total = 0;
  for (const other of readable(actor,options.excludeTypes)) for (const candidate of rows(state, other)) {
    if (other === type && candidate.id === row.id) continue;
    const relation = own.has(candidate.id) ? 'references' : scalarRefs(candidate).has(row.id) ? 'referenced_by' : null;
    if (!relation) continue;
    total++;
    if (results.length < RELATED_LIMIT) results.push({ ...ref(other, candidate), relation });
  }
  return { ...ref(type, row), related: results, total, truncated: total > results.length };
}
