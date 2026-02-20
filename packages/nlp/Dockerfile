FROM python:3.11-slim AS base

WORKDIR /app

# System deps for torch + general build
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ && \
    rm -rf /var/lib/apt/lists/*

# Install Python packages — CPU-only torch to keep image small
RUN pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir \
    sentence-transformers>=3.3.0 \
    spacy>=3.8.0 \
    fastapi>=0.115.0 \
    "uvicorn[standard]>=0.34.0" \
    pydantic>=2.10.0 \
    python-multipart>=0.0.18

# Install the forge-nlp package
COPY packages/nlp/pyproject.toml ./
COPY packages/nlp/src/ ./src/
RUN pip install --no-cache-dir -e .

# Pre-download the LegalBERT model so container startup is fast
ENV TRANSFORMERS_CACHE=/models
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('nlpaueb/legal-bert-base-uncased')"

EXPOSE 8000

# Run the FastAPI app
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
