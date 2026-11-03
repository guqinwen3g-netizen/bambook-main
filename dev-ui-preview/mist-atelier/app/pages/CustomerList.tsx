/** mar17：客户列表（按国家、等级、客户经理、最近下单筛选排序，可导出）。点行进入原客户详情。 */
import React from 'react';
import { Download, Target } from 'lucide-react';
import { Button, Card, DataTable, Dropdown, EmptyState, MistPage, Mono, ObjectCell, PageHeader, Pill, SearchField, StatCard, StatGrid, Tabs, Toolbar, type Column } from '../../../../components/mist';
import { CRM_STAGE_LABEL, type CrmOpportunity, type CrmStage } from '../../../../server/src/shared/mistCrm';
import { uiText } from '../../../../services/interfaceLanguage';
import type { MistCustomer, MistState } from '../../../../server/src/shared/mistWorkspace';
import { downloadModuleCsv } from './modules/ModuleWorkbench';
import { platformBusinessDate } from '../../../../server/src/shared/mistPlatform';

type Row = MistCustomer & { lastOrder: string; openOrders: number; archived: boolean };
export function customerRows(state: MistState): Row[] {
  const archived = new Set((state.market?.relations || []).filter(r => r.status === 'archived' && r.customerId).map(r => r.customerId));
  return state.customers.map(c => {
    const orders = state.orders.filter(o => o.customerId === c.id);
    return { ...c, lastOrder: orders.map(o => platformBusinessDate(o.createdAt)).sort().at(-1) || '', openOrders: orders.filter(o => !['已作废', '已取消', '已出运'].includes(o.state)).length, archived: archived.has(c.id) };
  });
}

/** mar22：全公司商机漏斗，按阶段、负责人、预计成交月看；金额按币种分开，不合计。 */
function OpportunityBoard({ state, onOpen }: { state: MistState; onOpen: (customerId: string) => void }) {
  const [owner, setOwner] = React.useState('all'), [month, setMonth] = React.useState('all'), [stage, setStage] = React.useState<'open' | CrmStage>('open');
  const all = state.crm?.opportunities || [], name = (id: string) => state.customers.find(c => c.id === id)?.name || '—';
  const rows = all.filter(o => (owner === 'all' || o.ownerId === owner) && (month === 'all' || o.expectedDate.slice(0, 7) === month) && (stage === 'open' ? !['won', 'lost'].includes(o.stage) : o.stage === stage));
  const funnel = (['intent', 'sampling', 'quoting', 'won', 'lost'] as CrmStage[]).map(st => { const list = all.filter(o => o.stage === st && (owner === 'all' || o.ownerId === owner)); const sums = [...list.reduce((m, o) => m.set(o.currency, (m.get(o.currency) || 0) + Number(o.amount)), new Map<string, number>())].map(([c, n]) => `${n.toLocaleString()} ${c}`).join(' / '); return { st, count: list.length, sums }; });
  const owners = [...new Map(all.map(o => [o.ownerId, o.owner])).entries()], months = [...new Set(all.map(o => o.expectedDate.slice(0, 7)))].sort();
  const columns: Column<CrmOpportunity>[] = [
    { key: 't', header: '商机', width: 'minmax(180px,2fr)', render: o => <ObjectCell name={o.title} meta={name(o.customerId)} />, sortValue: o => o.title },
    { key: 's', header: '阶段', width: '90px', render: o => <Pill>{CRM_STAGE_LABEL[o.stage]}</Pill>, sortValue: o => o.stage },
    { key: 'a', header: '预计金额', width: '140px', align: 'right', render: o => `${Number(o.amount).toLocaleString()} ${o.currency}`, sortValue: o => Number(o.amount) },
    { key: 'd', header: '预计成交', width: '110px', render: o => o.expectedDate, sortValue: o => o.expectedDate },
    { key: 'o', header: '负责人', width: '100px', render: o => o.owner, sortValue: o => o.owner },
  ];
  return <>
    <StatGrid>{funnel.map(f => <StatCard key={f.st} icon={Target} label={uiText(CRM_STAGE_LABEL[f.st])} value={String(f.count)} foot={f.sums || undefined} onClick={() => setStage(f.st)} />)}</StatGrid>
    <Toolbar>
      <Dropdown label={uiText('阶段')} value={stage} onChange={v => setStage(v as 'open' | CrmStage)} options={[{ value: 'open', label: '进行中' }, ...(['intent', 'sampling', 'quoting', 'won', 'lost'] as CrmStage[]).map(v => ({ value: v, label: CRM_STAGE_LABEL[v] }))]} />
      <Dropdown label={uiText('负责人')} value={owner} onChange={setOwner} options={[{ value: 'all', label: '全部' }, ...owners.map(([id, n]) => ({ value: id, label: n }))]} />
      <Dropdown label={uiText('预计成交月')} value={month} onChange={setMonth} options={[{ value: 'all', label: '全部' }, ...months.map(m => ({ value: m, label: m }))]} />
    </Toolbar>
    <Card><DataTable ariaLabel={uiText('商机总览')} rows={rows} rowKey={o => o.id} columns={columns} onRowClick={o => onOpen(o.customerId)} empty={<EmptyState title={uiText('没有符合条件的商机')} />} /></Card>
  </>;
}

export function CustomerList({ state, actions, onOpen }: { state: MistState; actions: React.ReactNode; onOpen: (id: string) => void }) {
  const [view, setView] = React.useState<'customers' | 'opportunities'>('customers');
  const [query, setQuery] = React.useState(''), [country, setCountry] = React.useState('all'), [grade, setGrade] = React.useState('all'), [owner, setOwner] = React.useState('all'), [status, setStatus] = React.useState('active');
  const all = customerRows(state), needle = query.trim().toLowerCase();
  const rows = all.filter(c => (!needle || `${c.code} ${c.name} ${c.city} ${c.industry} ${c.categories}`.toLowerCase().includes(needle)) && (country === 'all' || c.country === country) && (grade === 'all' || c.grade === grade) && (owner === 'all' || c.ownerId === owner) && (status === 'all' || (status === 'archived') === c.archived))
    .sort((a, b) => b.lastOrder.localeCompare(a.lastOrder) || a.name.localeCompare(b.name, 'zh-CN'));
  const opts = (values: string[]) => [{ value: 'all', label: '全部' }, ...[...new Set(values.filter(Boolean))].sort().map(v => ({ value: v, label: v }))];
  const owners = [...new Map(all.filter(c => c.ownerId).map(c => [c.ownerId, c.owner])).entries()];
  const columns: Column<Row>[] = [
    { key: 'name', header: '客户', width: 'minmax(200px,2fr)', render: c => <ObjectCell name={c.name} meta={<Mono>{c.code}</Mono>} />, sortValue: c => c.name },
    { key: 'country', header: '国家 / 城市', width: '140px', render: c => [c.country, c.city].filter(Boolean).join(' · ') || '—', sortValue: c => c.country },
    { key: 'grade', header: '等级', width: '72px', render: c => c.grade || '—', sortValue: c => c.grade },
    { key: 'owner', header: '客户经理', width: '110px', render: c => c.owner || '—', sortValue: c => c.owner },
    { key: 'open', header: '在手订单', width: '88px', align: 'right', render: c => c.openOrders || '—', sortValue: c => c.openOrders },
    { key: 'last', header: '最近下单', width: '110px', render: c => c.lastOrder || '—', sortValue: c => c.lastOrder },
    { key: 'st', header: '状态', width: '80px', render: c => c.archived ? <Pill>{uiText('已停用')}</Pill> : <Pill tone="ok">{uiText('合作中')}</Pill> },
  ];
  return <MistPage>
    <PageHeader title={uiText('客户管理')} actions={<>{actions}<Button icon={Download} onClick={() => downloadModuleCsv('客户清单.csv', ['编码', '客户', '国家', '城市', '行业', '等级', '客户经理', '币种', '付款条款', '在手订单', '最近下单', '状态'], rows.map(c => [c.code, c.name, c.country, c.city, c.industry, c.grade, c.owner, c.currency, c.terms, c.openOrders, c.lastOrder, c.archived ? '已停用' : '合作中']))}>{uiText('导出')}</Button></>} />
    <Tabs<'customers' | 'opportunities'> value={view} onChange={setView} options={[{ value: 'customers', label: '客户' }, { value: 'opportunities', label: '商机总览', count: (state.crm?.opportunities || []).filter(o => !['won', 'lost'].includes(o.stage)).length || undefined }]} />
    {view === 'opportunities' ? <OpportunityBoard state={state} onOpen={onOpen} /> : <>
    <Toolbar>
      <SearchField value={query} onChange={setQuery} placeholder={uiText('搜索客户、编码、城市、行业或品类')} />
      <Dropdown label={uiText('国家')} value={country} onChange={setCountry} options={opts(all.map(c => c.country))} />
      <Dropdown label={uiText('等级')} value={grade} onChange={setGrade} options={opts(all.map(c => c.grade))} />
      <Dropdown label={uiText('客户经理')} value={owner} onChange={setOwner} options={[{ value: 'all', label: '全部' }, ...owners.map(([id, name]) => ({ value: id, label: name }))]} />
      <Dropdown label={uiText('状态')} value={status} onChange={setStatus} options={[{ value: 'active', label: '合作中' }, { value: 'archived', label: '已停用' }, { value: 'all', label: '全部' }]} />
    </Toolbar>
    <Card><DataTable ariaLabel={uiText('客户清单')} rows={rows} rowKey={c => c.id} columns={columns} onRowClick={c => onOpen(c.id)} empty={<EmptyState title={uiText('没有符合条件的客户')} />} /></Card>
    </>}
  </MistPage>;
}
