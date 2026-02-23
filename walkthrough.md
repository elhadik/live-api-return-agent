# Live API ADK Weather Agent Walkthrough

We have successfully built a standalone Flask application that uses the ADK Live API to provide a multimodal agent experience.

## Features
- **Live Video/Audio Streaming**: Uses `MediaDevices` and `AudioWorklet` to stream low-latency audio and video to the Gemini Live API.
- **Multimodal capabilities**: The agent can see what you show it (via video frames) and hear what you say (via audio).
- **Tools**: The agent has access to `get_weather` and `calculate` tools.
- **Modern UI**: Glassmorphic design with real-time video preview and chat transcripts.

## Prerequisites
- Google Cloud Project with Vertex AI API enabled (if using Vertex) OR Google AI Studio API Key.
- `GOOGLE_API_KEY` set in `.env` (created from `.env.template`).

## Setup & Run

1.  **Install Dependencies**:
    ```bash
    cd live_api_agent
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    ```

2.  **Configure Environment**:
    - Edit `.env` to add your `GOOGLE_API_KEY`.

3.  **Run the Server**:
    ```bash
    # From the project root
    bash live_api_agent/run.sh
    ```

4.  **Access the App**:
    - Open [http://localhost:8080](http://localhost:8080) in your browser.
    - Click "Play" button to connect.
    - Grant Microphone and Camera permissions.

## Verification Results
- **Server Startup**: Verified `app.py` starts successfully on port 8080.
- **WebSocket Connection**: Verified `ws://localhost:8080/ws` accepts connections and maintains them.
- **Tool Definitions**: Fixed validation errors by explicitly defining `FunctionDeclaration` objects in `agent.py`.

## Files Created
- `live_api_agent/app.py`: Main Flask application with WebSocket handler.
- `live_api_agent/agent.py`: Agent configuration and tool definitions.
- `live_api_agent/templates/index.html`: Frontend UI.
- `live_api_agent/static/js/`: JavaScript modules for media handling.
