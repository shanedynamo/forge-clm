from fastapi import FastAPI

app = FastAPI(title="Forge NLP Service", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "forge-nlp"}


@app.post("/analyze")
async def analyze(text: str) -> dict[str, object]:
    """Analyze contract text — placeholder for spaCy + LegalBERT pipeline."""
    return {
        "text_length": len(text),
        "entities": [],
        "clauses": [],
    }
