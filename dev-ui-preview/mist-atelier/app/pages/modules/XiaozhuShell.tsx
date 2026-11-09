/** 小竹页的输入区、通话条和空对话：输入区始终在对话下方居中，空对话时和问候一起居中。 */
import React from 'react';
import { ArrowUp, Mic, MicOff, Paperclip, PhoneOff, Square, X, CalendarClock, Landmark, Mail, ListTodo, Sparkles } from 'lucide-react';
import { AIBadge, AssistantEyes, Icon, IconButton } from '../../../../../components/mist';
import { uiText } from '../../../../../services/interfaceLanguage';
import type { usePersonalAgentVoice } from '../../runtime/personalAgentVoice';

type Voice = ReturnType<typeof usePersonalAgentVoice>;
export const voiceInCall = (voice: Voice) => voice.state === 'connecting' || voice.state === 'listening' || voice.state === 'speaking';

export function XiaozhuComposer({ value, onChange, onSend, ready, busy, onStop, sources, onRemoveSource, onAttach, voice, voiceAvailable, field, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; onSend: () => void; ready: boolean; busy: boolean; onStop?: () => void;
  sources: Array<{ id: string; label: string }>; onRemoveSource: (s: { id: string; label: string }) => void; onAttach: () => void;
  voice: Voice; voiceAvailable: boolean; field: React.RefObject<HTMLTextAreaElement | null>; placeholder: string; disabled?: boolean;
}) {
  const inCall = voiceInCall(voice);
  if (inCall) return <div className="mist-xz-composer mist-xz-call" data-state={voice.state}>
    <div className="mist-xz-call-row"><span className="mist-xz-pulse" aria-hidden /><b>{uiText(voice.state === 'connecting' ? '正在接通' : voice.muted ? '已静音' : voice.state === 'speaking' ? '小竹正在说' : '正在听')}</b><span className="mist-spacer" />
      <IconButton icon={voice.muted ? MicOff : Mic} label={uiText(voice.muted ? '取消静音' : '静音')} disabled={voice.state === 'connecting'} onClick={voice.toggleMute} />
      <IconButton icon={Square} label={uiText('停止播放')} disabled={voice.state !== 'speaking'} onClick={voice.interrupt} />
      <button type="button" className="mist-xz-hangup" aria-label={uiText('结束通话')} onClick={voice.end}><Icon icon={PhoneOff} size="sm" /></button></div>
    {(voice.transcript || voice.reply) && <div className="mist-xz-call-text">{voice.transcript && <p aria-label={uiText('我的语音')}>{voice.transcript}</p>}{voice.reply && <p aria-live="polite">{voice.reply}</p>}</div>}
  </div>;
  return <div className="mist-xz-composer">
    {sources.length > 0 && <div className="mist-xz-sources">{sources.map(s => <span key={s.id} className="mist-xz-source"><span>{uiText(s.label)}</span><IconButton size="sm" icon={X} label={uiText('移除 ' + s.label)} disabled={busy} onClick={() => onRemoveSource(s)} /></span>)}</div>}
    <textarea ref={field as React.RefObject<HTMLTextAreaElement>} rows={1} aria-label={uiText('向助手提问')} placeholder={placeholder} value={value} maxLength={4000} disabled={busy || disabled} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); } }} />
    <div className="mist-xz-tools">
      <IconButton icon={Paperclip} label={uiText('引用业务记录')} disabled={busy || disabled} onClick={onAttach} />
      {voiceAvailable && <IconButton icon={Mic} label={uiText('语音通话')} disabled={busy} onClick={() => void voice.start()} />}
      <span className="mist-spacer" />
      {busy && onStop ? <IconButton icon={Square} label={uiText('停止生成')} onClick={onStop} /> : <button type="button" className="mist-send" aria-label={uiText('发送')} disabled={!ready} onClick={onSend}><Icon icon={ArrowUp} size="sm" /></button>}
    </div>
  </div>;
}

const TILE_ICON = [CalendarClock, Landmark, Mail, ListTodo];
export function greeting(name: string | undefined, now = new Date()) {
  const h = now.getHours(), part = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  return name ? `${part}，${name}` : part;
}
export function XiaozhuEmpty({ name, suggestions, onPick, children }: { name?: string; suggestions: string[]; onPick: (text: string) => void; children: React.ReactNode }) {
  return <div className="mist-xz-empty">
    <AIBadge icon={AssistantEyes} size="lg" />
    <h2>{uiText(greeting(name))}</h2>
    <div className="mist-xz-empty-composer">{children}</div>
    <div className="mist-xz-tiles">{suggestions.slice(0, 4).map((s, i) => <button key={s} type="button" className="mist-xz-tile" onClick={() => onPick(s)}><Icon icon={TILE_ICON[i] ?? Sparkles} size="sm" /><span>{uiText(s)}</span></button>)}</div>
  </div>;
}
