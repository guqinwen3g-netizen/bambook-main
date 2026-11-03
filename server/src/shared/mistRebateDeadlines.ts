/**
 * fin32 退税申报期限与单证缺失清单（只读，不存储）。
 * 期限按外贸企业通行规定：货物报关出口之日（本系统取出运实际离港日）次年 4 月 30 日前完成退税申报；
 * 剩 60 天内为临近，过期仍可列出供财务处理（逾期可按视同内销征税，另行判断）。
 * 单证：报关单已放行且有报关单号与附件、出运已离港、有可配的增值税专用发票（含原件附件）。已申报的不再列出。
 */
import type { MistState } from './mistWorkspace';
import { rebateCandidateBills, rebateClaimForCustoms, rebateExportDate } from './mistExportRebate';

export const REBATE_DEADLINE_WARN_DAYS = 60;
export type RebateDeadlineRow = { customsId: string; code: string; shipment: string; exportDate: string; deadline: string; daysLeft: number; missing: string[]; state: 'ready' | 'missing' | 'due' | 'overdue' };
export const rebateDeadlineFor = (exportDate: string) => `${Number(exportDate.slice(0, 4)) + 1}-04-30`;
const days = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);

export function rebateDeadlines(root: MistState, today: string): RebateDeadlineRow[] {
  const rows: RebateDeadlineRow[] = [];
  for (const c of root.fulfillment?.customs || []) {
    if (rebateClaimForCustoms(root, c.id)) continue;
    const shipment = root.fulfillment?.shipments.find(s => s.id === c.shipmentId);
    if (!shipment || shipment.state === 'cancelled') continue;
    const exportDate = rebateExportDate(root, c);
    if (!exportDate) continue;
    const missing: string[] = [];
    if (c.status !== 'cleared') missing.push('报关单未放行');
    if (!c.declarationNo?.trim()) missing.push('报关单号');
    if (!c.fileIds?.length) missing.push('报关单附件');
    if (!rebateCandidateBills(root, c).length) missing.push('增值税专用发票');
    const deadline = rebateDeadlineFor(exportDate), daysLeft = days(today, deadline);
    rows.push({ customsId: c.id, code: c.code, shipment: shipment.code, exportDate, deadline, daysLeft, missing, state: daysLeft < 0 ? 'overdue' : daysLeft <= REBATE_DEADLINE_WARN_DAYS ? 'due' : missing.length ? 'missing' : 'ready' });
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft || a.code.localeCompare(b.code));
}
