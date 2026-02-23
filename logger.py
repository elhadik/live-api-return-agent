import logging

# Configure logging if not already configured
if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)

logger = logging.getLogger("live_api_agent")
