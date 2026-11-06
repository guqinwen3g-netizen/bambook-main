import * as React from 'react';
import type { AgentTaskView } from '../../../../server/src/shared/mistAgentTasks';
import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { mistApiRequest } from './workspace';
import { RealtimePcmPlayer } from './voiceAudio';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';
type Resources = { socket?: WebSocket; stream?: MediaStream; player?: RealtimePcmPlayer; capture?: AudioWorkletNode; source?: MediaStreamAudioSourceNode; gain?: GainNode; timer?: ReturnType<typeof setInterval> };
/** A call is bound to its original account/company; audio is never replayed on reconnect. */
export function usePersonalAgentVoice(scope: string, workspaceId: string | undefined, onTask: (task: AgentTaskView) => void) {
  const [state, setState] = React.useState<VoiceState>('idle'), [error, setError] = React.useState('');
  const [muted, setMuted] = React.useState(false), [transcript, setTranscript] = React.useState(''), [reply, setReply] = React.useState('');
  const resources = React.useRef<Resources>({}), generation = React.useRef(0), selectedTask = React.useRef<string | undefined>(undefined);
  const onTaskRef = React.useRef(onTask); onTaskRef.current = onTask;
  const liveScope = React.useRef(scope); liveScope.current = scope;
  const dispose = React.useCallback(() => {
    generation.current++;
    const r = resources.current; resources.current = {};
    if (r.timer) clearInterval(r.timer);
    r.stream?.getTracks().forEach(track => track.stop());
    r.capture?.disconnect(); r.source?.disconnect(); r.gain?.disconnect();
    if (r.socket && r.socket.readyState < WebSocket.CLOSING) r.socket.close();
    void r.player?.close();
  }, []);
  const end = React.useCallback(() => { dispose(); setState('idle'); setMuted(false); }, [dispose]);
  React.useEffect(() => { setState('idle'); setError(''); setTranscript(''); setReply(''); selectedTask.current = undefined; return dispose; }, [scope, dispose]);
  const start = React.useCallback(async (taskId?: string) => {
    if (!workspaceId) return;
    dispose(); const epoch = generation.current, r: Resources = {}; resources.current = r;
    const current = () => generation.current === epoch && liveScope.current === scope;
    const fail = (message: string) => { if (!current()) return; dispose(); setState('error'); setError(message); setMuted(false); };
    setState('connecting'); setError(''); setMuted(false); setTranscript(''); setReply('');
    if (taskId) selectedTask.current = taskId;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) throw new Error('当前设备不支持实时语音');
      // Unlock playback within the original click, before any network or permission wait.
      r.player = RealtimePcmPlayer.create(24000);
      const status = await mistApiRequest(`/api/mist/workspaces/${encodeURIComponent(workspaceId)}/voice/status`);
      if (!current()) return;
      if (!status.configured) throw new Error('平台尚未配置实时语音');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      r.stream = stream;
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => fail('麦克风已断开，已交办事项继续执行'), { once: true });
      const context = r.player.getAudioContext();
      await context.audioWorklet.addModule(new URL('./voiceCapture.worklet.js', import.meta.url));
      if (!current()) return;
      const bound = taskId ?? selectedTask.current;
      const session = await mistApiRequest(`/api/mist/workspaces/${encodeURIComponent(workspaceId)}/voice/sessions`, { method: 'POST', body: JSON.stringify({ locale: interfaceLocale(), ...(bound ? { taskId: bound } : {}) }) });
      if (!current()) return;
      const url = new URL('/api/mist/voice/stream', window.location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('id', session.id);
      const socket = new WebSocket(url, ['bambook-voice-v1', 'bambook-ticket.' + session.ticket]); r.socket = socket; socket.binaryType = 'arraybuffer';
      socket.onmessage = event => {
        if (!current()) return;
        let message: any; try { message = JSON.parse(event.data); } catch { fail('语音响应无效，请重试'); return; }
        if (message.type === 'ready') {
          if (selectedTask.current && selectedTask.current !== bound) socket.send(JSON.stringify({ type: 'bind_task', taskId: selectedTask.current }));
          r.source = context.createMediaStreamSource(stream);
          r.capture = new AudioWorkletNode(context, 'bambook-voice-capture');
          // Microphone or capture loss ends the call; delegated tasks keep running server-side.
          r.capture.onprocessorerror = () => fail('麦克风采集中断，已交办事项继续执行');
          r.gain = context.createGain(); r.gain.gain.value = 0;
          r.capture.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
            if (!current() || socket.readyState !== WebSocket.OPEN || !stream.getAudioTracks().some(track => track.enabled)) return;
            if (socket.bufferedAmount > 64_000) { fail('语音网络拥堵，请重新连接'); return; }
            socket.send(data);
          };
          r.source.connect(r.capture); r.capture.connect(r.gain); r.gain.connect(context.destination);
          setState('listening');
          r.timer = setInterval(() => {
            if (!current()) return;
            if (context.state === 'closed') { fail('语音设备已关闭，已交办事项继续执行'); return; }
            setState(r.player?.isPlaying() ? 'speaking' : 'listening');
          }, 150);
        } else if (message.type === 'speech_started' || message.type === 'speech_stopped') { r.player?.stop(); setReply(''); }
        else if (message.type === 'transcript') setTranscript(String(message.text ?? ''));
        else if (message.type === 'reply') setReply(previous => message.final ? String(message.text ?? '') : previous + String(message.text ?? ''));
        else if (message.type === 'audio') void r.player?.enqueue(message.audio).catch(() => fail('语音播放失败，请重试'));
        else if (message.type === 'task' && message.item?.id) { selectedTask.current = message.item.id; onTaskRef.current(message.item); }
        else if (message.type === 'error') fail(message.message || '语音未完成，请重试');
      };
      socket.onerror = () => fail('语音连接失败，请重试');
      socket.onclose = () => fail('语音已断开，已交办事项继续执行');
    } catch (e) {
      const denied = e instanceof DOMException && e.name === 'NotAllowedError';
      fail(denied ? '请允许使用麦克风后重试' : e instanceof Error ? e.message : '语音连接失败，请重试');
    }
  }, [workspaceId, scope, dispose]);
  const toggleMute = () => {
    const next = !muted, r = resources.current;
    r.stream?.getAudioTracks().forEach(track => { track.enabled = !next; });
    if (r.socket?.readyState === WebSocket.OPEN) r.socket.send(JSON.stringify({ type: 'mute', muted: next }));
    setMuted(next);
  };
  const interrupt = () => {
    resources.current.player?.stop();
    const socket = resources.current.socket;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'interrupt' }));
  };
  const followTask = (id: string) => {
    selectedTask.current = id;
    const socket = resources.current.socket;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'bind_task', taskId: id }));
  };
  return { state, error, muted, transcript, reply, start, end, toggleMute, interrupt, followTask };
}
