// AudioWorklet thu âm cho gõ bằng giọng nói: chuyển từng khối mẫu (kênh đầu) về luồng chính.
// File thật cùng nguồn (không phải Blob) vì CSP của trang chỉ cho `script-src 'self'`.
class VoiceTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('voice-tap', VoiceTap)
