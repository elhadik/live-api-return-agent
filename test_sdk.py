import vertexai
from vertexai.preview import reasoning_engines
import time

import json

# Configuration
PROJECT_ID = "elhadik-sandbox-2"
LOCATION = "us-central1"
RESOURCE_ID = "6638221188348772352"

#projects/877385492942/locations/us-central1/reasoningEngines/6638221188348772352

# Initialize Vertex AI
print(f"Initializing Vertex AI with project {PROJECT_ID} and location {LOCATION}...")
vertexai.init(project=PROJECT_ID, location=LOCATION)

# Access the reasoning engine
resource_name = f"projects/{PROJECT_ID}/locations/{LOCATION}/reasoningEngines/{RESOURCE_ID}"
print(f"Connecting to Reasoning Engine: {resource_name}")
remote_agent = reasoning_engines.ReasoningEngine(resource_name)

# Test the agent using the successful ADK streaming method
user_id = f"user_{int(time.time())}"
message = "I need to return an item"
print(f"\n--- Querying Weather Agent (User ID: {user_id}) ---")
print(f"Query: {message}")

try:
    # 1. Create session explicitly
    print("Creating session...")
    try:
        session = remote_agent.create_session(user_id=user_id)
        session_id = session.id if hasattr(session, 'id') else session.get('id')
        print(f"Session Created: {session_id}")
    except Exception as e:
        print(f"Failed to create session: {e}")
        session_id = None

    # 2. Call streaming_agent_run_with_events with session_id
    if session_id:
        request_data = {
            "user_id": user_id,
            "session_id": session_id,
            "message": {
                "role": "user",
                "parts": [{"text": message}]
            }
        }
        request_json = json.dumps(request_data)
        
        print(f"Calling streaming_agent_run_with_events with session_id={session_id}...")
        responses = remote_agent.execution_api_client.stream_query_reasoning_engine(
            request={
                "name": remote_agent.resource_name,
                "input": {"request_json": request_json},
                "class_method": "streaming_agent_run_with_events"
            }
        )
        
        print("--- Response Stream ---")
        item_count = 0
        for response in responses:
            item_count += 1
            # response is likely google.api.HttpBody
            try:
                if hasattr(response, 'data'):
                    # The data is a JSON string (sometimes bytes)
                    raw_data = response.data
                    if isinstance(raw_data, bytes):
                        raw_data = raw_data.decode('utf-8')
                    
                    # Parse the JSON
                    # The structure we saw: {"events": [{"content": {"parts": [{"text": "..."}]}}], ...}
                    try:
                        chunk_json = json.loads(raw_data)
                        events = chunk_json.get('events', [])
                        for event in events:
                            content = event.get('content', {})
                            parts = content.get('parts', [])
                            for part in parts:
                                text = part.get('text')
                                if text:
                                    print(text, end="", flush=True)
                    except json.JSONDecodeError:
                        print(f"\n[Non-JSON Data]: {raw_data}")
                else:
                    print(f"\n[Unknown Response Type]: {type(response)}")
            except Exception as e:
                print(f"\n[Error processing chunk]: {e}")
                
        print(f"\n----------------\nStream finished.")
    else:
        print("Skipping stream call due to session creation failure.")

except Exception as e:
    print(f"\nError querying agent: {e}")
    print("\nTip: Ensure you have active Google Cloud credentials (gcloud auth application-default login).")
