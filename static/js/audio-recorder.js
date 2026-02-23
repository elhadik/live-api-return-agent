export class AudioRecorder {
  constructor(stream, onDataCallback) {
    this.stream = stream;
    this.onDataCallback = onDataCallback;
    this.audioContext = null;
    this.workletNode = null;
  }

  async initialize() {
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // Load AudioWorklet
    const workletCode = `
            class PCMProcessor extends AudioWorkletProcessor {
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input.length > 0) {
                        const channel0 = input[0];
                        // Convert Float32 to Int16
                        const int16Data = new Int16Array(channel0.length);
                        for (let i = 0; i < channel0.length; i++) {
                            const s = Math.max(-1, Math.min(1, channel0[i]));
                            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                        }
                        this.port.postMessage(int16Data);
                    }
                    return true;
                }
            }
            registerProcessor('pcm-processor', PCMProcessor);
        `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);

    await this.audioContext.audioWorklet.addModule(workletUrl);

    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-processor');

    this.workletNode.port.onmessage = (event) => {
      const int16Data = event.data;
      const base64Data = this.arrayBufferToBase64(int16Data.buffer);
      this.onDataCallback(base64Data);
    };

    source.connect(this.workletNode);
    // Do not connect to destination (speakers) to avoid feedback loop
  }

  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  close() {
    if (this.audioContext) {
      this.audioContext.close();
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
    }
  }
}
