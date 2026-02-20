"""
Training script for the custom NER model.

Usage:
    python -m forge_nlp.ner.train [--base-model en_core_web_sm] [--output models/forge-ner-v0.1]

For local development we use en_core_web_sm (fast).
Production uses en_core_web_trf (higher accuracy).
"""

from __future__ import annotations

import json
import logging
import warnings
from pathlib import Path

import spacy
from spacy.training import Example
from spacy.tokens import DocBin
from spacy.util import minibatch, compounding

from .entity_types import ALL_NER_LABELS
from .synthetic_data import save_training_data

logger = logging.getLogger(__name__)

_PKG_ROOT = Path(__file__).resolve().parent.parent.parent.parent  # packages/nlp
_DEFAULT_MODEL_DIR = _PKG_ROOT / "models" / "forge-ner-v0.1"
_DEFAULT_DATA_DIR = _PKG_ROOT / "data" / "synthetic"


def train(
    base_model: str = "en_core_web_sm",
    output_dir: str | Path = _DEFAULT_MODEL_DIR,
    data_dir: str | Path = _DEFAULT_DATA_DIR,
    n_iter: int = 30,
    n_examples: int = 500,
    seed: int = 42,
) -> dict[str, object]:
    """Train the custom NER model on synthetic data.

    Args:
        base_model: spaCy base model name.
        output_dir: Where to save the trained model.
        data_dir: Where to write/read synthetic training data.
        n_iter: Number of training iterations.
        n_examples: Number of synthetic training examples to generate.
        seed: Random seed.

    Returns:
        Dict with training metrics.
    """
    output_dir = Path(output_dir)
    data_dir = Path(data_dir)

    # ── 1. Generate synthetic data ──────────────────────────────────
    logger.info("Generating %d synthetic training examples …", n_examples)
    save_training_data(data_dir, n=n_examples, seed=seed)

    # ── 2. Load base model ──────────────────────────────────────────
    logger.info("Loading base model: %s", base_model)
    nlp = spacy.load(base_model)

    # ── 3. Add or get the NER pipe ──────────────────────────────────
    if "ner" not in nlp.pipe_names:
        ner = nlp.add_pipe("ner", last=True)
    else:
        ner = nlp.get_pipe("ner")

    # Add our custom labels
    for label in ALL_NER_LABELS:
        ner.add_label(label)

    # ── 4. Load training data ───────────────────────────────────────
    train_db = DocBin().from_disk(data_dir / "train.spacy")
    dev_db = DocBin().from_disk(data_dir / "dev.spacy")

    # We need a blank nlp to deserialize the DocBin (no pipeline components)
    nlp_blank = spacy.blank("en")
    train_docs = list(train_db.get_docs(nlp_blank.vocab))
    dev_docs = list(dev_db.get_docs(nlp_blank.vocab))

    # Convert to spaCy Example objects
    train_examples = []
    for doc in train_docs:
        example = Example.from_dict(nlp.make_doc(doc.text), {
            "entities": [(ent.start_char, ent.end_char, ent.label_) for ent in doc.ents],
        })
        train_examples.append(example)

    logger.info("Training data: %d examples, Dev data: %d examples", len(train_examples), len(dev_docs))

    # ── 5. Train ────────────────────────────────────────────────────
    # Only train the NER component
    losses_history: list[dict[str, float]] = []

    with nlp.select_pipes(enable=["ner"]), warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning)

        optimizer = nlp.resume_training()

        for iteration in range(n_iter):
            losses: dict[str, float] = {}
            # Shuffle training data
            import random
            random.seed(seed + iteration)
            random.shuffle(train_examples)

            batches = minibatch(train_examples, size=compounding(4.0, 32.0, 1.001))
            for batch in batches:
                nlp.update(batch, drop=0.35, losses=losses, sgd=optimizer)

            ner_loss = losses.get("ner", 0.0)
            losses_history.append({"iteration": iteration + 1, "ner_loss": ner_loss})
            if (iteration + 1) % 10 == 0:
                logger.info("Iteration %d/%d — NER loss: %.4f", iteration + 1, n_iter, ner_loss)

    # ── 6. Evaluate on dev set ──────────────────────────────────────
    dev_examples = []
    for doc in dev_docs:
        example = Example.from_dict(nlp.make_doc(doc.text), {
            "entities": [(ent.start_char, ent.end_char, ent.label_) for ent in doc.ents],
        })
        dev_examples.append(example)

    scores = nlp.evaluate(dev_examples)

    # ── 7. Save model ──────────────────────────────────────────────
    output_dir.mkdir(parents=True, exist_ok=True)
    nlp.to_disk(output_dir)
    logger.info("Model saved to %s", output_dir)

    # Save metrics
    metrics = {
        "base_model": base_model,
        "n_iter": n_iter,
        "n_train": len(train_examples),
        "n_dev": len(dev_examples),
        "final_loss": losses_history[-1]["ner_loss"] if losses_history else None,
        "ents_p": scores.get("ents_p", 0.0),
        "ents_r": scores.get("ents_r", 0.0),
        "ents_f": scores.get("ents_f", 0.0),
        "ents_per_type": scores.get("ents_per_type", {}),
    }
    metrics_path = output_dir / "training_metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2, default=str))
    logger.info("Metrics: P=%.2f R=%.2f F1=%.2f", metrics["ents_p"], metrics["ents_r"], metrics["ents_f"])

    return metrics


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description="Train custom NER model")
    parser.add_argument("--base-model", default="en_core_web_sm")
    parser.add_argument("--output", default=str(_DEFAULT_MODEL_DIR))
    parser.add_argument("--n-iter", type=int, default=30)
    parser.add_argument("--n-examples", type=int, default=500)
    args = parser.parse_args()

    train(
        base_model=args.base_model,
        output_dir=args.output,
        n_iter=args.n_iter,
        n_examples=args.n_examples,
    )
