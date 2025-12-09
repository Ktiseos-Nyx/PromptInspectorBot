"""QOTD System - Question of the Day Management

Manages a pool of questions that can be posted randomly to servers.
Tracks which questions have been used to avoid repetition.
"""
import json
import random
import time
from pathlib import Path

from .config import logger

# ============================================================================
# QOTD SYSTEM
# ============================================================================

QOTD_FILE = Path("qotd.json")

def load_qotd_data() -> dict:
    """Load QOTD data from JSON file."""
    if not QOTD_FILE.exists():
        return {
            "questions": [],
            "used_questions": [],
            "last_posted": None,
        }

    try:
        with open(QOTD_FILE) as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading QOTD data: {e}")
        return {"questions": [], "used_questions": [], "last_posted": None}

def save_qotd_data(data: dict):
    """Save QOTD data to JSON file."""
    try:
        with open(QOTD_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving QOTD data: {e}")

def get_random_qotd() -> tuple[str, int]:
    """Get a random unused question from the pool.

    Returns:
        Tuple of (question_text, question_index) or (None, -1) if no questions available

    """
    data = load_qotd_data()

    # Get unused questions
    all_questions = data.get("questions", [])
    used_questions = data.get("used_questions", [])

    # Find unused questions
    unused = [q for q in all_questions if q not in used_questions]

    # If all questions used, reset the pool
    if not unused and all_questions:
        logger.info("All QOTD questions used - resetting pool")
        data["used_questions"] = []
        save_qotd_data(data)
        unused = all_questions

    if not unused:
        return None, -1

    # Pick random question
    question = random.choice(unused)
    question_index = all_questions.index(question)

    return question, question_index

def mark_qotd_used(question: str):
    """Mark a question as used and update last_posted timestamp."""
    data = load_qotd_data()

    if question not in data.get("used_questions", []):
        data.setdefault("used_questions", []).append(question)

    data["last_posted"] = time.time()
    save_qotd_data(data)

def add_qotd_question(question: str) -> bool:
    """Add a new question to the pool.

    Returns:
        True if added successfully, False if duplicate

    """
    data = load_qotd_data()

    # Check for duplicates
    if question in data.get("questions", []):
        return False

    data.setdefault("questions", []).append(question)
    save_qotd_data(data)
    logger.info(f"Added new QOTD question: {question[:50]}...")
    return True

def get_qotd_stats() -> dict:
    """Get statistics about the QOTD pool.

    Returns:
        Dictionary with total, used, and remaining counts

    """
    data = load_qotd_data()
    total = len(data.get("questions", []))
    used = len(data.get("used_questions", []))
    remaining = total - used

    return {
        "total": total,
        "used": used,
        "remaining": remaining,
        "last_posted": data.get("last_posted"),
    }
