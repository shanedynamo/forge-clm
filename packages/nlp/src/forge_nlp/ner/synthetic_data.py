"""
Generate synthetic training data for bootstrapping the custom NER model.

Produces annotated contract snippets in spaCy DocBin format.
Each snippet is 1–3 paragraphs with 2–5 entity annotations.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from pathlib import Path

import spacy
from spacy.tokens import DocBin

from .entity_types import NerEntityType

# ─── Name / value pools ────────────────────────────────────────────────

_FIRST_NAMES = [
    "James", "Robert", "John", "Michael", "David", "William", "Richard",
    "Joseph", "Thomas", "Charles", "Mary", "Patricia", "Jennifer", "Linda",
    "Barbara", "Elizabeth", "Susan", "Jessica", "Sarah", "Karen",
]

_LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
    "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
]

_RANKS_TITLES = ["Col.", "Lt. Col.", "Maj.", "Capt.", "Mr.", "Ms.", "Dr."]

_DELIVERABLES = [
    "Monthly Status Report (CDRL A001)",
    "Software Design Document (CDRL A002)",
    "Final Technical Report (CDRL A003)",
    "Test and Evaluation Master Plan",
    "System Requirements Specification",
    "Integrated Master Schedule (IMS)",
    "Configuration Management Plan",
    "Quality Assurance Surveillance Plan",
    "Risk Management Plan",
    "Cybersecurity Assessment Report",
    "Program Management Review Briefing",
    "Weekly Activity Report",
    "Software Version Description",
    "Interface Control Document",
    "Training Materials Package",
]

_SCOPE_DESCRIPTIONS = [
    "provide engineering support for satellite communications systems",
    "perform cybersecurity assessments of Department of Defense networks",
    "develop and maintain automated testing frameworks for avionics software",
    "provide logistics support for Army tactical vehicle fleet",
    "conduct research and development of advanced sensor technologies",
    "deliver IT infrastructure modernization services",
    "provide program management support for the Joint Strike Fighter program",
    "perform sustainment engineering for naval weapons systems",
    "develop next-generation radar signal processing algorithms",
    "provide help desk and tier 2 technical support services",
    "conduct environmental remediation at former military installations",
    "provide intelligence analysis support services",
    "develop cloud migration strategy and implementation services",
    "perform maintenance and repair of aircraft engines",
    "provide training and simulation support services",
]

_RISK_CLAUSES = [
    "Limitation of Liability clause at H.4",
    "Termination for Default under FAR 52.249-8",
    "Liquidated Damages provision of $5,000 per day",
    "Indemnification clause requiring unlimited liability",
    "Warranty clause extending 24 months beyond acceptance",
    "Stop-Work Order clause",
    "Changes clause requiring equitable adjustment",
    "Disputes clause under the Contract Disputes Act",
    "Organizational Conflict of Interest mitigation plan",
    "Key Personnel replacement restrictions",
]

_IP_PROVISIONS = [
    "Government Purpose Rights (GPR)",
    "Limited Rights",
    "Unlimited Rights",
    "Restricted Rights",
    "SBIR Data Rights",
    "Specifically Negotiated License Rights",
    "Limited Purpose Rights (LPR)",
    "Special Purpose Rights (SPR)",
]

_OPTION_DESCRIPTIONS = [
    "Option Year 1 (12 months)",
    "Option Year 2 extending through September 2026",
    "Option Period I from October 2025 through September 2026",
    "Option Period II (24 months)",
    "Option CLIN 0003 for additional engineering support",
    "Option Year 3 for continued sustainment services",
    "Option to extend services for 6 months",
]

_FUNDING_TYPES = [
    "incrementally funded",
    "fully funded at award",
    "base plus four option years",
    "funded on a cost-reimbursable basis",
    "incrementally funded through fiscal year 2026",
    "fully funded with a ceiling price",
    "funded with Operations and Maintenance (O&M) funds",
    "funded with Research, Development, Test and Evaluation (RDT&E) funds",
]

_PROPERTY_ITEMS = [
    "Government Furnished Equipment (GFE) consisting of 10 laptop computers",
    "GFP: server hardware located at Building 200",
    "Government Furnished Information (GFI) including technical data packages",
    "GFE: secure communications equipment",
    "Government Furnished Property including office space at the installation",
    "GFE consisting of test fixtures and calibration equipment",
]

_SB_REQUIREMENTS = [
    "Small Business Set-Aside",
    "8(a) sole source award",
    "HUBZone price evaluation preference",
    "SDVOSB subcontracting goal of 3%",
    "Small Disadvantaged Business goal of 5%",
    "Women-Owned Small Business set-aside",
    "total small business subcontracting goal of 23%",
    "Service-Disabled Veteran-Owned Small Business set-aside",
]

_CONTRACT_NUMS = [
    "FA8726-24-C-0042", "W911NF-23-D-0017", "N00024-22-C-5301",
    "FA8750-25-C-0100", "W56HZV-24-C-0033", "N68335-23-C-0450",
    "GS-35F-0142Y", "W91CRB-24-D-0009",
]


# ─── Template engine ───────────────────────────────────────────────────

def _rand_name() -> str:
    return f"{random.choice(_FIRST_NAMES)} {random.choice(_LAST_NAMES)}"


def _rand_titled_name() -> str:
    return f"{random.choice(_RANKS_TITLES)} {_rand_name()}"


@dataclass
class _Span:
    start: int
    end: int
    label: str


@dataclass
class _Example:
    text: str
    entities: list[_Span] = field(default_factory=list)


def _insert_entity(parts: list[str], value: str, label: str, spans: list[_Span]) -> None:
    """Append *value* to *parts* and record its span."""
    start = sum(len(p) for p in parts)
    parts.append(value)
    spans.append(_Span(start=start, end=start + len(value), label=label))


# ─── Template functions ────────────────────────────────────────────────
# Each returns an _Example.  We aim for 2–5 entities per example.

def _template_co_cor() -> _Example:
    parts: list[str] = []
    spans: list[_Span] = []

    co_name = _rand_titled_name()
    cor_name = _rand_titled_name()

    parts.append("The Contracting Officer, ")
    _insert_entity(parts, co_name, NerEntityType.CONTRACTING_OFFICER, spans)
    parts.append(", hereby appoints ")
    _insert_entity(parts, cor_name, NerEntityType.CONTRACTING_OFFICER, spans)
    parts.append(" as the Contracting Officer's Representative (COR) for contract ")
    parts.append(f"{random.choice(_CONTRACT_NUMS)}. ")

    deliv = random.choice(_DELIVERABLES)
    parts.append("The contractor shall deliver the ")
    _insert_entity(parts, deliv, NerEntityType.DELIVERABLE_DESC, spans)
    parts.append(" within 30 days of contract award.")

    return _Example(text="".join(parts), entities=spans)


def _template_scope_deliverable() -> _Example:
    parts: list[str] = []
    spans: list[_Span] = []

    scope = random.choice(_SCOPE_DESCRIPTIONS)
    parts.append("The contractor shall ")
    _insert_entity(parts, scope, NerEntityType.SCOPE_DESCRIPTION, spans)
    parts.append(". ")

    deliv = random.choice(_DELIVERABLES)
    parts.append("The primary deliverable is the ")
    _insert_entity(parts, deliv, NerEntityType.DELIVERABLE_DESC, spans)
    parts.append(". All work shall be performed at the contractor's facility.")

    return _Example(text="".join(parts), entities=spans)


def _template_risk_ip() -> _Example:
    parts: list[str] = []
    spans: list[_Span] = []

    risk = random.choice(_RISK_CLAUSES)
    parts.append("Attention is directed to the ")
    _insert_entity(parts, risk, NerEntityType.RISK_CLAUSE, spans)
    parts.append(". ")

    ip_prov = random.choice(_IP_PROVISIONS)
    parts.append("All technical data delivered under this contract shall be subject to ")
    _insert_entity(parts, ip_prov, NerEntityType.IP_PROVISION, spans)
    parts.append(" as defined in DFARS 252.227-7013.")

    return _Example(text="".join(parts), entities=spans)


def _template_option_funding() -> _Example:
    parts: list[str] = []
    spans: list[_Span] = []

    opt = random.choice(_OPTION_DESCRIPTIONS)
    fund = random.choice(_FUNDING_TYPES)

    parts.append("The Government may exercise ")
    _insert_entity(parts, opt, NerEntityType.OPTION_DESCRIPTION, spans)
    parts.append(" at its sole discretion. This contract is ")
    _insert_entity(parts, fund, NerEntityType.FUNDING_TYPE, spans)
    parts.append(".")

    return _Example(text="".join(parts), entities=spans)


def _template_property_sb() -> _Example:
    parts: list[str] = []
    spans: list[_Span] = []

    prop = random.choice(_PROPERTY_ITEMS)
    parts.append("The Government will provide ")
    _insert_entity(parts, prop, NerEntityType.PROPERTY_ITEM, spans)
    parts.append(". ")

    sb = random.choice(_SB_REQUIREMENTS)
    parts.append("This procurement is designated as a ")
    _insert_entity(parts, sb, NerEntityType.SB_REQUIREMENT, spans)
    parts.append(".")

    return _Example(text="".join(parts), entities=spans)


def _template_contractor_rep_scope() -> _Example:
    parts: list[str] = []
    spans: list[_Span] = []

    rep = _rand_titled_name()
    parts.append("The Contractor Program Manager, ")
    _insert_entity(parts, rep, NerEntityType.CONTRACTOR_REP, spans)
    parts.append(", shall be the primary point of contact. ")

    scope = random.choice(_SCOPE_DESCRIPTIONS)
    parts.append("The contractor shall ")
    _insert_entity(parts, scope, NerEntityType.SCOPE_DESCRIPTION, spans)
    parts.append(". ")

    deliv = random.choice(_DELIVERABLES)
    parts.append("Deliverables include the ")
    _insert_entity(parts, deliv, NerEntityType.DELIVERABLE_DESC, spans)
    parts.append(".")

    return _Example(text="".join(parts), entities=spans)


def _template_full_paragraph() -> _Example:
    """A longer paragraph with 4–5 entities."""
    parts: list[str] = []
    spans: list[_Span] = []

    co_name = _rand_titled_name()
    parts.append("The Contracting Officer, ")
    _insert_entity(parts, co_name, NerEntityType.CONTRACTING_OFFICER, spans)
    parts.append(f", awards contract {random.choice(_CONTRACT_NUMS)} for the requirement to ")

    scope = random.choice(_SCOPE_DESCRIPTIONS)
    _insert_entity(parts, scope, NerEntityType.SCOPE_DESCRIPTION, spans)
    parts.append(". This contract is ")

    fund = random.choice(_FUNDING_TYPES)
    _insert_entity(parts, fund, NerEntityType.FUNDING_TYPE, spans)
    parts.append(". ")

    opt = random.choice(_OPTION_DESCRIPTIONS)
    parts.append("The Government may exercise ")
    _insert_entity(parts, opt, NerEntityType.OPTION_DESCRIPTION, spans)
    parts.append(". ")

    sb = random.choice(_SB_REQUIREMENTS)
    parts.append("This action is a ")
    _insert_entity(parts, sb, NerEntityType.SB_REQUIREMENT, spans)
    parts.append(".")

    return _Example(text="".join(parts), entities=spans)


def _template_ip_deliverable_risk() -> _Example:
    parts: list[str] = []
    spans: list[_Span] = []

    deliv = random.choice(_DELIVERABLES)
    parts.append("The contractor shall deliver the ")
    _insert_entity(parts, deliv, NerEntityType.DELIVERABLE_DESC, spans)
    parts.append(" to the Government. ")

    ip_prov = random.choice(_IP_PROVISIONS)
    parts.append("Data rights for all deliverables shall be ")
    _insert_entity(parts, ip_prov, NerEntityType.IP_PROVISION, spans)
    parts.append(". ")

    risk = random.choice(_RISK_CLAUSES)
    parts.append("The contractor's attention is drawn to the ")
    _insert_entity(parts, risk, NerEntityType.RISK_CLAUSE, spans)
    parts.append(" included in this contract.")

    return _Example(text="".join(parts), entities=spans)


def _template_gfp_option_co() -> _Example:
    parts: list[str] = []
    spans: list[_Span] = []

    prop = random.choice(_PROPERTY_ITEMS)
    parts.append("The Government shall furnish ")
    _insert_entity(parts, prop, NerEntityType.PROPERTY_ITEM, spans)
    parts.append(" for use under this contract. ")

    opt = random.choice(_OPTION_DESCRIPTIONS)
    parts.append("The contract includes ")
    _insert_entity(parts, opt, NerEntityType.OPTION_DESCRIPTION, spans)
    parts.append(". ")

    co = _rand_titled_name()
    parts.append("Questions regarding Government property shall be directed to ")
    _insert_entity(parts, co, NerEntityType.CONTRACTING_OFFICER, spans)
    parts.append(", Contracting Officer.")

    return _Example(text="".join(parts), entities=spans)


def _template_sb_funding_rep() -> _Example:
    parts: list[str] = []
    spans: list[_Span] = []

    sb = random.choice(_SB_REQUIREMENTS)
    parts.append("This contract is issued as a ")
    _insert_entity(parts, sb, NerEntityType.SB_REQUIREMENT, spans)
    parts.append(". ")

    fund = random.choice(_FUNDING_TYPES)
    parts.append("The effort is ")
    _insert_entity(parts, fund, NerEntityType.FUNDING_TYPE, spans)
    parts.append(". ")

    rep = _rand_titled_name()
    parts.append("The contractor's designated representative is ")
    _insert_entity(parts, rep, NerEntityType.CONTRACTOR_REP, spans)
    parts.append(".")

    return _Example(text="".join(parts), entities=spans)


_TEMPLATES = [
    _template_co_cor,
    _template_scope_deliverable,
    _template_risk_ip,
    _template_option_funding,
    _template_property_sb,
    _template_contractor_rep_scope,
    _template_full_paragraph,
    _template_ip_deliverable_risk,
    _template_gfp_option_co,
    _template_sb_funding_rep,
]


# ─── Public API ────────────────────────────────────────────────────────

def generate_examples(n: int = 500, seed: int = 42) -> list[_Example]:
    """Generate *n* synthetic training examples.

    Returns:
        List of ``_Example`` objects with text and entity spans.
    """
    random.seed(seed)
    examples: list[_Example] = []
    for _ in range(n):
        template = random.choice(_TEMPLATES)
        examples.append(template())
    return examples


def build_docbin(examples: list[_Example] | None = None, n: int = 500) -> DocBin:
    """Build a spaCy ``DocBin`` from synthetic examples.

    Args:
        examples: Pre-generated examples; if *None*, generates *n* new ones.
        n: Number of examples to generate if *examples* is None.

    Returns:
        A ``DocBin`` ready to be saved to disk.
    """
    if examples is None:
        examples = generate_examples(n)

    nlp = spacy.blank("en")
    db = DocBin()

    for ex in examples:
        doc = nlp.make_doc(ex.text)
        ents = []
        for span in ex.entities:
            sp = doc.char_span(span.start, span.end, label=span.label)
            if sp is not None:
                ents.append(sp)
        doc.ents = ents
        db.add(doc)

    return db


def save_training_data(output_dir: str | Path, n: int = 500, seed: int = 42) -> Path:
    """Generate synthetic data and save as a spaCy DocBin file.

    Args:
        output_dir: Directory to write ``train.spacy`` into.
        n: Number of training examples.
        seed: Random seed for reproducibility.

    Returns:
        Path to the saved ``.spacy`` file.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    examples = generate_examples(n=n, seed=seed)

    # 80/20 split
    split = int(len(examples) * 0.8)
    train_examples = examples[:split]
    dev_examples = examples[split:]

    train_db = build_docbin(train_examples)
    dev_db = build_docbin(dev_examples)

    train_path = output_dir / "train.spacy"
    dev_path = output_dir / "dev.spacy"

    train_db.to_disk(train_path)
    dev_db.to_disk(dev_path)

    return train_path
