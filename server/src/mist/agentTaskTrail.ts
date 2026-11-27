/** 小竹的办理过程：只给本人看“做了什么、读了哪条记录”，不带任何读取到的内容。 */
import { AGENT_OBJECT_TYPES } from './agentRead';
import { commandLabel } from './agentCommandLabel';
import { taskAttachmentLabels } from '../shared/mistTaskAttachments';
import type { AgentTaskTrailItem } from '../shared/mistAgentTasks';
import { PLATFORM_TASK_TURN_LIMIT, type PlatformTaskStep } from './platformTaskPlan';

const typeLabel = (type: unknown) => AGENT_OBJECT_TYPES.find(t => t.type === type)?.label ?? '业务记录';
const text = (value: unknown, limit = 40) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
// 读取尚未返回时只有内部编号；UUID 之类对人无意义，宁可只写对象类型。
const humanId = (value: unknown) => { const v = text(value, 24); return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) ? '' : v; };
/** 读取结果自带的 bambook://open 链接 → 页面、编号与锚点；没有链接时不给跳转。 */
function target(link: unknown): { view: string; id: string; section?: string } | undefined {
  if (typeof link !== 'string') return undefined;
  try {
    const url = new URL(link);
    if (url.protocol !== 'bambook:' || url.hostname !== 'open') return undefined;
    const view = url.searchParams.get('view'), id = url.searchParams.get('id'), section = url.searchParams.get('section');
    return view && id ? { view, id, ...(section ? { section } : {}) } : undefined;
  } catch { return undefined; }
}

// Tool errors can include source content. Only stable server messages are shown.
const FILE_FAILURE_DETAILS = new Map([
  ['附件已变化，请从首段重新读取','原件已变化，无法继续读取'],
  ['Excel 正文读取方式已更新，请从首段重新读取','Excel 正文读取方式已更新，请从首段重新读取'],
  ['引用的原附件已变化','原件已变化，无法继续读取'],
  ['附件不存在或当前账号无权访问','原件不存在或无权访问'],
  ['原附件不存在或无权访问','原件不存在或无权访问'],
  ['该附件的原件权限已变化','原件读取权限已变化'],
  ['附件原文件无法核验','无法核验原件'],
  ['该附件没有可用的下一段；请核对最近一次读取结果。','原件没有可继续读取的位置'],
]);

export function platformTrail(steps: PlatformTaskStep[] | undefined, attachments: readonly {id:string;name:string}[] = []): AgentTaskTrailItem[] {
  const labels=taskAttachmentLabels(attachments);
  const numberedNames=new Map(attachments.flatMap((file,index)=>{
    if(labels[index]===file.name)return [];
    const suffix=labels[index].slice(file.name.length);
    return [[file.id,text(file.name,60-suffix.length)+suffix] as const];
  }));
  const names=new Map(attachments.map(file=>[file.id,text(file.name,60)]));
  const taskAttachmentIds=new Set(names.keys());
  const out: AgentTaskTrailItem[] = [];
  for (const step of steps ?? []) {
    const { name, arguments: args } = step.plan as { name: string; arguments: Record<string, any> }, result = step.result as any, at = step.at;
    const completed = step.result !== undefined;
    const unreadableFile = name === 'bambook_file_text' && completed && !step.compacted
      && (result?.kind === 'unreadable' || result?.kind === 'unsupported' || result?.text === '');
    const failed = result?.error === true || unreadableFile;
    const progress = text(step.plan.progress, 240);
    const base = { at, completed, ...(failed ? { failed: true } : {}), ...(progress ? { progress } : {}) };
    switch (name) {
      case 'bambook_query': out.push({ ...base, kind: 'read', label: `查询${typeLabel(args.type)}${text(args.q) ? ` “${text(args.q)}”` : ''}${Number.isSafeInteger(result?.total) ? ` · ${result.total} 条` : ''}` }); break;
      case 'bambook_get': {
        const record = result?.object ?? result;
        const name = text(record?.label) || humanId(args.id), to = failed ? undefined : target(record?.link); out.push({ ...base, kind: 'read', label: `读取${typeLabel(args.type)}${name ? ' ' + name : ''}`, ...(typeof args.type === 'string' && typeof args.id === 'string' && completed && !failed ? { ref: { type: args.type, id: to?.id ?? args.id, label: name || typeLabel(args.type), ...(to ? { view: to.view, ...(to.section ? { section: to.section } : {}) } : {}) } } : {}) }); break; }
      case 'bambook_related': {
        const record = completed && !failed && !step.compacted ? result?.object : undefined;
        const name = text(record?.label);
        const to = target(record?.link);
        const detail = Number.isSafeInteger(record?.total) && record.total >= 0
          ? record.truncated === true ? `部分结果 · 共 ${record.total} 条` : `${record.total} 条关联记录`
          : '';
        out.push({ ...base, kind: 'read', label: `展开${typeLabel(args.type)}${name ? ' ' + name + ' ' : ''}的关联记录`,
          ...(detail ? { detail } : {}),
          ...(to && typeof args.type === 'string' ? { ref: { ...to, type: args.type, label: name || typeLabel(args.type) } } : {}),
        });
        break;
      }
      case 'bambook_get_orders': {
        const orders = completed && !failed && !step.compacted && Array.isArray(result?.orders) ? result.orders : [];
        const refs: NonNullable<AgentTaskTrailItem['refs']> = [];
        const labels: string[] = [];
        for (const order of orders) {
          const label = text(order?.label, 32);
          const to = target(order?.link);
          if (order?.type === 'order' && to?.view === 'orders/detail' && to.id === order.id) {
            refs.push({ ...to, type: 'order', label: label || typeLabel('order') });
          } else if (label) labels.push(label);
        }
        if (orders.length && result.truncated) labels.push('部分详情需回原单核对');
        const detail = labels.join(' · ');
        out.push({ ...base, kind:'read', label:orders.length ? `读取 ${orders.length} 张订单` : '读取订单详情',
          ...(refs.length ? { refs } : {}), ...(detail ? { detail } : {}) });
        break;
      }
      case 'bambook_commands': out.push({ ...base, kind: 'read', label: '查看可用操作' }); break;
      case 'bambook_audit': out.push({ ...base, kind: 'read', label: '查看操作记录' }); break;
      case 'bambook_file_text': {
        const observedName=text(result?.file?.name,60);
        const matchedId=typeof args.fileId==='string'&&result?.file?.id===args.fileId ? args.fileId : undefined;
        if(observedName&&matchedId)names.set(matchedId,observedName);
        const taskAttachmentId=completed&&!step.compacted&&result?.error!==true&&matchedId&&taskAttachmentIds.has(matchedId) ? matchedId : undefined;
        const file=numberedNames.get(args.fileId)||observedName||names.get(args.fileId);
        const pages=result?.range;
        const pageRange=result?.kind==='pdf'&&Number.isSafeInteger(pages?.pageFrom)&&Number.isSafeInteger(pages?.pageTo)
          &&pages.pageFrom>=1&&pages.pageTo>=pages.pageFrom
          ? `第 ${pages.pageFrom===pages.pageTo?pages.pageFrom:`${pages.pageFrom} 至 ${pages.pageTo}`} 页` : '';
        const missingPages=pageRange&&Array.isArray(result.pagesWithoutText)
          ? [...new Set<number>(result.pagesWithoutText.filter((page:unknown)=>typeof page==='number'&&Number.isSafeInteger(page)&&page>=pages.pageFrom&&page<=pages.pageTo))].sort((a,b)=>a-b).slice(0,20)
          : [];
        const taskAttachmentPageRange=taskAttachmentId&&pageRange
          ? {from:pages.pageFrom,to:pages.pageTo} : undefined;
        const observedPages = taskAttachmentPageRange && Array.isArray(result.pageTextSpans)
          ? [...new Set<number>([
            ...result.pageTextSpans.map((span: {page?:unknown})=>span?.page)
              .filter((page:unknown)=>typeof page==='number'&&Number.isSafeInteger(page)&&page>=pages.pageFrom&&page<=pages.pageTo),
            ...missingPages,
          ])].sort((a,b)=>a-b).slice(0,20) : undefined;
        const taskAttachmentPage: number | undefined = taskAttachmentPageRange
          ? (missingPages.length === 1 ? missingPages[0] : observedPages?.[0] ?? pages.pageFrom) : undefined;
        const observedSheets = taskAttachmentId && result?.kind==='xlsx' && Array.isArray(result.observedSheets)
          ? [...new Set<string>(result.observedSheets.filter((name:unknown)=>typeof name==='string'&&name.length>0))]
          : undefined;
        const partialText = pages?.textLimited === true || pages?.start > 0;
        const rangeDetail = pageRange ? partialText
          ? `${pageRange}的部分正文` : `提取范围${pageRange}` : '';
        const unreadablePages = missingPages.length > 0 && missingPages.length === pages.pageTo - pages.pageFrom + 1
          ? `${pageRange}无可提取文字`
          : missingPages.length ? `${rangeDetail}；第 ${missingPages.join('、')} 页无可提取文字` : '';
        const pdfDetail = unreadablePages || (!failed ? rangeDetail : '');
        const detail = result?.error === true ? FILE_FAILURE_DETAILS.get(result.message)
          : pdfDetail ? `${pdfDetail}${result.hasMore?'；还有后续内容':''}`
          : failed ? text(result?.reason, 120)
          : result?.hasMore ? '本次读取部分正文，还有后续内容'
          : result?.complete ? '已提取可读取正文' : '';
        const readLabel=!completed&&typeof args.cursor==='string'?'续读附件':'读取附件';
        out.push({ ...base, kind: 'read', label: result?.error===true?`附件读取失败${file?' '+file:''}`:file?`${readLabel} ${file}`:`${readLabel}正文`, ...(detail ? { detail } : {}), ...(taskAttachmentId ? { taskAttachmentId } : {}), ...(taskAttachmentPage !== undefined ? { taskAttachmentPage, taskAttachmentPageRange } : {}), ...(observedPages ? {taskAttachmentObservedPages:observedPages} : {}), ...(observedSheets ? {taskAttachmentObservedSheets:observedSheets} : {}) });
        break;
      }
      case 'bambook_mail_receiving': out.push({ ...base, kind: 'read', label: '查看邮箱收件状态' }); break;
      case 'bambook_preview': out.push({ ...base, kind: 'write', label: `预演：${commandLabel(args.command)}` }); break;
      case 'bambook_execute': out.push({ ...base, kind: 'write', label: result?.status === 'awaiting_confirmation' ? `提交待你确认：${commandLabel(args.command)}` : `${commandLabel(args.command)}` }); break;
      case 'bambook_task': {
        const a = args.action;
        if (a === 'question') out.push({ ...base, kind: 'ask', label: '向你提问' });
        else if (a === 'wait') out.push({ ...base, kind: 'wait', label: '等待后继续' });
        else if (a === 'checkpoint') out.push({ ...base, kind: 'note', label: completed ? text(args.summary, 60) || '保存进度' : '记录进展' });
        else if (a === 'finish' && progress) out.push({ ...base, kind: 'note', label: '整理回复' });
        break;
      }
    }
  }
  return out.slice(-PLATFORM_TASK_TURN_LIMIT);
}
