import asyncio
import base64
import json
import logging
import os
import signal
import sys
import websockets
from flask import Flask, render_template, request, jsonify
from flask_sock import Sock
from flask_sock import Sock
from simple_websocket import ConnectionClosed
import vertexai
from vertexai.preview import reasoning_engines

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
# logging.getLogger("google.genai").setLevel(logging.DEBUG)
logger = logging.getLogger(__name__)

# Initialize Flask and Sock
app = Flask(__name__)
sock = Sock(app)

# Initialize Vertex AI for Agent Engine
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT")
LOCATION = os.environ.get("GOOGLE_CLOUD_REGION")
RETURN_AGENT_ID = os.environ.get("RETURN_AGENT_RESOURCE_ID")

if PROJECT_ID and LOCATION:
    try:
        vertexai.init(project=PROJECT_ID, location=LOCATION)
        logger.info(f"Initialized Vertex AI with project {PROJECT_ID} and location {LOCATION}")
    except Exception as e:
        logger.error(f"Failed to initialize Vertex AI: {e}")

remote_return_agent = None
if RETURN_AGENT_ID:
    try:
        remote_return_agent = reasoning_engines.ReasoningEngine(RETURN_AGENT_ID)
        logger.info(f"Connected to Return Agent: {RETURN_AGENT_ID}")
    except Exception as e:
        logger.error(f"Failed to connect to Return Agent: {e}")

# Import agent configuration
from agent import client, model_id, config, get_weather, calculate
from google.genai import types

@app.route('/')
def index():
    return render_template('index.html')

@sock.route('/ws')
def ws(ws):
    """
    WebSocket handler for the Live API session.
    """
    logger.info("New WebSocket connection established")
    
    # Run the async session in a synchronous wrapper
    # Since flask-sock runs in a thread, we can use asyncio.run or similar
    # But wait, we need to maintain a persistent connection to the Live API.
    # The Live API client is async. 
    # flask-sock is synchronous by default but can handle async with some workarounds, 
    # OR we can use the `async` keyword if running with an ASGI server like uvicorn as planned.
    
    # However, `flask-sock` with `uvicorn` and `Flask` might be tricky. 
    # Standard Flask routes are sync. `flask-sock` wraps simple-websocket.
    
    # Let's try to run the async loop manually for this connection.
    try:
        asyncio.run(handle_session(ws))
    except Exception as e:
        logger.error(f"WebSocket session error: {e}")
    finally:
        logger.info("WebSocket connection closed")

async def handle_session(ws_client):
    """
    Manages the session between the WebSocket client and the Gemini Live API.
    """
    session = None
    return_agent_session = None
    if remote_return_agent:
        try:
            # Create a unique user ID for this session
            user_id = f"user_{id(ws_client)}"
            return_agent_session = remote_return_agent.create_session(user_id=user_id)
            logger.info(f"Created Return Agent session for {user_id}")
        except Exception as e:
            logger.error(f"Failed to create Return Agent session: {e}")
    try:
        async with client.aio.live.connect(model=model_id, config=config) as session:
            logger.info("Connected to Gemini Live API")
            
            # Tasks to handle bidirectional communication
            # 1. Receive from WS client -> Send to Live API
            # 2. Receive from Live API -> Send to WS client
            
            async def receive_from_client():
                logger.info("Starting receive_from_client loop")
                while True:
                    try:
                        # This is a blocking call in sync Flask, but we are inside asyncio.run
                        # Wait, `ws_client.receive()` is synchronous in flask-sock.
                        # We need to run it in an executor or use `to_thread`.
                        message = await asyncio.to_thread(ws_client.receive)
                        if message is None:
                            break
                        
                        data = json.loads(message)
                        logger.info(f"Received message from client: {data.keys()}")
                        
                        # Handle different message types
                        if "realtime_input" in data:
                            # Audio or Video data
                            media_chunks = data["realtime_input"]["media_chunks"]
                            for chunk in media_chunks:
                                mime_type = chunk["mime_type"]
                                data_base64 = chunk["data"]
                                
                                logger.info(f"Received media chunk: {mime_type}, size: {len(data_base64)}")

                                await session.send_realtime_input(
                                    media={
                                        "mime_type": mime_type,
                                        "data": base64.b64decode(data_base64)
                                    }
                                )
                                logger.info(f"Sent media chunk to Live API: {mime_type}")
                        
                        elif "image" in data:
                            # Handle image as client_content
                            mime_type = data["image"]["mime_type"]
                            data_base64 = data["image"]["data"]
                            
                            logger.info(f"Received image: {mime_type}, size: {len(data_base64)}")
                            
                            await session.send_client_content(
                                turns=[types.Content(role="user", parts=[
                                    types.Part(inline_data=types.Blob(
                                        mime_type=mime_type,
                                        data=base64.b64decode(data_base64)
                                    ))
                                ])],
                                turn_complete=False # Allow text to follow
                            )
                            logger.info(f"Sent image as client_content to Live API: {mime_type}")
                        
                        elif "text" in data:
                            # Handle text input
                            text = data["text"]
                            await session.send_client_content(
                                turns=[types.Content(role="user", parts=[types.Part(text=text)])],
                                turn_complete=True
                            )
                                
                    except ConnectionClosed:
                        logger.info("Client disconnected")
                        break
                    except Exception as e:
                        logger.error(f"Error receiving from client: {e}")
                        break

            async def send_to_client():
                try:
                    logger.info("Starting send_to_client loop")
                    while True:
                        # logger.info("Calling session.receive()")
                        async for chunk in session.receive():
                            # logger.info(f"Received chunk from server: {chunk}")
                            # Process server content (audio/text)
                            if chunk.server_content:
                                model_turn = chunk.server_content.model_turn
                                if model_turn:
                                    parts = model_turn.parts
                                    for part in parts:
                                        if part.inline_data:
                                            # Audio
                                            msg = {
                                                "audio": {
                                                    "data": base64.b64encode(part.inline_data.data).decode('utf-8'),
                                                    "mime_type": part.inline_data.mime_type
                                                }
                                            }
                                            await asyncio.to_thread(ws_client.send, json.dumps(msg))
                                            # logger.info("Sent audio chunk to client")
                                        elif part.text:
                                            # Text
                                            msg = {
                                                "text": part.text
                                            }
                                            await asyncio.to_thread(ws_client.send, json.dumps(msg))
                                            logger.info(f"Sent text chunk to client: {part.text}")

                            # Check for tool calls
                            if chunk.tool_call:
                                logger.info(f"Received tool call: {chunk.tool_call}")
                                for function_call in chunk.tool_call.function_calls:
                                    name = function_call.name
                                    args = function_call.args
                                    call_id = function_call.id
                                    
                                    result = None
                                    if name == "get_weather":
                                        result = get_weather(location=args.get("location"))
                                    elif name == "calculate":
                                        result = calculate(expression=args.get("expression"))
                                    elif name == "consult_return_agent":
                                        user_msg = args.get("user_message")
                                        if return_agent_session:
                                            try:
                                                logger.info(f"Querying Return Agent with: {user_msg}")
                                                
                                                # Extract session_id
                                                session_id = None
                                                if hasattr(return_agent_session, 'name'):
                                                    session_id = return_agent_session.name
                                                elif isinstance(return_agent_session, dict):
                                                    session_id = return_agent_session.get('name') or return_agent_session.get('id')
                                                
                                                # Use helper
                                                result = await asyncio.to_thread(
                                                    query_return_agent_sync,
                                                    agent=remote_return_agent,
                                                    user_id=user_id,
                                                    session_id=session_id,
                                                    message=user_msg
                                                )
                                                     
                                                logger.info(f"Return Agent response: {result}")
                                            except Exception as e:
                                                logger.error(f"Error consulting return agent: {e}")
                                                result = f"Error consulting return agent: {e}"
                                        else:
                                            result = "Return agent is not available."
                                    elif name == "show_return_widget":
                                        item_name = args.get("item_name", "iPhone 17")
                                        logger.info(f"Sending show_return_widget to client for {item_name}")
                                        
                                        # Send widget instruction to client UI
                                        msg = {
                                            "widget": "return_item",
                                            "item_name": item_name
                                        }
                                        await asyncio.to_thread(ws_client.send, json.dumps(msg))
                                        
                                        result = "Widget successfully displayed to the user."
                                        
                                    elif name == "show_return_label_widget":
                                        item_name = args.get("item_name", "iPhone 17")
                                        logger.info(f"Sending show_return_label_widget to client for {item_name}")
                                        
                                        # Send widget instruction to client UI
                                        msg = {
                                            "widget": "return_label",
                                            "item_name": item_name
                                        }
                                        await asyncio.to_thread(ws_client.send, json.dumps(msg))
                                        
                                        result = "Shipping label widget successfully displayed to the user."
                                        
                                    elif name == "draw_bounding_box":
                                        logger.info(f"Sending bounding box to client: {args}")
                                        msg = {
                                            "widget": "bounding_box",
                                            "coordinates": [args.get("ymin"), args.get("xmin"), args.get("ymax"), args.get("xmax")]
                                        }
                                        await asyncio.to_thread(ws_client.send, json.dumps(msg))
                                        result = "Bounding box successfully drawn on the screen."
                                    
                                    if result:
                                        # Send tool response
                                        tool_response = types.LiveClientToolResponse(
                                            function_responses=[types.FunctionResponse(
                                                name=name,
                                                response={"result": result},
                                                id=call_id
                                            )]
                                        )
                                        await session.send_tool_response(function_responses=tool_response.function_responses)
                                        logger.info(f"Sent tool response for {name}")

                except ConnectionClosed:
                    logger.info("Connection closed during receive")
                except Exception as e:
                    logger.error(f"Error in send_to_client: {e}")
                finally:
                    logger.info("send_to_client loop finished")

            await asyncio.gather(receive_from_client(), send_to_client())

    except Exception as e:
        logger.error(f"Session error: {e}")


def query_return_agent_sync(agent, user_id, session_id, message):
    """
    Synchronous helper to query the remote return agent using the specific protocol.
    """
    try:
        request_data = {
            "user_id": user_id,
            "session_id": session_id,
            "message": {
                "role": "user",
                "parts": [{"text": message}]
            }
        }
        request_json = json.dumps(request_data)
        
        responses = agent.execution_api_client.stream_query_reasoning_engine(
            request={
                "name": agent.resource_name,
                "input": {"request_json": request_json},
                "class_method": "streaming_agent_run_with_events"
            }
        )
        
        full_text = ""
        for response in responses:
            if hasattr(response, 'data'):
                raw_data = response.data
                if isinstance(raw_data, bytes):
                    raw_data = raw_data.decode('utf-8')
                try:
                    chunk_json = json.loads(raw_data)
                    events = chunk_json.get('events', [])
                    for event in events:
                        content = event.get('content', {})
                        parts = content.get('parts', [])
                        for part in parts:
                            text = part.get('text')
                            if text:
                                full_text += text
                except json.JSONDecodeError:
                    pass
        return full_text
    except Exception as e:
        logger.error(f"Error in query_return_agent_sync: {e}")
        return f"Error querying return agent: {str(e)}"

if __name__ == '__main__':
    # We will run this with uvicorn in production, but for testing:
    app.run(host='0.0.0.0', port=8080)
