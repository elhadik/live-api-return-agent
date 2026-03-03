import asyncio
import os
import logging
from google import genai
from google.genai import types


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_weather(location: str) -> str:
    """Gets the weather for a given location.

    Args:
        location: The city or region to get weather for.
    """
    # Mock weather data
    return f"The weather in {location} is sunny with a high of 75°F and a low of 60°F."

def calculate(expression: str) -> str:
    """Evaluates a mathematical expression.

    Args:
        expression: The mathematical expression to evaluate (e.g., '2*3+4').
    """
    try:
        # Note: In a real app, use a safer evaluation method
        result = eval(expression, {"__builtins__": None}, {})
        return f"The result of {expression} is {result}."
    except Exception as e:
        return f"Error evaluating expression {expression}: {str(e)}"

def consult_return_agent(user_message: str) -> str:
    """Consults the specific return agent.
    
    Args:
        user_message: The user's message to pass to the return agent.
    """
    return "This tool is handled by the application logic."

# Initialize the client
client = genai.Client(
    api_key=os.environ.get("GOOGLE_API_KEY"),
    http_options={"api_version": "v1alpha"}
)

model_id = os.environ.get("AGENT_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025")

# Define tools using FunctionDeclaration
weather_tool = types.FunctionDeclaration(
    name="get_weather",
    description="Gets the weather for a given location.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "location": types.Schema(
                type="STRING",
                description="The city or region to get weather for."
            )
        },
        required=["location"]
    )
)

math_tool = types.FunctionDeclaration(
    name="calculate",
    description="Evaluates a mathematical expression.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "expression": types.Schema(
                type="STRING",
                description="The mathematical expression to evaluate (e.g., '2*3+4')."
            )
        },
        required=["expression"]
    )
)

return_tool = types.FunctionDeclaration(
    name="consult_return_agent",
    description="Consults the specialized return agent for handling product returns. Use this tool whenever a customer wants to return an item or asks about return policies.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "user_message": types.Schema(
                type="STRING",
                description="The customer's message or query about the return."
            )
        },
        required=["user_message"]
    )
)

show_return_widget_tool = types.FunctionDeclaration(
    name="show_return_widget",
    description="Displays the return item widget to the user. Use this tool when the user is ready to confirm a return of an item, like the iPhone 17.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "item_name": types.Schema(
                type="STRING",
                description="The name of the item to return (e.g., 'iPhone 17')."
            )
        },
        required=["item_name"]
    )
)

show_return_label_widget_tool = types.FunctionDeclaration(
    name="show_return_label_widget",
    description="Displays a return shipping label widget to the user. Use this tool ONLY after the user has confirmed a return AND they have chosen to return the item 'by mail'.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "item_name": types.Schema(
                type="STRING",
                description="The name of the item being returned."
            )
        },
        required=["item_name"]
    )
)

draw_bounding_box_tool = types.FunctionDeclaration(
    name="draw_bounding_box",
    description="Draws a bounding box around the detected item in the video stream. Call this immediately when you see the user showing an item.",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "ymin": types.Schema(type="INTEGER", description="Y min coordinate scaled 0 to 1000"),
            "xmin": types.Schema(type="INTEGER", description="X min coordinate scaled 0 to 1000"),
            "ymax": types.Schema(type="INTEGER", description="Y max coordinate scaled 0 to 1000"),
            "xmax": types.Schema(type="INTEGER", description="X max coordinate scaled 0 to 1000"),
            "label": types.Schema(type="STRING", description="Name of the detected item")
        },
        required=["ymin", "xmin", "ymax", "xmax", "label"]
    )
)

# Configuration for the Live API session
config = types.LiveConnectConfig(
    response_modalities=["AUDIO"],  # Audio output
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                voice_name="Puck"
            )
        )
    ),
    tools=[types.Tool(function_declarations=[weather_tool, math_tool, return_tool, show_return_widget_tool, show_return_label_widget_tool, draw_bounding_box_tool])],
    system_instruction=types.Content(parts=[types.Part(text="You are a helpful assistant that can check weather, perform calculations, and help with product returns by consulting the return agent. When the user is ready to return an iPhone 17, BEFORE you use the show_return_widget tool, YOU MUST explicitly say something like 'I have matched the iPhone to your previous purchase history. Please confirm the order number, purchase date, and return item as shown on the widget.'. Then, use the show_return_widget tool to show the confirmation UI. After they confirm the return via the widget, ask them if they want to return the item 'by mail' or 'in store'. If they choose 'by mail', use the show_return_label_widget tool to provide them with a return shipping label. If they choose 'in store', provide instructions for an in-store return. When the user shows an item to the camera, detect it and silently use the `draw_bounding_box` tool to highlight it.")])
)
