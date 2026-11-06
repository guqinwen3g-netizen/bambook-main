import React from 'react';
import { Button, CardHeader, Dialog, Field, FormGrid, Pill, Switch, TextInput, useToast } from '../../../../../components/mist';
import { apiService } from '../../../../../services/apiService';
import { uiText } from '../../../../../services/interfaceLanguage';
import { FailureNotice } from '../../runtime/FailureNotice';
import type { PlatformVoiceView } from '../../../../../server/src/ai/platformVoice';

const BASE = '/api/mist/ai/platform-model/voice';
async function request(init?: RequestInit): Promise<PlatformVoiceView> {
  const response = await fetch(BASE, { ...init, credentials: 'include', headers: { ...apiService.getAuthHeaders(), 'Content-Type': 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body?.error?.message || '语音配置未完成，请重试');
  return body;
}
export function PlatformVoicePanel({ sessionKey }: { sessionKey: string }) {
  const [view, setView] = React.useState<PlatformVoiceView | null>(null), [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [removing, setRemoving] = React.useState(false);
  const live = React.useRef(sessionKey); live.current = sessionKey;
  const toast = useToast();
  const read = React.useCallback(async () => {
    const bound = live.current; setError('');
    try { const next = await request(); if (bound === live.current) setView(next); }
    catch (e) { if (bound === live.current) setError(e instanceof Error ? e.message : '语音配置读取失败'); }
  }, []);
  React.useEffect(() => { setView(null); setKey(''); setError(''); setBusy(false); setRemoving(false); void read(); }, [sessionKey, read]);
  const save = async (remove = false) => {
    if (!view || busy) return;
    const bound = live.current; setBusy(true); setError('');
    try {
      const next = await request({ method: 'PUT', body: JSON.stringify({ revision: view.revision, enabled: remove ? false : view.enabled, voice: view.voice, speed: view.speed, loudness: view.loudness, ...(remove ? { clearKey: true } : key ? { apiKey: key } : {}) }) });
      if (bound === live.current) { setView(next); setKey(''); setRemoving(false); toast(uiText(remove ? '已移除语音连接' : '语音配置已保存')); }
    } catch (e) { if (bound === live.current) setError(e instanceof Error ? e.message : '语音配置未保存'); }
    finally { if (bound === live.current) setBusy(false); }
  };
  const valid = view && /^[a-zA-Z0-9_-]{1,100}$/.test(view.voice) && [view.speed, view.loudness].every(value => Number.isInteger(value) && value >= -50 && value <= 100) && (!view.enabled || view.hasKey || key.trim());
  return <section aria-label={uiText('实时语音')}>
    <CardHeader title={uiText('实时语音')} tools={view ? <Pill tone={view.configured ? 'ok' : 'neutral'}>{uiText(view.configured ? '已配置' : '未配置')}</Pill> : undefined} />
    <div className="mist-card-body">
      {error && <FailureNotice title="语音配置未完成" detail={error} retry={() => void read()} />}
      {!view && !error && <p className="mist-note">{uiText('正在读取语音配置…')}</p>}
      {view && <>
        <div className="mist-row"><Switch ariaLabel={uiText('启用实时语音')} checked={view.enabled} disabled={busy} onChange={enabled => setView({ ...view, enabled })} /><span>{uiText('豆包实时语音')}</span></div>
        <FormGrid cols={2}>
          <Field label="API Key" hint={view.hasKey ? uiText('留空保留当前连接') : undefined}><TextInput aria-label={uiText('实时语音 API Key')} type="password" autoComplete="off" value={key} maxLength={1024} disabled={busy} onChange={e => setKey(e.target.value)} /></Field>
          <Field label={uiText('音色 ID')} required><TextInput aria-label={uiText('音色 ID')} value={view.voice} maxLength={100} disabled={busy} onChange={e => setView({ ...view, voice: e.target.value })} /></Field>
          <Field label={uiText('语速')}><TextInput aria-label={uiText('语速')} type="number" min={-50} max={100} value={Number.isNaN(view.speed) ? '' : String(view.speed)} disabled={busy} onChange={e => setView({ ...view, speed: e.target.value === '' ? NaN : Number(e.target.value) })} /></Field>
          <Field label={uiText('音量')}><TextInput aria-label={uiText('音量')} type="number" min={-50} max={100} value={Number.isNaN(view.loudness) ? '' : String(view.loudness)} disabled={busy} onChange={e => setView({ ...view, loudness: e.target.value === '' ? NaN : Number(e.target.value) })} /></Field>
        </FormGrid>
        <div className="mist-row"><Button disabled={busy} onClick={() => void read()}>{uiText('刷新')}</Button>{view.hasKey && <Button disabled={busy} onClick={() => setRemoving(true)}>{uiText('移除连接')}</Button>}<span className="mist-spacer" /><Button disabled={busy || !valid} loading={busy} onClick={() => void save()}>{uiText('保存')}</Button></div>
      </>}
    </div>
    <Dialog open={removing} title={uiText('移除语音连接？')} tone="bad" onClose={() => { if (!busy) setRemoving(false); }} footer={<><Button disabled={busy} onClick={() => setRemoving(false)}>{uiText('取消')}</Button><Button variant="danger" loading={busy} onClick={() => void save(true)}>{uiText('移除')}</Button></>} />
  </section>;
}
