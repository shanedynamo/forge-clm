"""
Comprehensive tests for the clause-aware document chunker.
"""

from __future__ import annotations

import textwrap

import pytest

from forge_nlp.chunking.clause_chunker import (
    ClauseChunker,
    DetectedSection,
    DocumentChunk,
    DocumentProcessor,
    SectionDetector,
    SectionType,
    _word_count,
)
from forge_nlp.chunking.test_data import load_sample


# ─── Helpers ──────────────────────────────────────────────────────────

def _build_ucf_doc() -> str:
    """Build a minimal document with all 13 UCF sections."""
    lines: list[str] = []
    section_titles = {
        "A": "SOLICITATION/CONTRACT FORM",
        "B": "SUPPLIES OR SERVICES AND PRICES/COSTS",
        "C": "DESCRIPTION/SPECIFICATIONS/STATEMENT OF WORK",
        "D": "PACKAGING AND MARKING",
        "E": "INSPECTION AND ACCEPTANCE",
        "F": "DELIVERIES OR PERFORMANCE",
        "G": "CONTRACT ADMINISTRATION DATA",
        "H": "SPECIAL CONTRACT REQUIREMENTS",
        "I": "CONTRACT CLAUSES",
        "J": "LIST OF ATTACHMENTS",
        "K": "REPRESENTATIONS, CERTIFICATIONS, AND ACKNOWLEDGMENTS",
        "L": "INSTRUCTIONS, CONDITIONS, AND NOTICES TO OFFERORS",
        "M": "EVALUATION FACTORS FOR AWARD",
    }
    for letter, title in section_titles.items():
        lines.append(f"SECTION {letter} — {title}")
        lines.append("")
        lines.append(f"Content for section {letter}. " * 20)
        lines.append("")
        lines.append("")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════
# SectionDetector tests
# ═══════════════════════════════════════════════════════════════════════


class TestSectionDetector:
    def setup_method(self):
        self.detector = SectionDetector()

    def test_detects_all_ucf_sections_a_through_m(self):
        """All 13 UCF sections (A–M) should be detected."""
        text = _build_ucf_doc()
        sections = self.detector.detect(text)
        found_types = {s.section_type for s in sections}
        for letter in "ABCDEFGHIJKLM":
            expected = SectionType(f"SECTION_{letter}")
            assert expected in found_types, f"Missing {expected}"

    def test_handles_varied_header_formats(self):
        """Different header styles should all be recognized."""
        text = textwrap.dedent("""\
            SECTION A — SOLICITATION FORM

            Some content for A.

            Section B - Supplies or Services

            Some content for B.

            SECTION C: DESCRIPTION

            Some content for C.
        """)
        sections = self.detector.detect(text)
        found = {s.section_type for s in sections}
        assert SectionType.SECTION_A in found
        assert SectionType.SECTION_B in found
        assert SectionType.SECTION_C in found

    def test_letter_dot_title_format(self):
        """'A. SOLICITATION FORM' style headers."""
        text = textwrap.dedent("""\
            A. SOLICITATION/CONTRACT FORM

            Content for section A.

            B. SUPPLIES OR SERVICES

            Content for section B.
        """)
        sections = self.detector.detect(text)
        found = {s.section_type for s in sections}
        assert SectionType.SECTION_A in found
        assert SectionType.SECTION_B in found

    def test_section_end_chars_correct(self):
        """Each section's end_char equals the next section's start_char."""
        text = _build_ucf_doc()
        sections = self.detector.detect(text)
        for i in range(len(sections) - 1):
            assert sections[i].end_char == sections[i + 1].start_char

    def test_last_section_ends_at_text_end(self):
        text = _build_ucf_doc()
        sections = self.detector.detect(text)
        assert sections[-1].end_char == len(text)

    def test_returns_empty_for_no_headers(self):
        text = "This is just a plain paragraph with no section headers at all."
        sections = self.detector.detect(text)
        assert sections == []


# ═══════════════════════════════════════════════════════════════════════
# ClauseChunker tests
# ═══════════════════════════════════════════════════════════════════════


class TestClauseChunker:
    def setup_method(self):
        self.chunker = ClauseChunker(
            target_tokens=500,
            max_tokens=600,
            overlap_tokens=50,
        )

    # ─── Section I clause-boundary chunking ──────────────────────────

    def test_section_i_chunked_at_clause_boundaries(self):
        """Section I should produce separate chunks per clause."""
        section_text = textwrap.dedent("""\
            SECTION I — CONTRACT CLAUSES

            52.202-1 Definitions (JUN 2020)
            This clause establishes the definitions. Short content here.

            52.212-4 Contract Terms and Conditions (NOV 2023)
            This clause sets forth terms. Also short content here.

            252.204-7012 Safeguarding Covered Defense Information (JAN 2023)
            The Contractor shall implement NIST SP 800-171 requirements.
        """)
        section = DetectedSection(
            section_type=SectionType.SECTION_I,
            start_char=0,
            end_char=len(section_text),
        )
        chunks = self.chunker.chunk_document(section_text, [section])

        # Should have chunks for each clause (plus possibly a header chunk)
        clause_chunks = [c for c in chunks if c.clause_number is not None]
        clause_numbers = [c.clause_number for c in clause_chunks]
        assert "52.202-1" in clause_numbers
        assert "52.212-4" in clause_numbers
        assert "252.204-7012" in clause_numbers

    def test_clause_number_correctly_extracted(self):
        """Each chunk in Section I should have the right clause_number."""
        section_text = textwrap.dedent("""\
            52.219-8 Utilization of Small Business Concerns (SEP 2023)
            The policy content here.

            52.222-50 Combating Trafficking in Persons (NOV 2021)
            The compliance content here.
        """)
        section = DetectedSection(
            section_type=SectionType.SECTION_I,
            start_char=0,
            end_char=len(section_text),
        )
        chunks = self.chunker.chunk_document(section_text, [section])
        clause_chunks = [c for c in chunks if c.clause_number]
        assert len(clause_chunks) == 2
        assert clause_chunks[0].clause_number == "52.219-8"
        assert clause_chunks[1].clause_number == "52.222-50"

    def test_long_clause_split_with_overlap(self):
        """A clause exceeding max_tokens should be split with overlap."""
        # Create a clause that's well above 600 words (max_tokens)
        long_para = "The contractor shall comply with this requirement. " * 120  # 7*120=840 words
        section_text = f"52.999-1 Very Long Clause (JAN 2025)\n{long_para}"
        section = DetectedSection(
            section_type=SectionType.SECTION_I,
            start_char=0,
            end_char=len(section_text),
        )
        chunks = self.chunker.chunk_document(section_text, [section])
        clause_chunks = [c for c in chunks if c.clause_number == "52.999-1"]

        # Should be split into multiple chunks
        assert len(clause_chunks) >= 2

        # All should reference the same parent clause
        for c in clause_chunks:
            assert c.clause_number == "52.999-1"
            assert c.metadata["parent_clause"] == "52.999-1"

    def test_overlap_chunks_share_text(self):
        """Adjacent chunks from a long clause should share overlapping text."""
        long_para = "Sentence number X is important for context. " * 80
        section_text = f"52.999-2 Another Long Clause (FEB 2025)\n{long_para}"
        section = DetectedSection(
            section_type=SectionType.SECTION_I,
            start_char=0,
            end_char=len(section_text),
        )
        chunks = self.chunker.chunk_document(section_text, [section])
        clause_chunks = [c for c in chunks if c.clause_number == "52.999-2"]

        if len(clause_chunks) >= 2:
            # Words from the end of chunk N should appear in the start of chunk N+1
            for i in range(len(clause_chunks) - 1):
                words_a = clause_chunks[i].chunk_text.split()
                words_b = clause_chunks[i + 1].chunk_text.split()
                # Last words of chunk A should overlap with first words of chunk B
                tail_a = set(words_a[-60:])
                head_b = set(words_b[:60])
                overlap = tail_a & head_b
                assert len(overlap) > 0, (
                    f"No overlap found between chunks {i} and {i + 1}"
                )

    # ─── Non-Section-I paragraph chunking ────────────────────────────

    def test_non_section_i_chunked_at_target_tokens(self):
        """Sections other than I should be chunked at ~500 tokens."""
        # ~600 words across 6 paragraphs
        paragraphs = []
        for i in range(6):
            paragraphs.append(f"Paragraph {i}. " + "This is filler content for the paragraph. " * 24)
        text = "\n\n".join(paragraphs)

        section = DetectedSection(
            section_type=SectionType.SECTION_C,
            start_char=0,
            end_char=len(text),
        )
        chunks = self.chunker.chunk_document(text, [section])
        assert len(chunks) >= 2
        for c in chunks:
            assert c.section_type == "SECTION_C"
            assert c.clause_number is None

    def test_no_chunk_exceeds_600_tokens(self):
        """Hard limit: no chunk should exceed 600 tokens (words)."""
        text = load_sample("sample_contract.txt")
        processor = DocumentProcessor(target_tokens=500, max_tokens=600)
        chunks = processor.process(text, "test-doc")
        for chunk in chunks:
            wc = chunk.metadata["word_count"]
            assert wc <= 600, (
                f"Chunk {chunk.chunk_index} has {wc} tokens, exceeds 600. "
                f"Section: {chunk.section_type}, Clause: {chunk.clause_number}"
            )


# ═══════════════════════════════════════════════════════════════════════
# DocumentProcessor tests
# ═══════════════════════════════════════════════════════════════════════


class TestDocumentProcessor:
    def setup_method(self):
        self.processor = DocumentProcessor()

    def test_full_pipeline_on_sample_contract(self):
        """Process the full sample contract and verify structure."""
        text = load_sample("sample_contract.txt")
        chunks = self.processor.process(text, "FA8726-24-C-0042")

        assert len(chunks) > 0

        # Should have chunks from multiple sections
        section_types = {c.section_type for c in chunks}
        assert "SECTION_A" in section_types
        assert "SECTION_I" in section_types

        # Section I chunks should have clause numbers
        section_i_with_clause = [
            c for c in chunks
            if c.section_type == "SECTION_I" and c.clause_number is not None
        ]
        assert len(section_i_with_clause) > 0

    def test_chunk_index_is_sequential(self):
        """chunk_index should be 0, 1, 2, ... with no gaps."""
        text = load_sample("sample_contract.txt")
        chunks = self.processor.process(text, "test-doc")
        indices = [c.chunk_index for c in chunks]
        assert indices == list(range(len(chunks)))

    def test_document_without_section_headers_fallback(self):
        """A document with no headers should fall back to paragraph chunking."""
        text = "First paragraph of content.\n\nSecond paragraph of content.\n\nThird paragraph."
        chunks = self.processor.process(text, "plain-doc")
        assert len(chunks) >= 1
        for c in chunks:
            assert c.section_type == "OTHER"

    def test_metadata_word_count_accurate(self):
        """word_count in metadata should match actual word count."""
        text = load_sample("sample_contract.txt")
        chunks = self.processor.process(text, "test-doc")
        for chunk in chunks:
            actual_wc = _word_count(chunk.chunk_text)
            assert chunk.metadata["word_count"] == actual_wc, (
                f"Chunk {chunk.chunk_index}: metadata says {chunk.metadata['word_count']}, "
                f"actual is {actual_wc}"
            )

    def test_metadata_char_count_accurate(self):
        """char_count in metadata should match actual character count."""
        text = load_sample("sample_contract.txt")
        chunks = self.processor.process(text, "test-doc")
        for chunk in chunks:
            actual_cc = len(chunk.chunk_text)
            assert chunk.metadata["char_count"] == actual_cc, (
                f"Chunk {chunk.chunk_index}: metadata says {chunk.metadata['char_count']}, "
                f"actual is {actual_cc}"
            )

    def test_document_id_in_metadata(self):
        """Each chunk should carry the document_id."""
        text = "SECTION A — TEST\n\nSome content here."
        chunks = self.processor.process(text, "DOC-001")
        for c in chunks:
            assert c.metadata["document_id"] == "DOC-001"

    def test_empty_document_returns_empty(self):
        chunks = self.processor.process("", "empty")
        assert chunks == []

    def test_single_page_document(self):
        """A short document with one section should produce at least one chunk."""
        text = "SECTION A — SHORT DOC\n\nThis is a brief contract."
        chunks = self.processor.process(text, "short")
        assert len(chunks) >= 1
        assert chunks[0].section_type == "SECTION_A"

    def test_sample_contract_section_i_clauses(self):
        """The sample contract's Section I should yield named clause chunks."""
        text = load_sample("sample_contract.txt")
        chunks = self.processor.process(text, "test")
        clause_numbers = [
            c.clause_number for c in chunks if c.clause_number is not None
        ]
        # The sample contract includes these clauses
        assert "52.202-1" in clause_numbers
        assert "52.212-4" in clause_numbers
        assert "252.204-7012" in clause_numbers
        assert "252.227-7014" in clause_numbers
