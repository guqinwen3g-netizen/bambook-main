/** mar53：全部线索总表（活动与展会），按状态、负责人、国家、逾期筛选，点行回到来源活动 / 展会的线索页。 */
import React from 'react';
import { Card, DataTable, Dropdown, EmptyState, Pill, SearchField, Toolbar, type Column } from '../../../../../components/mist';
import { uiText } from '../../../../../services/interfaceLanguage';
import type { MarketLead } from '../../../../../server/src/shared/mistMarket';
import type { MistState } from '../../../../../server/src/shared/mistWorkspace';

const STATUS: Record<MarketLead['status'], string> = { New: '新线索', Contacted: '已联系', Qualified: '已确认需求', Following: '跟进中', Converted: '已转 CRM', Lost: '已流失' };
export function LeadPool({ state, today, onOpen }: { state: MistState; today: string; onOpen: (lead: MarketLead) => void }) {
  const m = state.market, [query, setQuery] = React.useState(''), [status, setStatus] = React.useState('open'), [owner, setOwner] = React.useState('all'), [late, setLate] = React.useState('all');
  const parent = (l: MarketLead) => l.source === 'campaign' ? m.campaigns.find(c => c.id === l.parentId) : m.shows.find(x => x.id === l.parentId);
  const ownerOf = (l: MarketLead) => l.owner || (l.source === 'campaign' ? m.campaigns.find(c => c.id === l.parentId)?.owner : '') || '';
  const isOpen = (l: MarketLead) => l.status !== 'Converted' && l.status !== 'Lost', overdue = (l: MarketLead) => isOpen(l) && !!l.followUpDate && l.followUpDate < today;
  const needle = query.trim().toLowerCase();
  const rows = (m.leads || []).filter(l => (!needle || `${l.name} ${l.company} ${l.email} ${l.demand}`.toLowerCase().includes(needle)) && (status === 'all' || (status === 'open' ? isOpen(l) : l.status === status)) && (owner === 'all' || ownerOf(l) === owner) && (late === 'all' || overdue(l)))
    .sort((a, b) => (a.followUpDate || '9').localeCompare(b.followUpDate || '9'));
  const owners = [...new Set((m.leads || []).map(ownerOf).filter(Boolean))];
  const columns: Column<MarketLead>[] = [
    { key: 'n', header: '联系人 / 公司', width: 'minmax(180px,1.6fr)', render: l => <span className="mist-col" style={{ gap: 2 }}><b>{l.name}</b><small className="mist-muted">{l.company}</small></span>, sortValue: l => l.company },
    { key: 'src', header: '来源', width: 'minmax(140px,1fr)', render: l => `${l.source === 'campaign' ? '活动' : '展会'} · ${parent(l)?.name || '—'}` },
    { key: 'o', header: '负责人', width: '100px', render: l => ownerOf(l) || '—', sortValue: ownerOf },
    { key: 'f', header: '下次跟进', width: '120px', render: l => l.followUpDate ? <span className={overdue(l) ? 'mist-tone-warn' : undefined}>{l.followUpDate}</span> : '—', sortValue: l => l.followUpDate },
    { key: 'v', header: '预计金额', width: '120px', align: 'right', render: l => `${l.currency} ${l.estimatedValue}` },
    { key: 's', header: '状态', width: '96px', render: l => <Pill tone={l.status === 'Converted' ? 'ok' : l.status === 'Lost' ? 'neutral' : 'accent'}>{uiText(STATUS[l.status])}</Pill> },
  ];
  return <>
    <Toolbar>
      <SearchField value={query} onChange={setQuery} placeholder={uiText('搜索联系人、公司、邮箱或需求')} />
      <Dropdown label={uiText('状态')} value={status} onChange={setStatus} options={[{ value: 'open', label: '进行中' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label })), { value: 'all', label: '全部' }]} />
      <Dropdown label={uiText('负责人')} value={owner} onChange={setOwner} options={[{ value: 'all', label: '全部' }, ...owners.map(o => ({ value: o, label: o }))]} />
      <Dropdown label={uiText('跟进')} value={late} onChange={setLate} options={[{ value: 'all', label: '全部' }, { value: 'overdue', label: '已逾期' }]} />
    </Toolbar>
    <Card><DataTable ariaLabel={uiText('全部线索')} rows={rows} rowKey={l => l.id} columns={columns} onRowClick={onOpen} empty={<EmptyState title={uiText('没有符合条件的线索')} />} /></Card>
  </>;
}
