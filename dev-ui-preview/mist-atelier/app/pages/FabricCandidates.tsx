/** ord10/11: candidate fabrics on a sourcing answer, one row per supplier offer, with jumps to the supplier, the fabric record and an inquiry to the chosen supplier. */
import React from 'react';
import { Button, DataTable, Pill, Select, TextInput, TextLink } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import type { MistFabricCandidate, MistState } from '../../../../server/src/shared/mistWorkspace';

export type FabricCandidateDraft = Omit<MistFabricCandidate, 'id' | 'supplier'>;
export const blankFabricCandidate = (): FabricCandidateDraft => ({ supplierId: '', article: '', price: '', currency: 'CNY', moq: '', leadDays: '', note: '' });
type Go = (view: string, id?: string, target?: Record<string, string | undefined>) => void;

export function FabricCandidates({ state, rows, saved, chosen, confirmedId, readOnly, onChange, onChoose, go }: {
  state: MistState | null | undefined; rows: FabricCandidateDraft[]; saved: MistFabricCandidate[]; chosen: string; confirmedId?: string; readOnly: boolean;
  onChange: (rows: FabricCandidateDraft[]) => void; onChoose: (id: string) => void; go: Go;
}) {
  const suppliers = (state?.market.suppliers || []).map(s => ({ value: s.id, label: s.name }));
  const products = (state?.market.products || []).filter(p => p.category === 'fabric' && p.status === 'active').map(p => ({ value: p.id, label: `${p.sku} · ${p.name}` }));
  const patch = (i: number, value: Partial<FabricCandidateDraft>) => onChange(rows.map((r, n) => n === i ? { ...r, ...value } : r));
  if (readOnly) {
    if (!saved.length) return null;
    return <DataTable ariaLabel={uiText('候选面料')} rows={saved} rowKey={r => r.id} density="compact" columns={[
      { key: 's', header: '供应商', render: r => <TextLink onClick={() => go('suppliers', r.supplierId)}>{r.supplier}</TextLink> },
      { key: 'a', header: '品号', render: r => r.productId ? <TextLink onClick={() => go('products', r.productId)}>{r.article}</TextLink> : r.article },
      { key: 'p', header: '价格', align: 'right', render: r => r.price ? `${r.price} ${r.currency}` : '—' },
      { key: 'm', header: 'MOQ', render: r => r.moq || '—' },
      { key: 'l', header: '交期', render: r => r.leadDays || '—' },
      { key: 'c', header: '', render: r => r.id === confirmedId ? <Pill tone="ok">{uiText('已采用')}</Pill> : null },
      // 采购须挂订单条目，这里先发向该供应商的询价（索样 / 报价），中选后从订单发起采购。
      { key: 'go', header: '', render: r => r.id === confirmedId ? <Button size="sm" onClick={() => go('procurement', undefined, { section: 'rfq:' + r.supplierId })}>{uiText('向供应商询价')}</Button> : null },
    ]} />;
  }
  return <div className="mist-col">
    <div className="mist-row"><b>{uiText('候选面料')}</b><span className="mist-spacer" /><Button size="sm" onClick={() => onChange([...rows, blankFabricCandidate()])}>{uiText('添加候选')}</Button></div>
    {rows.map((r, i) => <div key={i} className="mist-row" style={{ flexWrap: 'wrap', gap: 8 }}>
      <Select aria-label={uiText('候选供应商')} value={r.supplierId} placeholder={uiText('供应商')} options={suppliers} onChange={e => patch(i, { supplierId: e.target.value })} />
      <TextInput aria-label={uiText('品号')} placeholder={uiText('品号')} value={r.article} onChange={e => patch(i, { article: e.target.value })} />
      <Select aria-label={uiText('面料档案')} value={r.productId || ''} options={[{ value: '', label: '不关联档案' }, ...products]} onChange={e => patch(i, { productId: e.target.value || undefined })} />
      <TextInput aria-label={uiText('价格')} placeholder={uiText('价格')} value={r.price} onChange={e => patch(i, { price: e.target.value })} />
      <TextInput aria-label={uiText('币种')} value={r.currency} onChange={e => patch(i, { currency: e.target.value })} />
      <TextInput aria-label={uiText('MOQ')} placeholder="MOQ" value={r.moq} onChange={e => patch(i, { moq: e.target.value })} />
      <TextInput aria-label={uiText('交期')} placeholder={uiText('交期')} value={r.leadDays} onChange={e => patch(i, { leadDays: e.target.value })} />
      <Button size="sm" variant="quiet" onClick={() => onChange(rows.filter((_, n) => n !== i))}>{uiText('删除')}</Button>
    </div>)}
    {saved.length > 0 && <div className="mist-row"><span className="mist-note">{uiText('确认采用')}</span><Select aria-label={uiText('确认采用的候选')} value={chosen} options={saved.map(c => ({ value: c.id, label: `${c.supplier} · ${c.article}${c.price ? ` · ${c.price} ${c.currency}` : ''}` }))} onChange={e => onChoose(e.target.value)} /></div>}
  </div>;
}
