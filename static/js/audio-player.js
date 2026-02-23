export class AudioPlayer {
  constructor(onPlaybackStatusChanged) {
    this.audioContext = null;
    this.nextStartTime = 0;
    this.onPlaybackStatusChanged = onPlaybackStatusChanged;
    this.activeSources = 0;
  }

  async initialize() {
    this.audioContext = new AudioContext({ sampleRate: 24000 }); // Live API outputs 24kHz
  }

  play(base64Data) {
    if (!this.audioContext) return;

    const arrayBuffer = this.base64ToArrayBuffer(base64Data);
    // data is raw PCM 16-bit 24kHz
    // We need to convert it to Float32 for Web Audio API

    const int16Data = new Int16Array(arrayBuffer);
    const float32Data = new Float32Array(int16Data.length);

    for (let i = 0; i < int16Data.length; i++) {
      float32Data[i] = int16Data[i] / 32768.0;
    }

    const buffer = this.audioContext.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    source.onended = () => {
      this.activeSources--;
      if (this.activeSources === 0 && this.onPlaybackStatusChanged) {
        this.onPlaybackStatusChanged(false);
      }
    };

    const currentTime = this.audioContext.currentTime;
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    if (this.activeSources === 0 && this.onPlaybackStatusChanged) {
      this.onPlaybackStatusChanged(true);
    }
    this.activeSources++;
  }

  base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
