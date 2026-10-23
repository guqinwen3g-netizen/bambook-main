import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
/** 统一搜索结果页：与 ⌘K 共用记录源，只搜本公司，且只列当前账号能进入的页面中的记录。 */
import React from 'react';
import { Search } from 'lucide-react';
import { Banner, Button, Card, EmptyState, MistPage, PageHeader, Tabs, TextInput, Toolbar } from '../../../../components/mist';
import { useNav } from '../nav';
import { useMistSession } from '../runtime/auth';
import { useMistWorkspace } from '../runtime/workspace';
import { rankSearchRecords, workspaceSearchRecords, type MistSearchHit } from '../runtime/search';
import type { View } from '../../../../types';

const PREVIEW = 8;
export function SearchPage() {
  const { route, go } = useNav(), session = useMistSession(), workspace = useMistWorkspace();
  const query = route.section ?? '';
  const [draft, setDraft] = React.useState(query), [group, setGroup] = React.useState('all'), [expanded, setExpanded] = React.useState<string | null>(null);
  React.useEffect(() => { setDraft(query); setGroup('all'); setExpanded(null); }, [query]);
  const state = workspace.state;
  const hits = React.useMemo(() => state ? rankSearchRecords(workspaceSearchRecords(state, view => session.canAccessView(view as View)), query) : [], [state, query, session, interfaceLocale()]);
  const groups = [...new Set(hits.map(h => h.group))];
  const shown = group === 'all' ? groups : groups.filter(g => g === group);
  const submit = (e?: React.FormEvent) => { e?.preventDefault(); go('search', undefined, { section: draft.trim() || undefined }); };
  const open = (hit: MistSearchHit) => go(hit.view, hit.id, hit.target);
  return <MistPage>
    <PageHeader title={uiText("搜索结果")} description={uiText(workspace.workspace ? `在「${workspace.workspace.name}」中搜索；只列出你有权进入的页面中的记录。` : '只搜索本公司。')} />
    <form onSubmit={submit}><Toolbar right={<Button type="submit" variant="primary" icon={Search}>{uiText("搜索")}</Button>}>
      <TextInput aria-label={uiText("搜索关键词")} icon={Search} placeholder={uiText("名称、编号、客户、供应商… 多个词用空格分开")} value={draft} onChange={e => setDraft(e.target.value)} />
    </Toolbar></form>
    {!state ? <Banner tone="neutral" title={uiText("还没有打开公司")}>{uiText("进入一个公司后再搜索。")}</Banner>
      : !query.trim() ? <EmptyState icon={Search} title={uiText("输入关键词开始搜索")} description={uiText("也可以随时按 ⌘K 快速搜索。")} />
      : !hits.length ? <EmptyState icon={Search} title={ui`没有找到「${query}」`} description={uiText("换个关键词或编号；看不到的页面中的记录不会出现在这里。")} />
      : <>
        <Tabs value={group} onChange={setGroup} options={[{ value: 'all', label: '全部', count: hits.length }, ...groups.map(g => ({ value: g, label: g, count: hits.filter(h => h.group === g).length }))]} />
        {shown.map(g => {
          const rows = hits.filter(h => h.group === g), full = group !== 'all' || expanded === g, visible = full ? rows : rows.slice(0, PREVIEW);
          return <section key={g} className="mist-section"><Card>
            <div className="mist-card-h"><b>{g}</b><span className="mist-note">{rows.length}{uiText(" 条")}</span></div>
            <div role="list" aria-label={uiText(g)}>{visible.map(hit => <button key={hit.view + hit.id} type="button" role="listitem" className="mist-palette-it" style={{ width: '100%' }} onClick={() => open(hit)}>
              <span>{uiText(hit.label)}</span>{hit.hint && <small>{uiText(hit.hint)}</small>}
            </button>)}</div>
            {!full && rows.length > PREVIEW && <div className="mist-card-body"><Button variant="quiet" size="sm" onClick={() => setExpanded(g)}>{uiText("显示全部 ")}{rows.length}{uiText(" 条")}</Button></div>}
          </Card></section>;
        })}
      </>}
  </MistPage>;
}
