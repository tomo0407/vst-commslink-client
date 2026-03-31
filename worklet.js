/**
 * AudioWorkletProcessor that buffers microphone input into 960-sample frames
 * (20 ms at 48 kHz) and posts each frame to the main thread as Float32Array.
 */
class AudioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(960);
    this._pos = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      this._buf[this._pos++] = ch[i];
      if (this._pos === 960) {
        this.port.postMessage(this._buf.slice(0));
        this._pos = 0;
      }
    }
    return true;
  }
}

registerProcessor('audio-capture', AudioCapture);
