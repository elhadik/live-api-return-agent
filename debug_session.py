import asyncio
import os
import inspect
from google import genai
from dotenv import load_dotenv

load_dotenv()

async def inspect_session():
    client = genai.Client(
        api_key=os.environ.get("GOOGLE_API_KEY"),
        http_options={"api_version": "v1alpha"}
    )
    async with client.aio.live.connect(model="gemini-2.0-flash-exp", config={}) as session:
        print("Session Type:", type(session))
        print("Dir Session:", dir(session))
        
        if hasattr(session, 'send_client_content'):
            print("Sig:", inspect.signature(session.send_client_content))

if __name__ == "__main__":
    asyncio.run(inspect_session())
