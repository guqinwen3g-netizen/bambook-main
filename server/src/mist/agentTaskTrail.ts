/** 小竹的办理过程：只给本人看“做了什么、读了哪条记录”，不带任何读取到的内容。 */
import { AGENT_OBJECT_TYPES } from './agentRead';
import type { AgentTaskTrailItem } from '../shared/mistAgentTasks';
import type { PlatformTaskStep } from './platformTaskPlan';

const TRAIL_LIMIT = 30;
const typeLabel = (type: unknown) => AGENT_OBJECT_TYPES.find(t => t.type === type)?.label ?? '业务记录';
const text = (value: unknown, limit = 40) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const COMMAND = (type: unknown) => text(type, 60);
// 读取尚未返回时只有内部编号；UUID 之类对人无意义，宁可只写对象类型。
const humanId = (value: unknown) => { const v = text(value, 24); return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) ? '' : v; };

export function platformTrail(steps: PlatformTaskStep[] | undefined): AgentTaskTrailItem[] {
  const out: AgentTaskTrailItem[] = [];
  for (const step of steps ?? []) {
    const { name, arguments: args } = step.plan as { name: string; arguments: Record<string, any> }, result = step.result as any, at = step.at;
    const failed = result?.error === true, base = { at, ...(failed ? { failed: true } : {}) };
    switch (name) {
      case 'bambook_query': out.push({ ...base, kind: 'read', label: `查询${typeLabel(args.type)}${text(args.q) ? ` “${text(args.q)}”` : ''}${Number.isSafeInteger(result?.total) ? ` · ${result.total} 条` : ''}` }); break;
      case 'bambook_get': { const name = text(result?.label) || humanId(args.id); out.push({ ...base, kind: 'read', label: `读取${typeLabel(args.type)}${name ? ' ' + name : ''}`, ...(typeof args.type === 'string' && typeof args.id === 'string' && !failed ? { ref: { type: args.type, id: args.id, label: name || typeLabel(args.type) } } : {}) }); break; }
      case 'bambook_related': out.push({ ...base, kind: 'read', label: `展开${typeLabel(args.type)}的关联记录` }); break;
      case 'bambook_commands': out.push({ ...base, kind: 'read', label: '查看可用操作' }); break;
      case 'bambook_audit': out.push({ ...base, kind: 'read', label: '查看操作记录' }); break;
      case 'bambook_file_text': out.push({ ...base, kind: 'read', label: '读取附件正文' }); break;
      case 'bambook_mail_receiving': out.push({ ...base, kind: 'read', label: '查看邮箱收件状态' }); break;
      case 'bambook_preview': out.push({ ...base, kind: 'write', label: `预演 ${COMMAND(args.command?.type)}` }); break;
      case 'bambook_execute': out.push({ ...base, kind: 'write', label: result?.status === 'awaiting_confirmation' ? `提交待你确认 ${COMMAND(args.command?.type)}` : `执行 ${COMMAND(args.command?.type)}` }); break;
      case 'bambook_task': {
        const a = args.action;
        if (a === 'question') out.push({ ...base, kind: 'ask', label: '向你提问' });
        else if (a === 'wait') out.push({ ...base, kind: 'wait', label: '等待后继续' });
        else if (a === 'checkpoint') out.push({ ...base, kind: 'note', label: text(args.summary, 60) || '保存进度' });
        break;
      }
    }
  }
  return out.slice(-TRAIL_LIMIT);
}
