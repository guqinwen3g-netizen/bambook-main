/**
 * 平台 AI 调用链（平台设置 › 平台 AI 模型）：对所有公司生效，仅平台管理员可改。
 * ChatGPT 套餐与 API 服务按同一顺序调用，前一项失败自动换下一项；服务器环境配置始终在最后兜底。
 * API Key 只写不读：服务器只回传尾 4 位提示。ChatGPT 套餐沿用设备码连接面板。
 */
import React from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { Banner, Button, CardHeader, Dialog, Drawer, Field, FormGrid, IconButton, Pill, Select, Switch, TextInput, useToast } from '../../../../../components/mist';
import { apiService } from '../../../../../services/apiService';
import { AiSubscriptionPanel, type ChatgptSubscriptionStatus } from './AiSubscriptionPanel';

type ApiProvider = { id: string; name: string; baseUrl: string; model: string; enabled: boolean; keyHint: string };
type ChainView = { chatgpt: ChatgptSubscriptionStatus | null; api: { providers: ApiProvider[]; order: string[] }; env: Array<{ id: string; host: string; model: string }>; supportsApi: boolean };
type Draft = { id?: string; keyHint?: string; name: string; baseUrl: string; model: string; apiKey: string };
type TestResult = 'running' | { ok: boolean; text: string };

const SLOT = 'chatgpt-subscription';
const BASE = '/api/mist/ai/platform-model';
const MAX = 10;
const PRESETS = [
  { value: '', label: '自定义' },
  { value: 'https://api.openai.com/v1', label: 'OpenAI' },
  { value: 'https://ark.cn-beijing.volces.com/api/v3', label: '火山方舟' },
  { value: 'https://api.deepseek.com/v1', label: 'DeepSeek' },
  { value: 'https://open.bigmodel.cn/api/paas/v4', label: '智谱 GLM' },
  { value: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: '通义千问' },
];
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const message = (e: unknown) => e instanceof Error ? e.message : '请求未完成，请重试';

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, headers: { ...apiService.getAuthHeaders(), ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, credentials: 'include' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? '平台 AI 配置请求未完成');
  if (!body) throw new Error('平台 AI 配置没有返回可核对的结果');
  return body;
}

export function PlatformAiProvidersPanel({ sessionKey }: { sessionKey: string }) {
  const [view, setView] = React.useState<ChainView | null>(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null), [removing, setRemoving] = React.useState<ApiProvider | null>(null), [tests, setTests] = React.useState<Record<string, TestResult>>({});
  const live = React.useRef(sessionKey); live.current = sessionKey;
  const toast = useToast();
  // 旧版服务端只返回 ChatGPT 状态：仍显示套餐连接，API 服务入口提示待服务端更新。
  const apply = (body: any) => setView({ chatgpt: body?.chatgpt ?? null, api: body?.api ?? { providers: [], order: [SLOT] }, env: Array.isArray(body?.env) ? body.env : [], supportsApi: Boolean(body?.api) });
  const read = React.useCallback(async () => {
    const bound = live.current;
    try { const body = await call(BASE); if (bound === live.current) { apply(body); setError(''); } }
    catch (e) { if (bound === live.current) setError(message(e)); }
  }, []);
  React.useEffect(() => { setView(null); setDraft(null); setRemoving(null); setTests({}); setError(''); void read(); }, [sessionKey, read]);

  const mutate = async (path: string, init: RequestInit) => {
    const bound = live.current; setBusy(true); setError('');
    try { const body = await call(path, init); if (bound === live.current) apply(body); return bound === live.current; }
    catch (e) { if (bound === live.current) setError(message(e)); return false; }
    finally { if (bound === live.current) setBusy(false); }
  };
  const move = (id: string, delta: number) => {
    if (!view) return;
    const order = [...view.api.order], i = order.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    void mutate(BASE + '/order', { method: 'PUT', body: JSON.stringify({ order }) });
  };
  const save = async () => {
    if (!draft) return;
    const fields = { name: draft.name, baseUrl: draft.baseUrl, model: draft.model };
    const editing = Boolean(draft.id);
    const done = await mutate(editing ? `${BASE}/providers/${draft.id}` : `${BASE}/providers`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(editing ? { ...fields, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}) } : { ...fields, apiKey: draft.apiKey }) });
    if (done) { setDraft(null); toast(editing ? 'API 服务已更新' : 'API 服务已添加'); }
  };
  const test = async (id: string) => {
    const bound = live.current;
    setTests(t => ({ ...t, [id]: 'running' }));
    try {
      const r = await call(`${BASE}/providers/${id}/test`, { method: 'POST', body: '{}' });
      if (bound === live.current) setTests(t => ({ ...t, [id]: r.ok ? { ok: true, text: `连接正常 · ${r.latencyMs} ms` } : { ok: false, text: String(r.error || '连接失败') } }));
    } catch (e) { if (bound === live.current) setTests(t => ({ ...t, [id]: { ok: false, text: message(e) } })); }
  };
  const remove = async () => {
    if (!removing) return;
    if (await mutate(`${BASE}/providers/${removing.id}`, { method: 'DELETE' })) { setRemoving(null); toast('API 服务已删除'); }
  };

  if (!view) return <div className="mist-card-body">{error
    ? <Banner tone="warn" title="平台 AI 配置暂不可读" actions={<Button size="sm" onClick={() => void read()}>重新读取</Button>}>{error}</Banner>
    : <p className="mist-note">正在读取平台 AI 配置…</p>}</div>;

  const providers = new Map(view.api.providers.map(p => [p.id, p]));
  const order = view.api.order;
  const valid = !!draft && !!draft.name.trim() && !!draft.baseUrl.trim() && !!draft.model.trim() && (!!draft.id || !!draft.apiKey.trim());
  const preset = draft ? PRESETS.find(p => p.value && p.value === draft.baseUrl)?.value ?? '' : '';
  return <>
    <CardHeader title="平台 AI 模型" sub="所有公司的平台 AI（小竹问答、报价审阅、自动汇总、财务对账）按下列顺序调用，前一项不可用时自动换下一项。" />
    <div className="mist-card-body">
      {error && !draft && !removing && <Banner tone="bad" title="平台 AI 配置未保存">{error}</Banner>}
      <ol className="mist-ai-chain" aria-label="平台 AI 调用顺序">
        {order.map((id, i) => {
          const arrows = <><IconButton size="sm" icon={ArrowUp} label="上移" disabled={busy || i === 0} onClick={() => move(id, -1)} /><IconButton size="sm" icon={ArrowDown} label="下移" disabled={busy || i === order.length - 1} onClick={() => move(id, 1)} /></>;
          if (id === SLOT) {
            const c = view.chatgpt;
            return <li key={id} className="mist-ai-chain-row">
              <span className="mist-ai-chain-n">{i + 1}</span>
              <div className="mist-ai-chain-t"><b>ChatGPT 套餐</b><span>{c?.connected ? [c.email, c.model].filter(Boolean).join(' · ') : c?.enabled === false ? '服务器未启用订阅连接，调用时跳过' : '尚未连接，调用时跳过；可在下方连接'}</span></div>
              <Pill tone={c?.connected ? 'ok' : 'neutral'}>{c?.connected ? '已连接' : '未连接'}</Pill>
              <div className="mist-ai-chain-acts">{arrows}</div>
            </li>;
          }
          const p = providers.get(id);
          if (!p) return null;
          const t = tests[id];
          return <li key={id} className="mist-ai-chain-row" data-off={!p.enabled || undefined}>
            <span className="mist-ai-chain-n">{i + 1}</span>
            <div className="mist-ai-chain-t"><b>{p.name}</b><span>{hostOf(p.baseUrl)} · {p.model} · Key {p.keyHint}</span>{t && t !== 'running' && <span className="mist-ai-chain-test" data-ok={t.ok || undefined} role="status">{t.text}</span>}</div>
            <Switch ariaLabel={(p.enabled ? '停用 ' : '启用 ') + p.name} checked={p.enabled} disabled={busy} onChange={enabled => void mutate(`${BASE}/providers/${p.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })} />
            <div className="mist-ai-chain-acts">
              <Button size="sm" variant="quiet" icon={Zap} loading={t === 'running'} disabled={busy || t === 'running'} onClick={() => void test(p.id)}>测试</Button>
              <IconButton size="sm" icon={Pencil} label={'编辑 ' + p.name} disabled={busy} onClick={() => { setError(''); setDraft({ id: p.id, keyHint: p.keyHint, name: p.name, baseUrl: p.baseUrl, model: p.model, apiKey: '' }); }} />
              <IconButton size="sm" icon={Trash2} label={'删除 ' + p.name} disabled={busy} onClick={() => { setError(''); setRemoving(p); }} />
              {arrows}
            </div>
          </li>;
        })}
        {view.env.map(e => <li key={e.id} className="mist-ai-chain-row" data-env>
          <span className="mist-ai-chain-n">兜底</span>
          <div className="mist-ai-chain-t"><b>服务器环境配置</b><span>{e.host} · {e.model} · 由服务器部署配置，此处只读</span></div>
        </li>)}
      </ol>
      {view.supportsApi ? <div className="mist-row">
        <Button variant="ai" icon={Plus} disabled={busy || view.api.providers.length >= MAX} onClick={() => { setError(''); setDraft({ name: '', baseUrl: '', model: '', apiKey: '' }); }}>添加 API 服务</Button>
        <span className="mist-note">支持 OpenAI 兼容接口：OpenAI、火山方舟、DeepSeek、智谱、通义千问或自建服务。</span>
      </div> : <Banner tone="neutral" title="当前服务器版本尚不支持 API 服务">服务器更新后即可在此添加 OpenAI 兼容的 API 服务；ChatGPT 套餐可先在下方连接。</Banner>}
    </div>
    <AiSubscriptionPanel mode="platform" bare sessionKey={sessionKey} onChange={() => void read()} />
    <Drawer open={!!draft} onClose={() => { if (!busy) setDraft(null); }} title={draft?.id ? '编辑 API 服务' : '添加 API 服务'} sub="Key 只保存在服务器，保存后不再显示。"
      footer={<><Button disabled={busy} onClick={() => setDraft(null)}>取消</Button><Button variant="primary" loading={busy} disabled={!valid || busy} onClick={() => void save()}>保存</Button></>}>
      {draft && <>
        {error && <Banner tone="bad" title="未能保存">{error}</Banner>}
        <FormGrid cols={1}>
          {!draft.id && <Field label="服务商"><Select aria-label="服务商" value={preset} options={PRESETS} onChange={e => { const value = e.target.value, label = PRESETS.find(p => p.value === value)?.label ?? ''; setDraft(d => d && ({ ...d, baseUrl: value || d.baseUrl, name: d.name || (value ? label : '') })); }} /></Field>}
          <Field label="名称"><TextInput aria-label="名称" value={draft.name} maxLength={60} disabled={busy} onChange={e => setDraft(d => d && ({ ...d, name: e.target.value }))} /></Field>
          <Field label="接口地址" hint="OpenAI 兼容接口的 Base URL，例如 https://api.openai.com/v1"><TextInput aria-label="接口地址" value={draft.baseUrl} maxLength={300} disabled={busy} onChange={e => setDraft(d => d && ({ ...d, baseUrl: e.target.value }))} /></Field>
          <Field label="模型标识" hint="填写服务商的模型 ID，例如 deepseek-chat、doubao-1.5-pro-32k"><TextInput aria-label="模型标识" value={draft.model} maxLength={120} disabled={busy} onChange={e => setDraft(d => d && ({ ...d, model: e.target.value }))} /></Field>
          <Field label="API Key" hint={draft.id ? `留空则保留当前 Key（${draft.keyHint}）` : '仅保存在服务器私有目录，任何页面都不会再显示'}><TextInput aria-label="API Key" type="password" autoComplete="off" value={draft.apiKey} maxLength={512} disabled={busy} onChange={e => setDraft(d => d && ({ ...d, apiKey: e.target.value }))} /></Field>
        </FormGrid>
      </>}
    </Drawer>
    <Dialog open={!!removing} tone="bad" onClose={() => { if (!busy) setRemoving(null); }} title={removing ? `删除「${removing.name}」？` : ''} description="删除后平台 AI 不再调用此服务，服务器上保存的 Key 一并删除。"
      footer={<><Button disabled={busy} onClick={() => setRemoving(null)}>取消</Button><Button variant="danger" loading={busy} onClick={() => void remove()}>删除</Button></>}>
      {error && removing && <Banner tone="bad" title="未能删除">{error}</Banner>}
    </Dialog>
  </>;
}
