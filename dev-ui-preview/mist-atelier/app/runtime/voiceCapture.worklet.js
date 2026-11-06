/* Capture PCM16 at 16 kHz in 20 ms packets. No microphone audio is persisted. */
class BambookVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.previous = 0; this.index = 0; this.next = 0;
    this.packet = new Int16Array(320); this.used = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      while (this.next <= this.index) {
        const fraction = Math.max(0, Math.min(1, this.next - this.index + 1));
        const sample = Math.max(-1, Math.min(1, this.previous + (value - this.previous) * fraction));
        this.packet[this.used++] = sample < 0 ? sample * 32768 : sample * 32767;
        this.next += sampleRate / 16000;
        if (this.used === this.packet.length) {
          this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
          this.packet = new Int16Array(320); this.used = 0;
        }
      }
      this.previous = value; this.index++;
    }
    return true;
  }
}
registerProcessor('bambook-voice-capture', BambookVoiceCapture);
