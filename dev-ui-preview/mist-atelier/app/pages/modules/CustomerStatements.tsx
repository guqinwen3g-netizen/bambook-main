import { uiText, ui } from '../../../../../services/interfaceLanguage';
import {businessNow} from '../../runtime/businessClock';
/** 客户对账单：按客户生成截至今天的未结项对账单（服务端渲染归档，SOA 编号只追加），下载 / 打开原件。不记录发送状态。 */
import React from 'react';
import { Download, ExternalLink, FileText } from 'lucide-react';
import { Button, Card, CardHeader, Mono, Pill, Select, useToast } from '../../../../../components/mist';
import type { MistState } from '../../../../../server/src/shared/mistWorkspace';
import { platformBusinessDate } from '../../../../../server/src/shared/mistPlatform';
import { customerHasStatementItems, customerStatementBlocker, readCustomerStatements } from '../../../../../server/src/shared/mistCustomerStatement';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { apiService } from '../../../../../services/apiService';
import { PreviewButton } from '../../runtime/files';

/** 截至今天可出对账单的客户（有未结应收或同名待核销到账）。 */
export function statementCustomers(state: MistState | null, today: string) {
  return state ? state.customers.filter(c => customerHasStatementItems(state, c.id, today)) : [];
}

export function CustomerStatementCard({ customerId }: { customerId?: string }) {
  const w = useMistWorkspace(), session = useMistSession(), toast = useToast(), state = w.state;
  const today = platformBusinessDate(businessNow()), customers = statementCustomers(state, today);
  const [picked, setPicked] = React.useState(customerId || ''), [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (customerId) setPicked(customerId); }, [customerId]);
  const target = customerId || (picked && customers.some(c => c.id === picked) ? picked : customers[0]?.id || '');
  const canWrite = session.hasPermission('invoices:write' as never);
  const blocker = !state ? '公司未加载' : !canWrite ? '生成对账单需要应收写权限（财务）' : !target ? '没有未结应收或待核销到账的客户' : customerStatementBlocker(state, target, today);
  const records = readCustomerStatements(state || {}).filter(r => !customerId || r.customerId === customerId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, 8);
  const nameOf = (id: string) => state?.customers.find(c => c.id === id)?.name || id;
  const fileOf = (id: string) => state?.files.find(f => f.id === id);
  const generate = async () => {
    if (busy || blocker) return; setBusy(true);
    try { await w.run({ type: 'finance.statement.generate', payload: { customerId: target } } as never); toast(`${nameOf(target)} 对账单已生成`); }
    catch (cause) { toast(cause instanceof Error ? cause.message : '对账单尚未生成'); } finally { setBusy(false); }
  };
  const download = (fileId: string) => { const f = fileOf(fileId); if (!f) { toast('对账单文件不可用或无权读取'); return; } void w.downloadFile(f).catch(cause => toast(cause instanceof Error ? cause.message : '对账单下载失败')); };
  /** 打开归档原件（浏览器 PDF 预览中可打印）；不重新生成。 */
  const open = (fileId: string) => {
    const f = fileOf(fileId); if (!f) { toast('对账单文件不可用或无权读取'); return; }
    const win = window.open('', '_blank');
    void (async () => { const response = await fetch(w.fileUrl(f), { headers: apiService.getAuthHeaders(), credentials: 'include' }); if (!response.ok) { win?.close(); throw new Error('对账单文件读取失败'); }
      const url = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: 'application/pdf' })); if (win) win.location.href = url; else window.open(url, '_blank'); window.setTimeout(() => URL.revokeObjectURL(url), 60000); })().catch(cause => toast(cause instanceof Error ? cause.message : '对账单打开失败'));
  };
  return <Card id="mist-customer-statements">
    <CardHeader title={uiText("客户对账单")} sub={ui`截至 ${today} · 按币种列未结应收、待核销到账与账龄，不跨币种折算`} tools={<div className="mist-row" style={{ gap: 8 }}>
      {!customerId && <Select aria-label={uiText("对账客户")} value={target} disabled={busy || !customers.length} onChange={e => setPicked(e.target.value)} options={customers.length ? customers.map(c => ({ value: c.id, label: c.name })) : [{ value: '', label: '暂无可对账客户' }]} />}
      <Button size="sm" icon={FileText} disabled={busy || !!blocker} title={uiText(blocker || undefined)} onClick={() => void generate()}>{uiText("生成对账单")}</Button></div>} />
    {blocker && canWrite && <div style={{ padding: '0 22px 8px' }}><span className="mist-note">{blocker}</span></div>}
    <div role="list" aria-label={uiText("已生成的客户对账单")} style={{ padding: '0 22px 14px' }}>
      {records.length ? records.map(r => <div key={r.id} role="listitem" className="mist-row" data-statement={r.statementNo} style={{ gap: 8, flexWrap: 'wrap', padding: '8px 0' }}>
        <Mono>{r.statementNo}</Mono>
        <span className="mist-col" style={{ gap: 0, minWidth: 0 }}><span>{nameOf(r.customerId)}</span><small className="mist-muted">{uiText("截至 ")}{r.asOf} · {r.generatedBy} · {r.generatedAt.replace('T', ' ').slice(0, 16)}</small></span>
        {r.totals.map(t => <Pill key={t.currency} tone="neutral">{uiText("净欠 ")}{Number(t.net).toLocaleString('en-US', { minimumFractionDigits: 2 })} {t.currency}</Pill>)}
        <span className="mist-spacer" />
        <PreviewButton file={fileOf(r.fileId)} disabled={busy} />
        <Button size="sm" variant="quiet" icon={Download} disabled={busy} onClick={() => download(r.fileId)}>{uiText("下载")}</Button>
        <Button size="sm" variant="quiet" icon={ExternalLink} disabled={busy} onClick={() => open(r.fileId)}>{uiText("打开")}</Button>
      </div>) : <span className="mist-note">{uiText("尚未生成。生成后按当时台账冻结内容并归档原件；台账变动后重新生成新编号，旧份保留。")}</span>}
    </div>
  </Card>;
}
