import type { MistState, MistTarget } from '../../../../server/src/shared/mistWorkspace';
import { PROD_COLUMNS } from '../data';
import { uiText } from '../../../../services/interfaceLanguage';

/** Summarize known system actions; original business notes remain in the source records. */
export function mistActivityTitle(state: MistState | null | undefined, title: string, target?: MistTarget): string {
  const view = target?.view.split('/')[0], id = target?.id;
  const code = view === 'orders' ? state?.orders?.find(row => row.id === id)?.code
    : view === 'production-board' ? state?.productions?.find(row => row.id === id)?.code
    : view === 'procurement' ? state?.fulfillment?.purchases?.find(row => row.id === id)?.code
    : view === 'qc-workbench' ? state?.fulfillment?.qcTasks?.find(row => row.id === id)?.code : undefined;
  const label = (action: string) => [code, uiText(action)].filter(Boolean).join(' · ');
  if (view === 'orders' && /^交接后勤(?:[:：]|$)/.test(title)) return label('后勤交接');
  if (view === 'procurement' && /^采购审批通过(?:[:：]|$)/.test(title)) return label('采购已批准');
  if (view === 'procurement' && /^采购审批退回(?:[:：]|$)/.test(title)) return label('采购已退回');
  if (view === 'production-board') {
    const move = title.match(/^更新工序为 (cut|sew|finish|qc|done)$/);
    if (move) return label(PROD_COLUMNS.find(column=>column.id===move[1])!.title);
  }
  return title;
}
