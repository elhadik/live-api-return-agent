import { AudioRecorder } from './audio-recorder.js';
import { AudioPlayer } from './audio-player.js';

class App {
  constructor() {
    this.video = document.getElementById('videoPreview');
    this.micBtn = document.getElementById('micBtn');
    this.cameraBtn = document.getElementById('cameraBtn');
    this.connectBtn = document.getElementById('connectBtn');
    this.statusBadge = document.getElementById('connectionStatus');
    this.chatMessages = document.getElementById('chatMessages');
    this.messageInput = document.getElementById('messageInput');
    this.sendBtn = document.getElementById('sendBtn');
    this.fileInput = document.getElementById('fileInput');
    this.attachBtn = document.getElementById('attachBtn');
    this.attachmentPreview = document.getElementById('attachmentPreview');
    this.previewImg = document.getElementById('previewImg');
    this.clearAttachmentBtn = document.getElementById('clearAttachmentBtn');
    this.boundingBoxCanvas = document.getElementById('boundingBoxCanvas');

    this.pendingAttachment = null;

    this.ws = null;
    this.audioRecorder = null;

    this.audioPlayer = new AudioPlayer((isPlaying) => this.handlePlaybackStateChange(isPlaying));
    this.stream = null;

    this.isConnected = false;
    this.isMicOn = false;
    this.isCameraOn = false;
    this.isAgentSpeaking = false;
    this.isSending = false;
    this.lastUserMessage = { text: null, timestamp: 0 };

    this.recognition = null;
    if ('webkitSpeechRecognition' in window) {
      this.recognition = new webkitSpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            this.addMessage('User', event.results[i][0].transcript);
          }
        }
      };
      this.recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error);
      };
    }

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.connectBtn.addEventListener('click', () => this.toggleConnection({ audio: true, video: true }));
    this.micBtn.addEventListener('click', () => this.toggleMic());
    this.cameraBtn.addEventListener('click', () => this.toggleCamera());

    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.attachBtn.addEventListener('click', () => this.fileInput.click());

    this.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.handleFileSelection(file);
      }
    });

    this.clearAttachmentBtn.addEventListener('click', () => this.clearAttachment());

    // Pause recognition while typing to prevent artifacts
    this.messageInput.addEventListener('focus', () => {
      if (this.recognition) {
        try {
          this.recognition.stop();
        } catch (e) { console.log('Stop recognition on focus failed', e); }
      }
    });

    this.messageInput.addEventListener('blur', () => {
      if (this.isMicOn && this.recognition && !this.audioPlayer.activeSources) {
        try {
          this.recognition.start();
        } catch (e) { console.log('Start recognition on blur failed', e); }
      }
    });
  }

  async sendMessage() {
    if (this.isSending) return;

    const text = this.messageInput.value.trim();
    if (!text && !this.pendingAttachment) return; // Allow sending if attachment exists

    // Deduplication check: Ignore identical messages sent within 1000ms
    // Only check if NO attachment (attachments are harder to accidental double send via Enter)
    const now = Date.now();
    if (!this.pendingAttachment && this.lastUserMessage.text === text && (now - this.lastUserMessage.timestamp < 1000)) {
      console.log("Duplicate message prevented:", text);
      this.messageInput.value = ''; // Ensure it's cleared even if skipped
      return;
    }

    // Clear input immediately to prevent double sending
    this.messageInput.value = '';
    this.isSending = true;
    this.lastUserMessage = { text: text, timestamp: now };

    try {
      if (!this.isConnected) {
        await this.connect({ audio: true, video: true });

        // Wait for connection to be established
        let retries = 0;
        while (!this.isConnected && retries < 20) {
          await new Promise(r => setTimeout(r, 100));
          retries++;
        }

        if (!this.isConnected) {
          this.addMessage('System', 'Connection failed. Please try again.');
          this.messageInput.value = text; // Restore text
          this.lastUserMessage = { text: null, timestamp: 0 }; // Reset last message allows retry
          return;
        }
      }

      if (this.pendingAttachment) {
        // Send attachment first or with text? 
        // Live API expects realtime_input. We can send it before text.

        // Convert base64 to just data part if needed, but readAsDataURL includes prefix
        // We need to strip "data:image/xyz;base64,"
        const base64Data = this.pendingAttachment.data.split(',')[1];
        const mimeType = this.pendingAttachment.type;

        this.ws.send(JSON.stringify({
          image: {
            mime_type: mimeType,
            data: base64Data
          }
        }));

        this.addMessage('User', '[Image Uploaded]'); // Visual feedback
      }

      if (text) {
        this.addMessage('User', text);
        this.ws.send(JSON.stringify({ text: text }));
      }

      this.clearAttachment(); // Clear after sending
    } catch (e) {
      console.error("SendMessage error:", e);
      this.messageInput.value = text; // Restore text on error
      this.lastUserMessage = { text: null, timestamp: 0 }; // Reset last message allows retry
    } finally {
      this.isSending = false;
    }
  }

  async toggleConnection(config = { audio: true, video: true }) {
    if (this.isConnected) {
      this.disconnect();
    } else {
      await this.connect(config);
    }
  }

  async connect(config) {
    if (this.isConnecting) return; // Prevent multiple clicks
    this.isConnecting = true;

    try {
      this.updateStatus('Connecting...', 'connecting');

      // Initialize Audio Content
      this.audioPlayer = new AudioPlayer((isPlaying) => this.handlePlaybackStateChange(isPlaying));
      await this.audioPlayer.initialize();

      // Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.connectBtn.innerText = 'stop';
        this.connectBtn.style.background = '#ea4335';
        this.updateStatus('Connected', 'connected');
        this.startMedia(config);
      };

      this.ws.onclose = () => {
        this.disconnect();
      };

      this.ws.onmessage = (event) => this.handleMessage(event);

    } catch (error) {
      console.error('Connection failed:', error);
      this.updateStatus('Connection Failed', 'disconnected');
      this.isConnecting = false;
    }
  }

  disconnect() {
    this.isConnected = false;
    this.isMicOn = false;
    this.isCameraOn = false;
    this.isAgentSpeaking = false;

    this.connectBtn.innerText = 'play_arrow';
    this.connectBtn.style.background = '#34a853';
    this.updateStatus('Disconnected', 'disconnected');

    // Reset buttons to off state
    this.updateButtonState(this.micBtn, false, 'mic', 'mic_off');
    this.updateButtonState(this.cameraBtn, false, 'videocam', 'videocam_off');

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.stopMedia();
  }

  async startMedia(config) {
    try {
      // Get user media (mic + camera)
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true
        },
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      });

      this.video.srcObject = this.stream;

      // Initialize Audio Recorder
      this.audioRecorder = new AudioRecorder(this.stream, (data) => {
        // Only send audio if connected, mic is on, AND agent is NOT speaking
        if (this.isConnected && this.ws && this.isMicOn && !this.isAgentSpeaking) {
          this.sendAudioChunk(data);
        }
      });
      await this.audioRecorder.initialize();

      // Start sending video frames
      this.startVideoLoop();

      // Enable buttons based on config
      this.isMicOn = config.audio;
      this.isCameraOn = config.video;
      this.updateButtonState(this.micBtn, this.isMicOn, 'mic', 'mic_off');
      this.updateButtonState(this.cameraBtn, this.isCameraOn, 'videocam', 'videocam_off');

      if (this.stream) {
        this.stream.getVideoTracks().forEach(track => track.enabled = this.isCameraOn);
      }

      if (this.isMicOn && this.recognition) {
        try {
          this.recognition.start();
        } catch (e) {
          console.error("Failed to start recognition:", e);
        }
      }

    } catch (error) {
      console.error('Error accessing media devices:', error);
      this.addMessage('System', 'Error accessing camera/microphone. Please ensure permissions are granted.');
    }
  }

  stopMedia() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioRecorder) {
      this.audioRecorder.close();
      this.audioRecorder = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        console.error("Failed to stop recognition:", e);
      }
    }
    this.video.srcObject = null;
  }

  async toggleMic() {
    if (!this.isConnected) {
      await this.toggleConnection({ audio: true, video: false });
      return;
    }
    this.isMicOn = !this.isMicOn;
    this.updateButtonState(this.micBtn, this.isMicOn, 'mic', 'mic_off');

    if (this.recognition) {
      try {
        if (this.isMicOn) {
          // Only start if agent is NOT speaking to prevent echo
          if (!this.isAgentSpeaking) {
            this.recognition.start();
          }
        } else {
          this.recognition.stop();
        }
      } catch (e) {
        console.error("Failed to toggle recognition:", e);
      }
    }
  }

  async toggleCamera() {
    if (!this.isConnected) {
      await this.toggleConnection({ audio: false, video: true });
      return;
    }
    this.isCameraOn = !this.isCameraOn;
    this.updateButtonState(this.cameraBtn, this.isCameraOn, 'videocam', 'videocam_off');
    if (this.stream) {
      this.stream.getVideoTracks().forEach(track => track.enabled = this.isCameraOn);
    }
  }

  handlePlaybackStateChange(isPlaying) {
    this.isAgentSpeaking = isPlaying;

    if (isPlaying) {
      this.updateStatus('Agent Speaking', 'agent-speaking');
      // Stop recognition to prevent self-transcription
      if (this.recognition) {
        try {
          this.recognition.stop();
        } catch (e) {
          // ignore already stopped
        }
      }
    } else {
      this.updateStatus('Connected', 'connected');
      // Resume recognition if mic is supposed to be on
      if (this.isMicOn && this.recognition) {
        try {
          this.recognition.start();
        } catch (e) {
          console.error("Failed to resume recognition:", e);
        }
      }
    }
  }

  updateButtonState(btn, isOn, onIcon, offIcon) {
    btn.innerText = isOn ? onIcon : offIcon;
    if (isOn) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }

  sendAudioChunk(data) {
    // Data is Int16Array or Float32Array?
    // AudioRecorder should give us base64 encoded string or raw bytes?
    // Let's assume AudioRecorder gives us base64 string for simplicity here, 
    // OR we handle it here.

    // Wait, app.py expects:
    // { "realtime_input": { "media_chunks": [{ "mime_type": "audio/pcm;rate=16000", "data": "BASE64" }] } }

    this.ws.send(JSON.stringify({
      realtime_input: {
        media_chunks: [{
          mime_type: "audio/pcm;rate=16000",
          data: data // data must be base64 encoded
        }]
      }
    }));
  }

  startVideoLoop() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const sendFrame = () => {
      if (!this.isConnected || !this.isCameraOn) {
        if (this.isConnected) requestAnimationFrame(sendFrame);
        return;
      }

      if (this.video.videoWidth > 0) {
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        ctx.drawImage(this.video, 0, 0);

        // Compress to JPEG
        const base64Data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];

        this.ws.send(JSON.stringify({
          realtime_input: {
            media_chunks: [{
              mime_type: "image/jpeg",
              data: base64Data
            }]
          }
        }));
      }

      // Limit FPS to ~2FPS to save bandwidth/quota
      setTimeout(() => requestAnimationFrame(sendFrame), 500);
    };

    sendFrame();
  }

  handleMessage(event) {
    const data = JSON.parse(event.data);
    this.hideThinking();

    if (data.audio) {
      this.audioPlayer.play(data.audio.data);
    }

    if (data.text) {
      const bboxRegex = /\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]/g;
      let match;
      let drawn = false;
      while ((match = bboxRegex.exec(data.text)) !== null) {
        this.drawBoundingBox(match[1], match[2], match[3], match[4]);
        drawn = true;
      }
      this.addMessage('Agent', data.text);
    }

    if (data.widget) {
      if (data.widget === 'bounding_box') {
        this.drawBoundingBox(data.coordinates[0], data.coordinates[1], data.coordinates[2], data.coordinates[3]);
      } else if (data.widget === 'return_item') {
        const itemName = data.item_name || 'iPhone 17';
        this.renderReturnWidget(itemName);
      } else if (data.widget === 'return_label') {
        const itemName = data.item_name || 'iPhone 17';
        this.renderReturnLabelWidget(itemName);
      }
    }
  }

  renderReturnWidget(itemName) {
    const div = document.createElement('div');
    div.className = 'message agent';

    // We add the widget directly inside an agent message bubble for consistency
    div.innerHTML = `
      Here are the details for your return:
      <div class="widget-return">
        <div class="item-details">
          <div class="item-image">
            <img src="/static/iphone_17.png" alt="${itemName}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
          </div>
          <div class="item-info">
            <h4>${itemName}</h4>
            <p>Order #7829-10</p>
            <p>Purchase Date: Oct 12, 2025</p>
            <div class="price">$999.00</div>
          </div>
        </div>
        <button class="btn-confirm" id="btnConfirmReturn">Confirm Return</button>
      </div>
    `;

    this.chatMessages.appendChild(div);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    // Attach event listener to the newly created button
    const confirmBtn = div.querySelector('#btnConfirmReturn');
    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      confirmBtn.innerText = 'Return Confirmed';
      confirmBtn.style.background = '#34a853'; // Green success color

      this.messageInput.value = "Confirm return";
      this.sendMessage();
    });
  }

  renderReturnLabelWidget(itemName) {
    const div = document.createElement('div');
    div.className = 'message agent';

    const trackingNumber = '1Z9999999999999999';

    div.innerHTML = `
      Here is your return shipping label for the ${itemName}:
      <div class="widget-return-label">
        <div class="label-header">
          <span>PRIORITY MAIL</span>
          <span>US POSTAGE REQUIRED</span>
        </div>
        
        <div class="addresses">
          <div class="address-block">
            <h5>From</h5>
            <p>JOHN DOE<br>123 MAIN ST<br>ANYTOWN, NY 12345</p>
          </div>
          <div class="address-block">
            <h5>To</h5>
            <p>RETURNS DEPARTMENT<br>456 WAREHOUSE BLVD<br>LOGISTICS CITY, PA 54321</p>
          </div>
        </div>

        <div class="barcode-container">
          <div class="barcode" style="font-family: 'Libre Barcode 39 Text', monospace;">*${trackingNumber}*</div>
          <div class="tracking-number">TRACKING #: ${trackingNumber}</div>
        </div>

        <button class="btn-download" id="btnDownloadLabel">
          <span class="material-icons">download</span> Download Label
        </button>
      </div>
    `;

    this.chatMessages.appendChild(div);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    // Attach event listener to the download button
    const downloadBtn = div.querySelector('#btnDownloadLabel');
    downloadBtn.addEventListener('click', () => {
      // Simulate download process
      downloadBtn.innerHTML = '<span class="material-icons">check</span> Downloaded';
      downloadBtn.classList.add('downloaded');

      // Optionally notify the agent that the label was downloaded
      this.messageInput.value = "I've downloaded the label";
      this.sendMessage();
    });
  }

  addMessage(sender, text) {
    this.hideThinking();
    const div = document.createElement('div');
    div.className = `message ${sender.toLowerCase()}`;
    div.innerText = text;
    this.chatMessages.appendChild(div);
    if (sender === 'User') {
      this.showThinking();
    }
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  showThinking() {
    if (this.thinkingDiv) return;
    this.thinkingDiv = document.createElement('div');
    this.thinkingDiv.className = 'message agent';
    this.thinkingDiv.id = 'thinking-indicator';

    // Override message defaults to fill the horizontal space
    this.thinkingDiv.style.maxWidth = '100%';
    this.thinkingDiv.style.width = '100%';
    this.thinkingDiv.style.boxSizing = 'border-box';
    this.thinkingDiv.style.margin = '8px 0';

    this.thinkingDiv.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; gap: 12px; padding: 16px 0; width: 100%;">
        <span style="width: 16px; height: 16px; background-color: #1a73e8; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both; animation-delay: -0.32s;"></span>
        <span style="width: 16px; height: 16px; background-color: #1a73e8; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both; animation-delay: -0.16s;"></span>
        <span style="width: 16px; height: 16px; background-color: #1a73e8; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both;"></span>
      </div>
      <style>
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1.2); }
        }
      </style>
    `;

    this.chatMessages.appendChild(this.thinkingDiv);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  hideThinking() {
    if (this.thinkingDiv && this.thinkingDiv.parentNode) {
      this.thinkingDiv.parentNode.removeChild(this.thinkingDiv);
      this.thinkingDiv = null;
    }
  }

  drawBoundingBox(yminStr, xminStr, ymaxStr, xmaxStr) {
    if (!this.boundingBoxCanvas || !this.video) return;
    const ctx = this.boundingBoxCanvas.getContext('2d');

    // Set internal canvas resolution to match true video source resolution
    this.boundingBoxCanvas.width = this.video.videoWidth;
    this.boundingBoxCanvas.height = this.video.videoHeight;

    const ymin = (parseInt(yminStr, 10) / 1000) * this.video.videoHeight;
    const xmin = (parseInt(xminStr, 10) / 1000) * this.video.videoWidth;
    const ymax = (parseInt(ymaxStr, 10) / 1000) * this.video.videoHeight;
    const xmax = (parseInt(xmaxStr, 10) / 1000) * this.video.videoWidth;

    ctx.clearRect(0, 0, this.boundingBoxCanvas.width, this.boundingBoxCanvas.height);

    ctx.beginPath();
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = '#ff6d00'; // vibrant orange
    ctx.lineWidth = 6;
    ctx.rect(xmin, ymin, xmax - xmin, ymax - ymin);
    ctx.stroke();

    // hide it after 3 seconds automatically
    if (this.bboxTimeout) clearTimeout(this.bboxTimeout);
    this.bboxTimeout = setTimeout(() => {
      ctx.clearRect(0, 0, this.boundingBoxCanvas.width, this.boundingBoxCanvas.height);
    }, 4000);
  }

  handleFileSelection(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      this.pendingAttachment = {
        name: file.name,
        type: file.type,
        data: e.target.result // Base64 Data URL
      };

      this.previewImg.src = e.target.result;
      this.attachmentPreview.style.display = 'flex';
      this.messageInput.focus();
    };
    reader.readAsDataURL(file);
  }

  clearAttachment() {
    this.pendingAttachment = null;
    this.fileInput.value = '';
    this.previewImg.src = '';
    this.attachmentPreview.style.display = 'none';
  }

  updateStatus(text, className) {
    this.statusBadge.innerText = text;
    this.statusBadge.className = `status-badge ${className}`;
  }
}

window.addEventListener('load', () => {
  new App();
});
