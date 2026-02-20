"""Sample contract text for testing clause chunking."""

from pathlib import Path

_DIR = Path(__file__).parent


def load_sample(name: str) -> str:
    return (_DIR / name).read_text()
