import {businessNow} from '../../runtime/businessClock';
/** 定价参数版本：按板块设置标准成本加成率与佣金率（带版本与生效日），仅管理层可改；定价试算保存时冻结适用版本。 */
import React from 'react';
import { Banner, Button, Card, CardHeader, DataTable, Field, FormGrid, Mono, Select, TextArea, TextInput, useToast, type Column } from '../../../../../components/mist';
import { platformBusinessDate } from '../../../../../server/src/shared/mistPlatform';
import { PRICING_PARAM_FAMILY_LABEL, PRICING_PARAM_MAX, applicablePricingParams, normalizePricingPercent, upcomingPricingParams, type PricingParamFamily, type PricingParamVersion } from '../../../../../server/src/shared/mistPricingParams';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';

const FAMILIES: PricingParamFamily[] = ['garment', 'fabric'];
export function pricingParamsDraftProblem(input: { profitMargin: string; commissionRate: string; effectiveFrom: string; reason: string }, today: string) {
  if (normalizePricingPercent(input.profitMargin, PRICING_PARAM_MAX.profitMargin) === null) return `标准成本加成率须为 0–${PRICING_PARAM_MAX.profitMargin} 之间的数字，最多两位小数`;
  if (normalizePricingPercent(input.commissionRate, PRICING_PARAM_MAX.commissionRate) === null) return `标准佣金率须为 0–${PRICING_PARAM_MAX.commissionRate} 之间的数字，最多两位小数`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) return '请选择生效日';
  if (input.effectiveFrom < today) return '生效日不能早于今天；参数不追溯已保存的定价记录';
  if (!input.reason.trim()) return '请填写调整原因';
  return '';
}
export function PricingParamsPanel() {
  const w = useMistWorkspace(), session = useMistSession(), toast = useToast();
  const rows: PricingParamVersion[] = w.state?.platform.pricingParams || [];
  const today = platformBusinessDate(businessNow());
  const canAdmin = session.hasPermission('pricing:admin');
  const [input, setInput] = React.useState({ family: 'garment' as PricingParamFamily, profitMargin: '', commissionRate: '0', effectiveFrom: today, reason: '' });
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const problem = pricingParamsDraftProblem(input, today);
  const blocked = !canAdmin ? '仅管理层（定价管理权限）可修改标准参数' : busy || w.saving || !!w.pending ? '正在保存，请稍候' : problem;
  const save = async () => {
    if (blocked) return; setBusy(true); setError('');
    try { await w.run({ type: 'platform.pricingParams.set', payload: { family: input.family, profitMargin: input.profitMargin.trim(), commissionRate: input.commissionRate.trim(), effectiveFrom: input.effectiveFrom, reason: input.reason.trim() } }); toast(`已新增${PRICING_PARAM_FAMILY_LABEL[input.family]}标准参数版本；已保存的定价记录不变`); setInput(v => ({ ...v, profitMargin: '', reason: '' })); }
    catch (e) { setError(e instanceof Error ? e.message : '未能保存标准参数'); }
    finally { setBusy(false); }
  };
  const cols: Column<PricingParamVersion>[] = [
    { key: 'family', header: '板块', width: '80px', render: r => PRICING_PARAM_FAMILY_LABEL[r.family] },
    { key: 'version', header: '版本', width: '64px', render: r => <Mono>V{r.version}</Mono> },
    { key: 'markup', header: '成本加成率', width: '100px', align: 'right', render: r => <span className="mist-num">{r.profitMargin}%</span> },
    { key: 'commission', header: '佣金率', width: '90px', align: 'right', render: r => <span className="mist-num">{r.commissionRate}%</span> },
    { key: 'from', header: '生效日', width: '110px', render: r => r.effectiveFrom },
    { key: 'reason', header: '调整原因', hideOnMobile: true, render: r => r.reason },
    { key: 'by', header: '设置人 / 时间', hideOnMobile: true, render: r => `${r.createdBy || '—'} · ${r.createdAt.slice(0, 16).replace('T', ' ')}` },
  ];
  return <div className="mist-col" data-pricing-params>
    <Banner title="标准参数">按板块设定标准成本加成率与佣金率。定价试算保存时按订单类型冻结当天适用的版本；加成率低于标准须写偏离理由。汇率、退税率与采购成本是单笔事实，每次试算按依据填写。</Banner>
    <section className="mist-grid">{FAMILIES.map(f => { const cur = applicablePricingParams(rows, f, today), next = upcomingPricingParams(rows, f, today);
      return <Card key={f} className="mist-col-6"><CardHeader title={`${PRICING_PARAM_FAMILY_LABEL[f]} · 当前适用`} sub={cur ? `V${cur.version}，${cur.effectiveFrom} 起生效` : '尚未设置：试算不做标准比对'} /><div className="mist-card-body"><span className="mist-h2 mist-num" data-params-current={f}>{cur ? `加成 ${cur.profitMargin}% · 佣金 ${cur.commissionRate}%` : '未设置'}</span>{next && <p className="mist-sub">待生效：V{next.version} 加成 {next.profitMargin}% · 佣金 {next.commissionRate}%（{next.effectiveFrom} 起）</p>}</div></Card>; })}</section>
    <Card><CardHeader title="新增参数版本" sub="新增一个版本，不改写旧版本；改动留痕。" /><div className="mist-card-body mist-col">
      {!canAdmin && <Banner tone="warn" title="只读">仅管理层（定价管理权限）可修改标准参数；你可以查看当前参数与版本记录。</Banner>}
      {error && <Banner tone="bad" title="未能保存">{error}</Banner>}
      <FormGrid>
        <Field label="板块" required><Select aria-label="参数板块" value={input.family} disabled={!canAdmin} options={FAMILIES.map(f => ({ value: f, label: PRICING_PARAM_FAMILY_LABEL[f] }))} onChange={e => setInput({ ...input, family: e.target.value as PricingParamFamily })} /></Field>
        <Field label="标准成本加成率（%）" required hint={`0–${PRICING_PARAM_MAX.profitMargin}，最多两位小数`}><TextInput aria-label="标准成本加成率" inputMode="decimal" value={input.profitMargin} disabled={!canAdmin} onChange={e => setInput({ ...input, profitMargin: e.target.value })} /></Field>
        <Field label="标准佣金率（%）" required hint={`0–${PRICING_PARAM_MAX.commissionRate}；无代理填 0`}><TextInput aria-label="标准佣金率" inputMode="decimal" value={input.commissionRate} disabled={!canAdmin} onChange={e => setInput({ ...input, commissionRate: e.target.value })} /></Field>
        <Field label="生效日" required hint="不能早于今天，不追溯"><TextInput aria-label="参数生效日" type="date" value={input.effectiveFrom} disabled={!canAdmin} onChange={e => setInput({ ...input, effectiveFrom: e.target.value })} /></Field>
        <Field label="调整原因" required full><TextArea aria-label="参数调整原因" value={input.reason} disabled={!canAdmin} onChange={e => setInput({ ...input, reason: e.target.value })} /></Field>
      </FormGrid>
      <div className="mist-row"><span className="mist-note" data-params-reason>{blocked || '保存后，生效日起的新定价试算按此版本比对'}</span><span className="mist-spacer" /><Button variant="primary" loading={busy} disabled={!!blocked} title={blocked || undefined} onClick={() => void save()}>保存参数版本</Button></div>
    </div></Card>
    <Card><CardHeader title="版本记录" sub={`${rows.length} 个版本`} /><DataTable ariaLabel="定价参数版本记录" rowKey={r => r.id} rows={[...rows].sort((a, b) => a.family.localeCompare(b.family) || b.version - a.version)} columns={cols} empty="尚未设置标准参数" /></Card>
  </div>;
}
