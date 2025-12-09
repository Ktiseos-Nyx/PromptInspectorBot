"""AI Providers - Gemini & Claude Integration

Handles communication with Gemini and Claude AI APIs for:
- Image description
- Question answering
- Chat sessions
"""
import asyncio
import base64
import io
from typing import Dict

import aiohttp
import discord
from PIL import Image
from google.genai import types

from .config import (
    logger,
    gemini_client,
    claude_client,
    GEMINI_PRIMARY_MODEL,
    GEMINI_FALLBACK_MODELS,
    GEMINI_MAX_RETRIES,
    GEMINI_RETRY_DELAY,
    CLAUDE_PRIMARY_MODEL,
)

# ============================================================================
# CONVERSATION SESSION TRACKING
# ============================================================================

# Store Gemini chat sessions per user
conversation_sessions: Dict[int, any] = {}

# ============================================================================
# PLURALKIT INTEGRATION
# ============================================================================

async def get_pluralkit_name(message: discord.Message) -> str:
    """Get the fronting alter's name from a PluralKit webhook message.

    Args:
        message: Discord message

    Returns:
        Fronting alter's name if message is from PluralKit, otherwise the Discord username

    """
    # PluralKit's webhook messages have a specific pattern
    if message.webhook_id:
        try:
            # Try to fetch the PluralKit API for message info
            async with aiohttp.ClientSession() as session:
                async with session.get(f"https://api.pluralkit.me/v2/messages/{message.id}") as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # Return the member's name if found
                        if "member" in data and "name" in data["member"]:
                            return data["member"]["name"]
        except Exception as e:
            logger.debug(f"Error fetching PluralKit info: {e}")

    # Fallback to Discord display name
    return message.author.display_name

# ============================================================================
# IMAGE OPTIMIZATION
# ============================================================================

def optimize_image_for_api(image_data: bytes, mime_type: str, max_size_mb: float = 3.5) -> tuple[bytes, str]:
    """Optimize image for API consumption by resizing if it exceeds the size limit.

    Args:
        image_data: Raw image bytes
        mime_type: Image MIME type (e.g. 'image/jpeg')
        max_size_mb: Maximum size in MB before optimization (default 3.5MB for Claude)

    Returns:
        Tuple of (optimized_image_bytes, mime_type)

    """
    # Check current size
    current_size_mb = len(image_data) / (1024 * 1024)

    if current_size_mb <= max_size_mb:
        # Image is already small enough
        return image_data, mime_type

    logger.info(f"🔄 Image too large ({current_size_mb:.2f}MB), optimizing to under {max_size_mb}MB...")

    # Open image
    img = Image.open(io.BytesIO(image_data))

    # Convert RGBA to RGB if needed (for JPEG compatibility)
    if img.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = background

    # Calculate resize factor to get under max_size_mb
    # Start with 80% of original dimensions
    scale_factor = 0.8

    while current_size_mb > max_size_mb and scale_factor > 0.1:
        new_width = int(img.width * scale_factor)
        new_height = int(img.height * scale_factor)

        # Resize image
        resized_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

        # Save to bytes with quality optimization
        output = io.BytesIO()
        resized_img.save(output, format="JPEG", quality=85, optimize=True)
        optimized_data = output.getvalue()
        current_size_mb = len(optimized_data) / (1024 * 1024)

        # Reduce scale factor for next iteration if needed
        scale_factor -= 0.1

    logger.info(f"✅ Image optimized to {current_size_mb:.2f}MB ({new_width}x{new_height})")

    return optimized_data, "image/jpeg"

# ============================================================================
# CLAUDE API
# ============================================================================

async def describe_image_with_claude(image_data: bytes, mime_type: str, prompt: str, model: str = None) -> str:
    """Describe an image using Claude's vision API.

    Args:
        image_data: Raw image bytes
        mime_type: Image MIME type (e.g. 'image/jpeg')
        prompt: Description prompt
        model: Claude model to use (defaults to CLAUDE_PRIMARY_MODEL)

    Returns:
        Description text from Claude

    """
    if not claude_client:
        raise Exception("Claude API not initialized - set ANTHROPIC_API_KEY")

    if model is None:
        model = CLAUDE_PRIMARY_MODEL

    # Optimize image if needed (prevents 400 errors from oversized images)
    image_data, mime_type = optimize_image_for_api(image_data, mime_type)

    # Encode image to base64 for Claude
    image_base64 = base64.b64encode(image_data).decode("utf-8")

    # Claude vision API call
    response = await claude_client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": image_base64,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            },
        ],
    )

    # Extract text from response
    if response.content and len(response.content) > 0:
        return response.content[0].text
    return None

# ============================================================================
# GEMINI API
# ============================================================================

async def call_gemini_with_retry(api_call_factory, max_retries: int = None, base_delay: float = None, fallback_models: list = None):
    """Call Gemini API with exponential backoff retry for 503 errors and model fallbacks.

    Args:
        api_call_factory: Callable that takes a model name and returns an async callable for the API call
        max_retries: Maximum number of retry attempts per model (defaults to config value)
        base_delay: Base delay in seconds (doubles with each retry, defaults to config value)
        fallback_models: List of model names to try as fallbacks (defaults to config value)

    Returns:
        API response

    Raises:
        Exception: If all retries and fallbacks fail

    """
    if max_retries is None:
        max_retries = GEMINI_MAX_RETRIES
    if base_delay is None:
        base_delay = GEMINI_RETRY_DELAY
    if fallback_models is None:
        fallback_models = GEMINI_FALLBACK_MODELS

    last_error = None

    # Try each model in the fallback chain
    for model_idx, model_name in enumerate(fallback_models):
        if model_idx > 0:
            logger.info(f"Trying fallback model: {model_name}")

        # Try the current model with retries
        for attempt in range(max_retries):
            try:
                api_call = api_call_factory(model_name)
                return await api_call()
            except Exception as e:
                last_error = e
                error_str = str(e).lower()

                # Check if it's a 503 error or rate limit
                is_service_error = any(keyword in error_str for keyword in [
                    "503", "service unavailable", "overloaded", "rate limit", "429",
                ])

                if is_service_error:
                    if attempt < max_retries - 1:
                        # Retry with exponential backoff
                        delay = base_delay * (2 ** attempt)
                        logger.warning(f"Gemini error with {model_name} (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...")
                        await asyncio.sleep(delay)
                        continue
                    if model_idx < len(fallback_models) - 1:
                        # Try next fallback model
                        logger.warning(f"Model {model_name} failed after {max_retries} attempts, trying fallback...")
                        break
                    # All models exhausted
                    logger.error("All Gemini models failed after retries")
                else:
                    # Not a service error, don't retry
                    raise

    # All retries and fallbacks failed
    raise last_error


async def ask_gemini(user: discord.User, question: str, user_display_name: str = None) -> str:
    """Asks a question to the Gemini API using the new SDK with retry and fallback support.

    Args:
        user: Discord user object
        question: Question to ask
        user_display_name: Optional display name to use (for PluralKit integration)

    """
    if not gemini_client:
        return "❌ Gemini API key is not configured."

    try:
        # Use provided display name or fall back to Discord name
        display_name = user_display_name or user.display_name

        # Get or create chat session for the user
        if user.id not in conversation_sessions:
            # Create new chat session with system instruction (using primary model)
            conversation_sessions[user.id] = gemini_client.aio.chats.create(
                model=GEMINI_PRIMARY_MODEL,
                config=types.GenerateContentConfig(
                    system_instruction=f"You are a helpful assistant talking to {display_name}. Address them by name when appropriate. Your goal is to provide accurate and concise answers.",
                ),
            )

        chat = conversation_sessions[user.id]

        # Send message with retry logic
        def make_call_factory(model_name):
            async def make_call():
                # For chat sessions, we need to recreate the session if switching models
                nonlocal chat
                if model_name != GEMINI_PRIMARY_MODEL:
                    logger.info(f"Recreating chat session with fallback model: {model_name}")
                    chat = gemini_client.aio.chats.create(
                        model=model_name,
                        config=types.GenerateContentConfig(
                            system_instruction="You are a helpful assistant. Your goal is to provide accurate and concise answers.",
                        ),
                    )
                    conversation_sessions[user.id] = chat

                return await chat.send_message(question)
            return make_call

        response = await call_gemini_with_retry(make_call_factory)
        return response.text

    except Exception as e:
        logger.error("Error calling Gemini API: %s", e)
        return f"❌ Error generating response: {e}"
