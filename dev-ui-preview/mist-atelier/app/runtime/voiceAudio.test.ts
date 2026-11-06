// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { RealtimePcmPlayer } from './voiceAudio';
const sources: any[] = [];
class Audio {
  state = 'running'; currentTime = 0; sampleRate = 24000; destination = {};
  createAnalyser() { return { fftSize: 256, frequencyBinCount: 128, connect() {}, disconnect() {}, getByteFrequencyData() {} }; }
  createBuffer(_channels: number, length: number, rate: number) { return { duration: length / rate, copyToChannel() {} }; }
  createBufferSource() { const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn() }; sources.push(source); return source; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
beforeEach(() => { sources.length = 0; vi.stubGlobal('AudioContext', Audio); });
afterEach(() => vi.unstubAllGlobals());
it('plays a normal 45-second result streamed ahead of the output clock without dropping the call', async () => {
  const player = RealtimePcmPlayer.create(24000), second = btoa('\0'.repeat(48000));
  for (let i = 0; i < 45; i++) await expect(player.enqueue(second)).resolves.toBeUndefined();
  expect(sources.filter(source => source.buffer?.duration === 1)).toHaveLength(45);
  player.stop(); expect(sources.filter(source => source.stop.mock.calls.length)).toHaveLength(45);
  await player.close();
});
it('still bounds pathological queued playback and clears the queue on interruption', async () => {
  const player = RealtimePcmPlayer.create(24000), second = btoa('\0'.repeat(48000));
  for (let i = 0; i < 90; i++) await player.enqueue(second);
  await expect(player.enqueue(second)).rejects.toThrow('缓冲已满');
  player.stop(); await expect(player.enqueue(second)).resolves.toBeUndefined(); await player.close();
});
