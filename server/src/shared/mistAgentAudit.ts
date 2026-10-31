export type AgentAuditSource = 'agent' | 'human_confirmation' | 'human_rejection';
export type AgentAuditPhase = 'executed' | 'proposed' | 'confirmed' | 'rejected';
const AUDIT_DOMAINS:Array<[string,string,string]>=[
  ['payable.settlement.','采购结算','purchase settlement'],['payable.bill.','供应商票据','supplier bill'],['payable.request.','付款申请','payment request'],['payable.payment.','供应商付款','supplier payment'],['payable.plan.','付款计划','payment plan'],['payable.','应付业务','payables'],
  ['finance.account.','公司账户','company account'],['finance.fx.','结汇','FX settlement'],['finance.','财务业务','finance record'],['order.','订单','order'],['fulfillment.procurement.','采购合同','purchase contract'],['fulfillment.production.','生产','production'],['fulfillment.qc.','质检','quality inspection'],['fulfillment.shipments.','出运','shipment'],['fulfillment.','履约业务','fulfillment record'],
  ['development.','开发','development'],['market.customer.','客户','customer'],['customer.','客户','customer'],['contact.','联系人','contact'],['market.supplier.','供应商','supplier'],['market.quotation.','报价','quotation'],['market.','市场资料','market record'],['platform.employee.','员工档案','employee record'],['platform.','业务资料','business record'],
  ['calendar.','日程','calendar event'],['settings.','公司设置','company settings'],['teamScope.','小组范围','team scope'],['member.','成员','member'],['email.','邮件','email'],['rfq.','询价','RFQ'],['rebate.','退税','export rebate'],['funding.','资金归属','fund allocation'],['production.','生产进度','production progress'],['cost.','订单费用','order expense'],['crm.','客户跟进','customer follow-up'],['lc.','信用证','letter of credit'],['opening.','期初余额','opening balance'],['fxrate.','汇率','exchange rate'],['handover.','业务交接','business handover'],['team.','团队工作','team activity'],['fabric.','面料资料','fabric record'],['sourcing.','采购来源','purchase source'],['files.','附件','attachment'],['task.','任务','task'],['notification.','通知','notification'],
];
const AUDIT_VERBS:Record<string,[string,string]>={submit:['提交','Submit'],confirm:['确认','Confirm'],reverse:['冲回','Reverse'],reject:['拒绝','Reject'],cancel:['撤销','Cancel'],approve:['批准','Approve'],decide:['审批','Review'],save:['保存','Save'],update:['更新','Update'],create:['新建','Create'],register:['登记','Register'],add:['新增','Add'],remove:['移除','Remove'],delete:['删除','Delete'],saveDraft:['保存草稿','Save draft for'],assign:['分配','Assign'],release:['放行','Release'],close:['关闭','Close'],send:['发送','Send'],issue:['签发','Issue'],allocate:['分配','Allocate'],settle:['办理','Settle'],move:['调整','Move'],return:['退回','Return'],recordQc:['登记','Record'],recordSample:['登记','Record']};
export function agentAuditActionLabel(type:string,locale='zh-CN'){
  const english=locale.startsWith('en'),domain=AUDIT_DOMAINS.find(([prefix])=>type.startsWith(prefix));
  const words=type.split('.'),verb=[...words].reverse().find(word=>AUDIT_VERBS[word]);
  const action=verb?AUDIT_VERBS[verb]:['办理','Process'];
  return english?`${action[1]} ${domain?.[2]??'business record'}`:`${action[0]}${domain?.[1]??'业务'}`;
}
export const AGENT_AUDIT_FIELD_LABELS:Record<string,string>={
  state:'状态',status:'状态',amount:'金额',quantity:'数量',qty:'数量',note:'说明',reason:'原因',name:'名称',title:'标题',code:'编号',unitPrice:'单价',currency:'币种',date:'日期',due:'到期日',time:'时间',
  ownerId:'负责人',supplierId:'供应商',customerId:'客户',orderId:'订单',orderLineId:'订单条目',lineId:'订单条目',purchaseId:'采购合同',receiptIds:'收货记录',receiptId:'收货记录',settlementId:'结算',
  prepaymentApplied:'预付抵扣',confirmed:'确认记录',reversed:'冲回记录',returned:'退回记录',total:'合计',email:'邮箱',phone:'电话',address:'地址',country:'国家',taxAmount:'税额',invoiceNo:'发票号码',
  actor:'经办人',actorId:'经办人',at:'时间',createdAt:'创建时间',updatedAt:'更新时间',submittedAt:'提交时间',createdBy:'创建人',createdById:'创建人',description:'描述',
  uom:'单位',unit:'单位',lines:'明细',items:'明细',type:'类型',kind:'类别',color:'颜色',size:'尺码',style:'款号',material:'材料',composition:'成分',weight:'克重',width:'幅宽',
  supplier:'供应商',customer:'客户',owner:'负责人',dueBasis:'付款依据',invoiceDate:'开票日期',invoiceKind:'票据类型',taxRate:'税率',taxInclusive:'含税',paymentTerms:'付款条件',
  totalQuantity:'合计数量',rejectedQuantity:'拒收数量',acceptedQuantity:'实收数量',accepted:'实收',rejected:'拒收',plannedQuantity:'计划数量',completedQuantity:'完工数量',
  orderCode:'订单编号',purchaseCode:'采购编号',billId:'应付票据',invoiceId:'发票',accountId:'账户',accountNo:'账号',accountName:'户名',bankName:'银行',balance:'余额',
  source:'来源',target:'关联事项',targetId:'关联记录',result:'结果',decision:'决定',reviewerId:'审核人',reviewedAt:'审核时间',reviewedBy:'审核人',
  deliveryDate:'交期',shipDate:'出运日期',departureDate:'离港日期',warehouseId:'仓库',location:'库位',batch:'批次',lot:'批号',trackingNo:'运单号',
  exchangeRate:'汇率',rate:'汇率',localAmount:'本币金额',foreignAmount:'外币金额',fee:'费用',deduction:'扣款',paymentId:'付款记录',requestId:'申请编号',
  attachments:'附件',fileIds:'附件',fileId:'附件',contact:'联系人',contactId:'联系人',remark:'备注',remarks:'备注',enabled:'启用',active:'在用',
  price:'单价',confirmation:'确认记录',disputes:'争议',adjustReason:'抵扣调整原因',final:'最终结算',finalSettlement:'最终结算',isFinal:'最终结算',submittedBy:'提交人',submitterId:'提交人',suggestedPrepayment:'建议预付抵扣',
};
export type AgentAuditQuery = { scope?: 'mine' | 'company'; actorId?: string; source?: AgentAuditSource; phase?: AgentAuditPhase; proposalId?:string; agentSessionId?:string; since?: string; until?: string; cursor?: string; limit?: number };
export type AgentAuditEntry = {
  requestId: string; at: string; actor: { id: string; name: string }; source: AgentAuditSource; phase: AgentAuditPhase;
  commandType: string; requestedCommandType: string; label: string; agentSessionId: string | null; proposalId?: string;
  agentIdentity?:{id:string;name:string};
  requestedRevision: number; baseRevision: number; committedRevision: number;
};
export type AgentAuditPage = { items: AgentAuditEntry[]; nextCursor: string | null; canReadCompany: boolean; unavailableCount:number };
export type AgentAuditVisibleChange = {
  path: string[]; label: string; operation: 'add' | 'remove' | 'replace' | 'reorder'; before?: unknown; after?: unknown;
  beforeRestricted?: boolean; afterRestricted?: boolean;
};
export type AgentAuditDetail = AgentAuditEntry & {
  command: { type: string; payload?: Record<string, unknown> }; commandRestricted: boolean;
  commandAvailable:boolean;
  changes: AgentAuditVisibleChange[]; detailsRestricted: boolean; systemChangesOmitted: boolean;
  offset: number; totalChanges: number; nextOffset: number | null;
  references: Record<string,string>;
  accessKey: string;
  targets:Array<{label:string;view:string;id:string;section?:string}>;
};
