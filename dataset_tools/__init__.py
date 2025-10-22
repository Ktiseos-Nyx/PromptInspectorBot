
# dataset_tools/__init__.py
import os
from pathlib import Path

# --- Configuration Variables ---

# Set the log level for the application
LOG_LEVEL = os.environ.get("DATASET_TOOLS_LOG_LEVEL", "INFO")

# Define the path to the configuration directory
CONFIG_PATH = Path(__file__).parent / "config"
