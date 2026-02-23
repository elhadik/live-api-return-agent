import asyncio
import websockets
import json
import base64
from io import BytesIO
from PIL import Image

async def test_image_upload():
    uri = "ws://localhost:8080/ws"
    
    # Generate a 300x300 red image
    img = Image.new('RGB', (300, 300), color='red')
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')
    
    async with websockets.connect(uri) as websocket:
        print("Connected to WebSocket")
        
        # 1. Send Image
        print("Sending image (300x300 red square)...")
        await websocket.send(json.dumps({
            "image": {
                "mime_type": "image/png",
                "data": img_str
            }
        }))
        
        # Wait a bit for processing
        await asyncio.sleep(2)
        
        # 2. Send Text Question
        print("Sending text question...")
        await websocket.send(json.dumps({
            "text": "Describe the image I just sent you. What color is it?"
        }))
        
        # 3. Listen for response
        print("Listening for response...")
        try:
            while True:
                message = await asyncio.wait_for(websocket.recv(), timeout=20.0)
                data = json.loads(message)
                
                if "text" in data:
                    print(f"Received text: {data['text']}")
                    response_text = data['text'].lower()
                    if "red" in response_text or "square" in response_text:
                        print("SUCCESS: Model identified the image!")
                        return
                    if "no image" in response_text:
                        print("FAILURE: Model claims no image.")
                    
        except asyncio.TimeoutError:
            print("Timeout waiting for response.")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_image_upload())
