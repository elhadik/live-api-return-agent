# Live API Return Agent

## Overview
The Live API Return Agent is a real-time, multimodal customer support application powered by Google's Gemini Live API. It enables users to process product returns through a seamless voice and video interface. Users can talk naturally to the agent, show items to their camera for real-time visual detection, and receive interactive rich-text tools (like return labels and confirmation buttons) directly in the chat UI.

## Architecture
This application utilizes a decoupled architecture to ensure low-latency, real-time multimedia streaming between the browser and the Gemini Live API.

*   **Backend (Python / Flask + WebSockets)**:
    *   `app.py`: The core application that manages WebSockets (`/ws`) to maintain a continuous, full-duplex connection. It bridges incoming browser streams directly to Vertex AI / Gemini.
    *   `agent.py`: Houses the core logic, system instructions, and tool definitions. This gives the AI the ability to execute functional background tools like drawing visual bounding boxes or generating UI widgets.
    *   `session_utils.py`: Contains utilities for managing the lifecycle and credentials of the Vertex AI session.
*   **Frontend (Vanilla JS + HTML5 / CSS)**:
    *   `index.html` & `app.js`: The frontend client that connects to the WebSocket. It efficiently processes raw microphone data and un-cropped camera frames directly to the backend at ~2 frames-per-second to prevent bandwidth overload.
    *   `audio-recorder.js` & `audio-player.js`: Handle capturing user microphone input in 16kHz PCM format and seamlessly buffering and playing back the AI's synthesized voice stream.

### Key Features
1.  **Immersive Object Detection**: The AI visually analyzes the un-cropped camera feed, executing a `draw_bounding_box` tool to calculate coordinates. The frontend uses an exact-match `object-fit: cover` overlay canvas to perfectly map the orange dotted boundaries onto the screen.
2.  **Rich Widget Injections**: The backend intercepts specific tool calls (`show_return_widget`, `show_return_label_widget`) and triggers the frontend to dynamically render functional HTML widgets (e.g., clickable buttons, visual shipping labels, and product images).
3.  **Full-Duplex Interruption**: Thanks to the Live API integration, the AI can be interrupted naturally if the user speaks over it.

## How to Run Locally

### Prerequisites
*   Python 3.10+
*   A valid Google Cloud Project with Vertex AI API enabled.

### Setup Instructions

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/elhadik/live-api-return-agent.git
    cd live-api-return-agent
    ```

2.  **Create and activate a virtual environment:**
    ```bash
    python -m venv venv
    source venv/bin/activate
    ```

3.  **Install the dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Configure Environment Variables:**
    If required by the agent configuration, provide your Google API key. You can copy the template or export it directly:
    ```bash
    export GOOGLE_API_KEY="your_actual_api_key_here"
    ```

5.  **Run the Server:**
    Because the application leverages the Agent Development Kit (ADK), you can run it via the ADK CLI, standard Flask, or the included shell script:
    ```bash
    adk run
    # OR
    flask run --port=8080
    ```

6.  **Access the Application:**
    Open your browser and navigate to:
    ```text
    http://localhost:8080
    ```
    *Note: You must grant Microphone and Camera permissions in your browser when prompted to use the application.*
