"""Security utilities - rate limiting and text sanitization"""
import re
import time
from collections import defaultdict


def sanitize_text(text: str, max_length: int = 10000) -> str:
    """Sanitize text content to only allow specific characters.

    Args:
        text: Text to sanitize
        max_length: Maximum length to truncate to

    Returns:
        Sanitized text string

    """
    if not text:
        return ""

    # Remove potentially dangerous characters, keep common punctuation
    text = re.sub(r'[^A-Za-z0-9\(\)_\-<>:,\{\}\'"\ \n\r\\\[\]\.\|]', "", text)

    # Truncate to max length
    if len(text) > max_length:
        text = text[:max_length]

    return text


class RateLimiter:

    """Rate limiter to prevent abuse.

    Tracks requests per user and enforces limits.
    """

    def __init__(self, max_requests: int = 5, window_seconds: int = 30):
        """Initialize rate limiter.

        Args:
            max_requests: Maximum requests allowed in window
            window_seconds: Time window in seconds

        """
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.request_counts = defaultdict(list)

    def is_rate_limited(self, user_id: int) -> bool:
        """Check if user is rate limited.

        Args:
            user_id: Discord user ID

        Returns:
            True if rate limited, False otherwise

        """
        current_time = time.time()
        user_requests = self.request_counts[user_id]

        # Remove old requests outside the window
        user_requests[:] = [
            req_time for req_time in user_requests
            if current_time - req_time < self.window_seconds
        ]

        # Check if limit exceeded
        if len(user_requests) >= self.max_requests:
            return True

        # Track this request
        user_requests.append(current_time)
        return False
