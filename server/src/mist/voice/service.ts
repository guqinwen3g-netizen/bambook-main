import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import type { AgentTaskView } from '../../shared/mistAgentTasks';
import { MistApiError } from '../errors';
import { samePublicOrigin } from '../../shared/bambookPublicOrigins';
import { VOICE_ENDPOINT, VOICE_INPUT_RATE, VOICE_OUTPUT_RATE, voiceConfig, voiceSession, voiceSpeak, voiceText, voiceToolResult, type VoiceConfig } from './protocol';

const fail = (code: string, message: string, status = 400): never => { throw new MistApiError(code, message, status); };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const TICKET_TTL = 30_000, CALL_TTL = 15 * 60_000, MAX_BUFFER = 1_048_576;
export type VoiceBinding = {
  owner: string; workspaceId: string; locale: string; taskId?: string;
  authorize(): Promise<void>;
  task(id: string): Promise<AgentTaskView>;
  submit(text: string, requestId: string, current?: AgentTaskView): Promise<AgentTaskView>;
  control(action: 'pause' | 'resume' | 'cancel', current: AgentTaskView, requestId: string): Promise<AgentTaskView>;
};
type Ticket = { id: string; tokenHash: string; origin: string; at: number; binding: VoiceBinding };
export type VoiceOptions = { config?: () => VoiceConfig | null; connect?: (config: VoiceConfig) => WebSocket; now?: () => number; pollMs?: number };
/** Credentials never enter a ticket, browser response, business state or log. */
export class MistVoiceService {
  private tickets = new Map<string, Ticket>();
  private calls = new Map<string, () => void>();
  private owners = new Set<string>();
  private now: () => number;
  private config: () => VoiceConfig | null;
  constructor(private options: VoiceOptions = {}) { this.now = options.now ?? Date.now; this.config = options.config ?? voiceConfig; }
  status() { return { configured: !!this.config(), provider: 'doubao', inputSampleRate: VOICE_INPUT_RATE, outputSampleRate: VOICE_OUTPUT_RATE, maxCallSeconds: CALL_TTL / 1000 }; }
  stopCalls() { for (const close of this.calls.values()) close(); for (const ticket of this.tickets.values()) this.owners.delete(ticket.binding.owner); this.tickets.clear(); }
  async issue(binding: VoiceBinding, origin: string) {
    await binding.authorize();
    if (!this.config()) fail('VOICE_NOT_CONFIGURED', '平台尚未配置实时语音', 503);
    if (!/^https?:\/\//.test(origin) || new URL(origin).origin !== origin) fail('VOICE_ORIGIN_INVALID', '语音来源无效', 403);
    for (const [key, ticket] of this.tickets) if (this.now() - ticket.at >= TICKET_TTL) { this.tickets.delete(key); this.owners.delete(ticket.binding.owner); }
    if (this.owners.has(binding.owner)) fail('VOICE_ALREADY_ACTIVE', '请先结束当前语音', 409);
    if (this.tickets.size + this.calls.size >= 100) fail('VOICE_BUSY', '语音繁忙，请稍后重试', 429);
    if (binding.taskId) await binding.task(binding.taskId);
    const token = randomBytes(32).toString('base64url'), id = randomUUID();
    this.tickets.set(id, { id, tokenHash: digest(token), origin, at: this.now(), binding });
    this.owners.add(binding.owner);
    return { id, ticket: token, expiresIn: TICKET_TTL / 1000 };
  }
  attach(server: Server) {
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 32_768, perMessageDeflate: false, handleProtocols: protocols => protocols.has('bambook-voice-v1') ? 'bambook-voice-v1' : false });
    const upgrade = (req: any, socket: Duplex, head: Buffer) => {
      const reject = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
      let url: URL;
      try { url = new URL(req.url ?? '', 'http://localhost'); } catch { reject(400); return; }
      if (url.pathname !== '/api/mist/voice/stream') { reject(404); return; }
      const id = url.searchParams.get('id') ?? '';
      // Carry the short-lived ticket in a subprotocol header, not an access-log URL.
      const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim());
      const token = protocols.find(value => value.startsWith('bambook-ticket.'))?.slice(15) ?? '', ticket = this.tickets.get(id);
      if (!ticket || token.length !== 43 || ticket.tokenHash !== digest(token) || this.now() - ticket.at >= TICKET_TTL || req.headers.origin !== ticket.origin) { reject(401); return; }
      // The ticket was minted on an authenticated same-origin HTTP route. Origin is
      // checked again here; a WebSocket must not become a cross-site cookie tunnel.
      if (!samePublicOrigin(req.headers.host ?? '', ticket.origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ticket.origin)) { reject(403); return; }
      this.tickets.delete(id); // one-use, including a failed provider handshake
      void ticket.binding.authorize().then(() => {
        if (socket.destroyed) { this.owners.delete(ticket.binding.owner); return; }
        sockets.handleUpgrade(req, socket, head, browser => this.start(browser, ticket));
      }).catch(() => { this.owners.delete(ticket.binding.owner); reject(403); });
    };
    server.on('upgrade', upgrade);
    return () => { server.off('upgrade', upgrade); for (const close of this.calls.values()) close(); sockets.close(); };
  }
  private start(browser: WebSocket, ticket: Ticket) {
    const binding = ticket.binding, config = this.config();
    if (!config) { this.owners.delete(binding.owner); browser.close(1011, '语音暂不可用'); return; }
    let provider: WebSocket;
    try { provider = this.options.connect?.(config) ?? new WebSocket(VOICE_ENDPOINT, { headers: { 'X-Api-Key': config.apiKey, 'X-Api-Connect-Id': randomUUID() }, handshakeTimeout: 10_000, maxPayload: MAX_BUFFER, perMessageDeflate: false }); }
    catch { this.owners.delete(binding.owner); browser.close(1011, '语音连接失败'); return; }
    let closed = false, ready = false, polling = false, taskId = binding.taskId;
    let transcript = '', transcriptKey = '', consumedTranscript = '', lastTask = '', authAt = this.now(), utterance = 0;
    let frameAt = this.now(), bytes = 0, messages = 0, lastPongAt = this.now(), pingAt = this.now();
    let bindingChange: Promise<void> = Promise.resolve();
    let suppressAudio = false, lastResponseId = '';
    const blockedResponses = new Set<string>();
    const handled = new Map<string, Promise<unknown>>();
    const send = (payload: unknown) => { if (browser.readyState === WebSocket.OPEN && browser.bufferedAmount < MAX_BUFFER) browser.send(JSON.stringify(payload)); else if (browser.bufferedAmount >= MAX_BUFFER) close(); };
    const upstream = (payload: unknown) => { if (provider.readyState === WebSocket.OPEN && provider.bufferedAmount < MAX_BUFFER) provider.send(JSON.stringify(payload)); else if (provider.bufferedAmount >= MAX_BUFFER) close(); };
    const interrupt = () => {
      suppressAudio = true;
      if (lastResponseId) blockedResponses.add(lastResponseId);
      if (blockedResponses.size > 32) blockedResponses.delete(blockedResponses.values().next().value!);
      upstream({ type: 'response.cancel', event_id: randomUUID() });
    };
    const close = () => {
      if (closed) return; closed = true;
      clearTimeout(timeout); clearInterval(poll); clearTimeout(handshake);
      this.calls.delete(ticket.id); this.owners.delete(binding.owner);
      browser.close(1000); provider.close();
      // Hanging up only closes speech. It never cancels a persistent work task.
    };
    const error = (code: string, message: string) => { send({ type: 'error', code, message }); close(); };
    const timeout = setTimeout(() => error('VOICE_TIME_LIMIT', '本次语音已结束，可重新连接'), CALL_TTL);
    const handshake = setTimeout(() => error('VOICE_CONNECT_TIMEOUT', '语音连接超时，请重试'), 15_000);
    const current = async () => { await bindingChange; return taskId ? binding.task(taskId) : undefined; };
    const publishTask = async () => {
      const task = await current();
      if (!task) return;
      const key = JSON.stringify([task.id, task.state, task.checkpoint, task.result, task.questions, task.waitingProposalIds]);
      if (key === lastTask) return; lastTask = key;
      send({ type: 'task', item: task });
      const question = task.questions?.find(q => !q.answer)?.question;
      const speech = task.waitingProposalIds.length ? '有事项需要你在页面确认。' : question || (['succeeded', 'failed'].includes(task.state) ? task.result : '');
      if (ready && speech) upstream(voiceSpeak(speech, question ? '请在原事项查看问题并补充资料。' : task.state === 'failed' ? '任务未完成，请在原事项查看原因。' : '任务已经处理，请在原事项查看结果。'));
    };
    const poll = setInterval(() => {
      if (polling || closed || !ready) return; polling = true;
      void (async () => {
        if (this.now() - lastPongAt > 45_000) { error('VOICE_DISCONNECTED', '语音已断开，已交办事项继续执行'); return; }
        if (this.now() - pingAt >= 20_000) { browser.ping(); pingAt = this.now(); }
        if (this.now() - authAt >= 10_000) { await binding.authorize(); authAt = this.now(); }
        await publishTask();
      })().catch(() => error('VOICE_ACCESS_CHANGED', '语音授权已变化，请重新连接')).finally(() => { polling = false; });
    }, this.options.pollMs ?? 2000);
    this.calls.set(ticket.id, close);
    const dispatch = async (name: string, args: Record<string, unknown>, callId: string) => {
      await binding.authorize();
      const task = await current();
      if (name === 'bambook_voice_context') {
        if (Object.keys(args).length) fail('INVALID_INPUT', '上下文不接受额外参数');
        return { task: task ? { name: task.name, state: task.state, instructions: task.instructions, checkpoint: task.checkpoint, result: task.result, questions: task.questions, requiresPageConfirmation: task.waitingProposalIds.length > 0 } : null };
      }
      if (name === 'bambook_voice_interrupt') {
        if (Object.keys(args).length) fail('INVALID_INPUT', '停止声音不接受额外参数');
        interrupt(); send({ type: 'speech_stopped' }); return { speech: 'stopped', taskUnchanged: true, outcome_spoken: true };
      }
      if (name !== 'bambook_voice_task' && name !== 'bambook_voice_control') fail('FORBIDDEN', '语音工具不可用', 403);
      if (name === 'bambook_voice_task' && Object.keys(args).length) fail('INVALID_INPUT', '交办不接受改写后的内容');
      if (name === 'bambook_voice_control' && (!task || Object.keys(args).some(k => k !== 'action') || !['pause', 'resume', 'cancel'].includes(String(args.action)))) fail('INVALID_INPUT', '请指定当前任务和操作');
      if (!transcript.trim() || !transcriptKey) fail('VOICE_TRANSCRIPT_REQUIRED', '请先说出要办理的事项');
      if (consumedTranscript === transcriptKey) fail('VOICE_TRANSCRIPT_USED', '这句话已交办，请等待结果或继续补充');
      // A provider cannot replace the user's actual final words with an invented
      // instruction. One final utterance can cause at most one task/control action.
      consumedTranscript = transcriptKey;
      let result: AgentTaskView;
      const requestId = 'voice-' + digest(ticket.id + ':' + callId).slice(0, 56);
      if (name === 'bambook_voice_task') {
        result = await binding.submit(transcript, requestId, task);
      } else {
        result = await binding.control(args.action as 'pause' | 'resume' | 'cancel', task!, requestId);
      }
      taskId = result.id; send({ type: 'task', item: result });
      return { name: result.name, state: result.state, result: result.result, question: result.questions?.find(q => !q.answer)?.question, requiresPageConfirmation: result.waitingProposalIds.length > 0, outcome_spoken: false };
    };
    provider.on('open', () => upstream(voiceSession(config, ticket.id, binding.locale)));
    provider.on('message', data => {
      if (closed) return;
      let payload: Record<string, any>;
      try { payload = JSON.parse(data.toString()); } catch { error('VOICE_PROTOCOL_ERROR', '语音响应无效，请重试'); return; }
      if (payload.type === 'session.created') { ready = true; clearTimeout(handshake); send({ type: 'ready', id: ticket.id, inputSampleRate: VOICE_INPUT_RATE, outputSampleRate: VOICE_OUTPUT_RATE }); return; }
      if (payload.type === 'error') { error('VOICE_PROVIDER_FAILED', '语音服务暂不可用，请稍后重试'); return; }
      if (payload.type === 'session.closed') { close(); return; }
      if (payload.type === 'conversation.item.input_audio_transcription.started') { transcript = ''; transcriptKey = ''; utterance++; interrupt(); send({ type: 'speech_started' }); return; }
      if (payload.type === 'conversation.item.input_audio_transcription.delta') { send({ type: 'transcript', final: false, text: voiceText(payload) }); return; }
      if (payload.type === 'conversation.item.input_audio_transcription.completed') { transcript = voiceText(payload); transcriptKey = digest(utterance + ':' + transcript); send({ type: 'transcript', final: true, text: transcript }); return; }
      if (payload.type === 'response.function_call_arguments.done') {
        const items = Array.isArray(payload.items) ? payload.items : payload.items ? [payload.items] : [];
        for (const item of items.slice(0, 5)) {
          const callId = item.call_id, name = item.name ?? item.function?.name;
          if (typeof callId !== 'string' || !callId || callId.length > 200 || typeof name !== 'string') continue;
          if (!handled.has(callId)) {
            if (handled.size >= 100) { error('VOICE_CALL_LIMIT', '本次语音已达到限额，请重新连接'); return; }
            let args: unknown;
            try { const rawArgs = item.arguments ?? item.function?.arguments ?? {}; args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; } catch { args = null; }
            const work = args && typeof args === 'object' && !Array.isArray(args) ? dispatch(name, args as Record<string, unknown>, callId) : Promise.reject(new MistApiError('INVALID_INPUT', '语音参数无效', 400));
            handled.set(callId, work.catch(e => ({ error: true, message: e instanceof MistApiError ? e.message : '操作未完成，请在任务页核对原结果' })));
          }
          void handled.get(callId)!.then(result => { if (!closed) upstream(voiceToolResult(callId, result)); });
        }
        return;
      }
      // An idle cancellation has no acknowledgement in the real service. The
      // next distinct audio-start event is the boundary; late old-response data
      // stays blocked even if it arrives after the next response has begun.
      if (payload.type === 'response.canceled') return;
      const responseId = typeof payload.response_id === 'string' ? payload.response_id : '';
      if (responseId && blockedResponses.has(responseId)) return;
      if (payload.type === 'response.output_audio.started') { lastResponseId = responseId; suppressAudio = false; return; }
      if (payload.type === 'response.output_audio.delta') {
        const audio = payload.audio ?? payload.delta;
        if (!suppressAudio && typeof audio === 'string' && audio.length <= MAX_BUFFER && /^[A-Za-z0-9+/]*={0,2}$/.test(audio)) send({ type: 'audio', audio });
      } else if (payload.type === 'response.output_text.delta' || payload.type === 'response.output_text.done') send({ type: 'reply', final: payload.type.endsWith('.done'), text: voiceText(payload) });
      else if (payload.type === 'response.output_audio.done') send({ type: 'audio_done' });
    });
    browser.on('message', (raw, binary) => {
      if (!ready || closed) return;
      const data = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
      if (this.now() - frameAt >= 1000) { frameAt = this.now(); bytes = 0; messages = 0; }
      if (++messages > 100 || (bytes += data.length) > 96_000) { error('VOICE_RATE_LIMIT', '语音传输过快，请重新连接'); return; }
      if (binary) {
        if (data.length % 2 || data.length > 6400) { error('VOICE_AUDIO_INVALID', '语音格式无效'); return; }
        upstream({ type: 'input_audio_buffer.append', event_id: randomUUID(), audio: data.toString('base64') }); return;
      }
      let message: any; try { message = JSON.parse(data.toString()); } catch { error('VOICE_INPUT_INVALID', '语音请求无效'); return; }
      if (message.type === 'interrupt') interrupt();
      else if (message.type === 'mute' && typeof message.muted === 'boolean') upstream({ type: message.muted ? 'input_audio_mute.commit' : 'input_audio_unmute.commit', event_id: randomUUID() });
      else if (message.type === 'bind_task' && typeof message.taskId === 'string' && message.taskId.length <= 100 && !Object.keys(message).some(key => !['type', 'taskId'].includes(key))) {
        bindingChange = bindingChange.then(async () => { await binding.authorize(); const item = await binding.task(message.taskId); taskId = item.id; lastTask = ''; send({ type: 'task', item }); }).catch(() => error('VOICE_TASK_UNAVAILABLE', '该事项无法接续，请在任务页核对'));
      }
      else if (message.type === 'end') close();
      else error('VOICE_INPUT_INVALID', '语音请求无效');
    });
    browser.on('close', close); browser.on('error', close);
    browser.on('pong', () => { lastPongAt = this.now(); });
    provider.on('close', () => { if (!closed) error('VOICE_DISCONNECTED', '语音已断开，请重新连接；已交办任务继续执行'); });
    provider.on('error', () => error('VOICE_CONNECT_FAILED', '语音连接失败，请重试'));
  }
}
