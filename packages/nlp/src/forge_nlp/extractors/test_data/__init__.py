"""Sample contract text snippets for testing entity extraction."""

from pathlib import Path

_DIR = Path(__file__).parent


def load_sample(name: str) -> str:
    return (_DIR / name).read_text()
