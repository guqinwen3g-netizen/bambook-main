/** 小竹页的输入区、通话条和空对话：输入区始终在对话下方居中，空对话时和问候一起居中。 */
import React from 'react';
import { ArrowUp, AtSign, AudioLines, Mic, MicOff, Paperclip, PhoneOff, Square, X, CalendarClock, Landmark, Mail, ListTodo, Sparkles } from 'lucide-react';
import { AIBadge, AssistantEyes, Icon, IconButton } from '../../../../../components/mist';
import { uiText } from '../../../../../services/interfaceLanguage';
import { TASK_ATTACHMENT_ACCEPT } from '../../../../../server/src/shared/mistTaskAttachments';
import type { usePersonalAgentVoice } from '../../runtime/personalAgentVoice';
import type { AssistantAttachmentRef } from '../../runtime/assistantConversation';

type Voice = ReturnType<typeof usePersonalAgentVoice>;
export const voiceInCall = (voice: Voice) => voice.state === 'connecting' || voice.state === 'listening' || voice.state === 'speaking';

export function XiaozhuComposer({ value, onChange, onSend, ready, busy, working, onStop, sources, onRemoveSource, onAttach, files, onAddFiles, onRemoveFile, attachmentRefs, onRemoveAttachmentRef, voice, voiceAvailable, field, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; onSend: () => void; ready: boolean; busy: boolean; working?: boolean; onStop?: () => void;
  sources: Array<{ id: string; label: string }>; onRemoveSource: (s: { id: string; label: string }) => void; onAttach: () => void;
  files: File[]; onAddFiles?: (files: File[]) => void; onRemoveFile: (index: number) => void;
  attachmentRefs: AssistantAttachmentRef[]; onRemoveAttachmentRef: (fileId: string) => void;
  voice: Voice; voiceAvailable: boolean; field: React.RefObject<HTMLTextAreaElement | null>; placeholder: string; disabled?: boolean;
}) {
  const inCall = voiceInCall(voice);
  const picker = React.useRef<HTMLInputElement>(null);
  const dragDepth = React.useRef(0);
  const [dragging, setDragging] = React.useState(false);
  const acceptsFiles = !!onAddFiles && !busy && !disabled;
  const attachments = [
    ...files.map((file, index) => ({ key: 'new:' + index, name: file.name, remove: () => onRemoveFile(index) })),
    ...attachmentRefs.map(file => ({ key: file.fileId, name: file.name, remove: () => onRemoveAttachmentRef(file.fileId) })),
  ];
  const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  if (inCall) return <div className="mist-xz-composer mist-xz-call" data-state={voice.state}>
    <div className="mist-xz-call-row"><span className="mist-xz-pulse" aria-hidden /><b>{uiText(voice.state === 'connecting' ? '正在接通' : voice.muted ? '已静音' : voice.state === 'speaking' ? '小竹正在说' : '正在听')}</b><span className="mist-spacer" />
      <IconButton icon={voice.muted ? MicOff : Mic} label={uiText(voice.muted ? '取消静音' : '静音')} disabled={voice.state === 'connecting'} onClick={voice.toggleMute} />
      <IconButton icon={Square} label={uiText('停止播放')} disabled={voice.state !== 'speaking'} onClick={voice.interrupt} />
      <button type="button" className="mist-xz-hangup" aria-label={uiText('结束通话')} onClick={voice.end}><Icon icon={PhoneOff} size="sm" /></button></div>
    {(voice.transcript || voice.reply) && <div className="mist-xz-call-text">{voice.transcript && <p aria-label={uiText('我的语音')}>{voice.transcript}</p>}{voice.reply && <p aria-live="polite">{voice.reply}</p>}</div>}
  </div>;
  return <div className="mist-xz-composer" data-file-drop={dragging || undefined}
    onDragEnter={event => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth.current++; if (acceptsFiles) setDragging(true); }}
    onDragOver={event => { if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = acceptsFiles ? 'copy' : 'none'; }}
    onDragLeave={event => { if (!hasFiles(event)) return; if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDrop={event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (acceptsFiles) onAddFiles?.(Array.from(event.dataTransfer.files));
    }}>
    {!!attachments.length && <div className="mist-xz-sources" aria-label={uiText('附件')}>{attachments.map(file =>
      <span key={file.key} className="mist-xz-source" data-attachment><Icon icon={Paperclip} size="xs" /><span title={file.name}>{file.name}</span>
        <IconButton size="sm" icon={X} label={uiText('移除附件')+' '+file.name} disabled={busy} onClick={file.remove} />
      </span>)}</div>}
    {sources.length > 0 && <div className="mist-xz-sources">{sources.map(s => <span key={s.id} className="mist-xz-source"><span>{uiText(s.label)}</span><IconButton size="sm" icon={X} label={uiText('移除 ' + s.label)} disabled={busy} onClick={() => onRemoveSource(s)} /></span>)}</div>}
    <textarea ref={field as React.RefObject<HTMLTextAreaElement>} rows={1} aria-label={uiText('向助手提问')} placeholder={placeholder} value={value} maxLength={4000} disabled={busy || disabled} onChange={e => onChange(e.target.value)} onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      const before=value.slice(0,e.currentTarget.selectionStart);
      if (e.key === '@' && (!before || /[\s，。；、：]$/.test(before))) { e.preventDefault(); onAttach(); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ready) onSend(); }
    }} />
    <div className="mist-xz-tools">
      <input ref={picker} type="file" hidden multiple accept={TASK_ATTACHMENT_ACCEPT} onChange={event => {
        if (acceptsFiles) onAddFiles?.(Array.from(event.currentTarget.files ?? []));
        event.currentTarget.value = '';
      }} />
      <IconButton icon={Paperclip} label={uiText('添加附件')} disabled={!acceptsFiles} onClick={() => picker.current?.click()} />
      <IconButton icon={AtSign} label={uiText('引用业务记录')} disabled={busy || disabled} onClick={onAttach} />
      <span className="mist-spacer" />
      {(busy || working && !value.trim()) && onStop ? <button type="button" className="mist-send" data-kind="stop" aria-label={uiText('停止生成')} onClick={onStop}><Icon icon={Square} size="sm" /></button>
        : !attachments.length && !value.trim() && voiceAvailable && !busy ? <button type="button" className="mist-send" data-kind="voice" aria-label={uiText('语音通话')} title={uiText('语音通话')} onClick={() => void voice.start()}><Icon icon={AudioLines} size="sm" /></button>
        : <button type="button" className="mist-send" aria-label={uiText('发送')} disabled={!ready} onClick={onSend}><Icon icon={ArrowUp} size="sm" /></button>}
    </div>
  </div>;
}

const TILE_ICON = [CalendarClock, Landmark, Mail, ListTodo];
export function greeting(name: string | undefined, now = new Date()) {
  const h = (now.getUTCHours() + 8) % 24, part = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
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
