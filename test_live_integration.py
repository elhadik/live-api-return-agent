import asyncio
import websockets
import json
import base64

async def test_integration():
    uri = "ws://localhost:8080/ws"
    async with websockets.connect(uri) as websocket:
        print("Connected to WebSocket")
        
        # Send a text message triggering the return agent
        message = {
            "text": "I want to return my order"
        }
        await websocket.send(json.dumps(message))
        print(f"Sent: {message}")
        
        # Listen for responses
        try:
            while True:
                response = await websocket.recv()
                data = json.loads(response)
                
                if "text" in data:
                    print(f"Received Text: {data['text']}")
                    # If we get a response that looks like it came from the return agent, success!
                    # The return agent usually asks for order details.
                    if "order" in data['text'].lower() or "return" in data['text'].lower() or "profile" in data['text'].lower():
                        print("✅ verification success: Received response likely from Return Agent")
                        break
                elif "audio" in data:
                    print("Received Audio chunk (skipping)")
                    
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed")

if __name__ == "__main__":
    asyncio.run(test_integration())
