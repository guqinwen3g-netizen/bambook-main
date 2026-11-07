/** 小竹页的语音通话：豆包实时语音，交办与追问都进同一条对话里的任务。 */
import React from 'react';
import { Mic, MicOff, PhoneOff, Square } from 'lucide-react';
import { Banner, Button, Pill } from '../../../../../components/mist';
import { uiText } from '../../../../../services/interfaceLanguage';
import type { usePersonalAgentVoice } from '../../runtime/personalAgentVoice';

type Voice = ReturnType<typeof usePersonalAgentVoice>;
export const voiceInCall = (voice: Voice) => voice.state === 'connecting' || voice.state === 'listening' || voice.state === 'speaking';

export function XiaozhuCall({ voice }: { voice: Voice }) {
  if (voice.state === 'error') return <Banner tone="warn" title={uiText(voice.error)} actions={<Button onClick={() => void voice.start()}>{uiText('重新连接')}</Button>} />;
  if (!voiceInCall(voice)) return null;
  return <div className="mist-section"><div className="mist-row"><Pill tone="ai">{uiText(voice.state === 'connecting' ? '连接中' : voice.muted ? '已静音' : voice.state === 'speaking' ? '正在播放' : '正在聆听')}</Pill><span className="mist-spacer" />
    <Button icon={voice.muted ? MicOff : Mic} disabled={voice.state === 'connecting'} onClick={voice.toggleMute}>{uiText(voice.muted ? '取消静音' : '静音')}</Button>
    <Button icon={Square} disabled={voice.state !== 'speaking'} onClick={voice.interrupt}>{uiText('停止播放')}</Button>
    <Button icon={PhoneOff} onClick={voice.end}>{uiText('结束通话')}</Button></div>
    {voice.transcript && <p aria-label={uiText('我的语音')}>{voice.transcript}</p>}
    {voice.reply && <p aria-live="polite">{voice.reply}</p>}</div>;
}
