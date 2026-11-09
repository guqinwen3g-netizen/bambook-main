/**
 * 小竹提议与办理过程里的命令说明：用业务词和单据名称，不向本人展示内部命令名。
 * 生成正式文件的命令不能预演，提议说明直接按所涉记录写明“生成什么、给谁”。
 */
import type { MistState } from '../shared/mistWorkspace';
import { AGENT_OBJECT_TYPES } from './agentRead';

const DOMAIN_LABEL: Record<string, string> = { task: '待办', calendar: '日程', crm: '客户跟进', customer: '客户', contact: '联系人', order: '订单', fulfillment: '履约', payable: '应付', finance: '财务', funding: '资金', email: '邮件', market: '市场', development: '开发', fabric: '面料', production: '生产', sample: '样品', rfq: '询价', sourcing: '寻源', lc: '信用证', rebate: '退税', cost: '费用', report: '报表', team: '团队', member: '成员', platform: '公司管理', handover: '交接', notification: '通知', fxrate: '汇率', opening: '期初' };
const VERB_LABEL: Record<string, string> = { save: '保存', create: '新建', add: '添加', update: '修改', delete: '删除', remove: '移除', cancel: '取消', submit: '提交', confirm: '确认', decide: '审批', approve: '批准', reject: '驳回', void: '作废', reverse: '冲销', close: '关闭', reopen: '重新打开', issue: '签发', generate: '生成', send: '发送', register: '登记', withdraw: '撤回', receive: '收货', allocate: '分配', transfer: '转移', move: '移动', link: '关联', archive: '归档' };
/** 预演没有业务事件时的提议说明：用中文业务词和单据名称，不向本人展示内部命令名。 */
export function proposalFallbackSummary(command: { type: string; payload?: Record<string, unknown> }): string {
  const parts = command.type.split('.'), verb = VERB_LABEL[parts.at(-1) ?? ''] ?? '办理', domain = DOMAIN_LABEL[parts[0]] ?? '业务';
  const p = command.payload ?? {}, name = [p.title, p.name, p.code, p.subject].find(v => typeof v === 'string' && v.trim()) as string | undefined;
  return `${verb}${domain}${name ? '：' + name.trim().slice(0, 80) : ''}`;
}


/** 会生成正式文件的命令（与仓储的不支持预演清单一致；印章另由执行门禁拒绝 Agent）。 */
export const FILE_PRODUCING_COMMANDS: ReadonlySet<string> = new Set(['order.document.generate', 'fulfillment.documents.generate', 'market.quotation.document', 'fulfillment.procurement.document', 'finance.statement.generate', 'development.notice.generate', 'market.lookbook.document', 'platform.credit.issue']);
const SHIPPING_DOC: Record<string, string> = { CI: '商业发票', PL: '装箱单', SO: '订舱委托', SI: '出运指示', DN: '送货单', SA: '装运通知', BC: '受益人证明', DFT: '汇票', CD: '报关单', CDA: '报关委托书' };
function documentName(command: { type: string; payload?: Record<string, unknown> }): string | undefined {
  const p = command.payload ?? {};
  switch (command.type) {
    case 'order.document.generate': return p.kind === 'SC' ? 'SC（销售合同）' : p.kind === 'PI' ? 'PI（形式发票）' : '订单单据';
    case 'fulfillment.documents.generate': { const t = typeof p.type === 'string' ? p.type : ''; return t ? `${t}${SHIPPING_DOC[t] ? '（' + SHIPPING_DOC[t] + '）' : ''}` : '出运单据'; }
    case 'market.quotation.document': return '报价单';
    case 'fulfillment.procurement.document': return '采购合同';
    case 'finance.statement.generate': return '客户对账单';
    case 'development.notice.generate': return '开发通知';
    case 'market.lookbook.document': return '画册';
    case 'platform.credit.issue': return '贷项通知';
  }
  return undefined;
}
const REF_TYPE: Record<string, string> = { orderId: 'order', shipmentId: 'shipment', quotationId: 'quotation', purchaseId: 'purchase', customerId: 'customer', devId: 'development' };
function recordLabel(state: MistState, command: { payload?: Record<string, unknown> }): string | undefined {
  for (const [key, typeName] of Object.entries(REF_TYPE)) {
    const id = command.payload?.[key];
    if (typeof id !== 'string') continue;
    const type = AGENT_OBJECT_TYPES.find(t => t.type === typeName);
    let rows: any = state; for (const k of type?.path ?? []) rows = rows?.[k];
    const row = Array.isArray(rows) ? rows.find((r: any) => r?.id === id || r?.code === id) : undefined;
    const label = row && [row.code, row.name, row.title].find((v: unknown) => typeof v === 'string' && v.trim());
    if (label) return String(label).trim().slice(0, 80);
  }
  return undefined;
}
/** 生成类提议的说明：第一行写清生成什么、针对哪条记录。 */
export function fileCommandSummary(state: MistState, command: { type: string; payload?: Record<string, unknown> }): string[] {
  const name = documentName(command), target = recordLabel(state, command);
  return name ? [`生成${name}${target ? '：' + target : ''}`, '确认后生成正式文件'] : [proposalFallbackSummary(command)];
}
/** 办理过程里的命令短名：生成类写单据名，其余用业务动词与领域。 */
export function commandLabel(command: { type?: unknown; payload?: unknown }): string {
  if (typeof command?.type !== 'string') return '业务操作';
  const c = { type: command.type, payload: command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload) ? command.payload as Record<string, unknown> : {} };
  const name = documentName(c);
  return name ? `生成${name}` : proposalFallbackSummary(c);
}
