"""
Comprehensive tests for rule-based entity extraction.

Tests each extractor individually with positive and negative cases,
plus integration tests for the full extract_all_entities orchestrator.
"""

import time

import pytest

from forge_nlp.extractors.rule_based import (
    EntityAnnotation,
    extract_all_entities,
    extract_cage_codes,
    extract_clins,
    extract_contract_numbers,
    extract_dates,
    extract_dfars_clauses,
    extract_dollar_amounts,
    extract_far_clauses,
    extract_naics_codes,
    extract_pop_ranges,
    extract_psc_codes,
    extract_security_levels,
    extract_uei_numbers,
)
from forge_nlp.extractors.test_data import load_sample


# ═══════════════════════════════════════════════════════════════════════
# 1. FAR_CLAUSE
# ═══════════════════════════════════════════════════════════════════════


class TestFarClause:
    def test_basic_far_clause(self):
        text = "The contractor shall comply with FAR 52.212-4."
        results = extract_far_clauses(text)
        assert len(results) == 1
        assert results[0].entity_type == "FAR_CLAUSE"
        assert results[0].entity_value == "52.212-4"
        assert results[0].confidence == 1.0

    def test_far_clause_with_alt_suffix(self):
        text = "Per FAR 52.219-8 Alt III, the contractor must submit."
        results = extract_far_clauses(text)
        assert len(results) == 1
        assert results[0].entity_value == "52.219-8 Alt III"
        assert results[0].metadata["alternate"] == "III"

    def test_far_clause_with_alternate_word(self):
        text = "See FAR 52.219-8 Alternate II for details."
        results = extract_far_clauses(text)
        assert len(results) == 1
        assert "Alternate II" in results[0].entity_value
        assert results[0].metadata["alternate"] == "II"

    def test_far_clause_with_deviation(self):
        text = "Apply FAR 52.243-1(Dev) as modified."
        results = extract_far_clauses(text)
        assert len(results) == 1
        assert "(Dev)" in results[0].entity_value
        assert results[0].metadata.get("deviation") is True

    def test_multiple_far_clauses_in_list(self):
        text = "Applicable clauses: 52.212-4, 52.219-8, and 52.232-22."
        results = extract_far_clauses(text)
        assert len(results) == 3
        values = {r.entity_value for r in results}
        assert values == {"52.212-4", "52.219-8", "52.232-22"}

    def test_far_clause_span_correct(self):
        text = "See FAR 52.212-4 for terms."
        results = extract_far_clauses(text)
        assert len(results) == 1
        assert text[results[0].start_char:results[0].end_char] == "52.212-4"

    def test_no_false_positive_non_far(self):
        """Strings that look like clause numbers but aren't FAR (not 52.xxx)."""
        text = "Reference 99.212-4 and section 12.345-6."
        results = extract_far_clauses(text)
        assert len(results) == 0

    def test_no_false_positive_partial_number(self):
        text = "Phone number is 52.2124 and zip is 52212."
        results = extract_far_clauses(text)
        assert len(results) == 0


# ═══════════════════════════════════════════════════════════════════════
# 2. DFARS_CLAUSE
# ═══════════════════════════════════════════════════════════════════════


class TestDfarsClause:
    def test_basic_dfars_clause(self):
        text = "Per DFARS 252.204-7012, safeguarding is required."
        results = extract_dfars_clauses(text)
        assert len(results) == 1
        assert results[0].entity_value == "252.204-7012"

    def test_dfars_with_alt(self):
        text = "DFARS 252.227-7013 Alt II applies."
        results = extract_dfars_clauses(text)
        assert len(results) == 1
        assert results[0].entity_value == "252.227-7013 Alt II"
        assert results[0].metadata["alternate"] == "II"

    def test_dfars_with_deviation(self):
        text = "Apply 252.204-7012(Dev) with deviation."
        results = extract_dfars_clauses(text)
        assert len(results) == 1
        assert results[0].metadata.get("deviation") is True

    def test_no_false_positive(self):
        text = "Reference 352.204-7012 is not DFARS."
        results = extract_dfars_clauses(text)
        assert len(results) == 0


# ═══════════════════════════════════════════════════════════════════════
# 3. CONTRACT_NUMBER
# ═══════════════════════════════════════════════════════════════════════


class TestContractNumber:
    def test_army_format(self):
        text = "Contract W911NF-23-C-0019 is awarded."
        results = extract_contract_numbers(text)
        assert len(results) == 1
        assert results[0].entity_value == "W911NF-23-C-0019"
        assert results[0].metadata["agency_format"] == "Army"

    def test_navy_format(self):
        text = "Under contract N00024-24-D-4275."
        results = extract_contract_numbers(text)
        assert len(results) == 1
        assert results[0].entity_value == "N00024-24-D-4275"
        assert results[0].metadata["agency_format"] == "Navy"

    def test_air_force_format(self):
        text = "USAF contract FA8726-24-C-0042."
        results = extract_contract_numbers(text)
        assert len(results) == 1
        assert results[0].entity_value == "FA8726-24-C-0042"
        assert results[0].metadata["agency_format"] == "Air Force"

    def test_gsa_format(self):
        text = "GSA Schedule GS-35F-0119Y is referenced."
        results = extract_contract_numbers(text)
        assert len(results) == 1
        assert results[0].entity_value == "GS-35F-0119Y"
        assert results[0].metadata["agency_format"] == "GSA"

    def test_generic_format(self):
        text = "Contract HHSN26-21-C-0050 is active."
        results = extract_contract_numbers(text)
        assert len(results) == 1
        assert results[0].entity_value == "HHSN26-21-C-0050"

    def test_no_duplicate_from_generic(self):
        """Specific patterns should not also match as Generic."""
        text = "Contract FA8726-24-C-0042 awarded."
        results = extract_contract_numbers(text)
        assert len(results) == 1
        assert results[0].metadata["agency_format"] == "Air Force"

    def test_no_false_positive(self):
        text = "Serial number AB-12-C-3456 is not a contract."
        results = extract_contract_numbers(text)
        assert len(results) == 0


# ═══════════════════════════════════════════════════════════════════════
# 4. NAICS_CODE
# ═══════════════════════════════════════════════════════════════════════


class TestNaicsCode:
    def test_labeled_naics(self):
        text = "NAICS Code: 541512"
        results = extract_naics_codes(text)
        assert len(results) == 1
        assert results[0].entity_value == "541512"
        assert results[0].metadata["labeled"] is True

    def test_naics_without_code_word(self):
        text = "NAICS: 541330"
        results = extract_naics_codes(text)
        assert len(results) == 1
        assert results[0].entity_value == "541330"

    def test_naics_does_not_match_phone_numbers(self):
        text = "Call us at (703) 555-0142 or 703-555-0142 for NAICS info."
        results = extract_naics_codes(text)
        assert len(results) == 0

    def test_naics_does_not_match_zip_codes(self):
        text = "Located at 22030-4521, zip code area."
        results = extract_naics_codes(text)
        assert len(results) == 0

    def test_naics_does_not_match_random_6_digits(self):
        text = "Reference number 123456 in section 5."
        results = extract_naics_codes(text)
        assert len(results) == 0

    def test_naics_in_proximity(self):
        """6-digit number near 'NAICS' text should match."""
        text = "The applicable NAICS for this procurement is 336411."
        results = extract_naics_codes(text)
        assert len(results) == 1
        assert results[0].entity_value == "336411"


# ═══════════════════════════════════════════════════════════════════════
# 5. PSC_CODE
# ═══════════════════════════════════════════════════════════════════════


class TestPscCode:
    def test_labeled_psc(self):
        text = "PSC: D307"
        results = extract_psc_codes(text)
        assert len(results) == 1
        assert results[0].entity_value == "D307"

    def test_product_service_code_label(self):
        text = "Product Service Code: R425"
        results = extract_psc_codes(text)
        assert len(results) == 1
        assert results[0].entity_value == "R425"

    def test_no_false_positive_without_label(self):
        text = "Code D307 appears without PSC label."
        results = extract_psc_codes(text)
        assert len(results) == 0


# ═══════════════════════════════════════════════════════════════════════
# 6. CAGE_CODE
# ═══════════════════════════════════════════════════════════════════════


class TestCageCode:
    def test_labeled_cage(self):
        text = "CAGE Code: 1ABC2"
        results = extract_cage_codes(text)
        assert len(results) == 1
        assert results[0].entity_value == "1ABC2"

    def test_cage_without_code_word(self):
        text = "CAGE: 3XY4Z"
        results = extract_cage_codes(text)
        assert len(results) == 1
        assert results[0].entity_value == "3XY4Z"

    def test_no_false_positive_without_label(self):
        text = "The value 1ABC2 without CAGE label."
        results = extract_cage_codes(text)
        assert len(results) == 0


# ═══════════════════════════════════════════════════════════════════════
# 7. UEI_NUMBER
# ═══════════════════════════════════════════════════════════════════════


class TestUeiNumber:
    def test_labeled_uei(self):
        text = "UEI: HJ7K9LM2N3P4"
        results = extract_uei_numbers(text)
        assert len(results) == 1
        assert results[0].entity_value == "HJ7K9LM2N3P4"

    def test_unique_entity_id_label(self):
        text = "Unique Entity ID: AB1CD2EF3GH4"
        results = extract_uei_numbers(text)
        assert len(results) == 1
        assert results[0].entity_value == "AB1CD2EF3GH4"

    def test_no_false_positive_without_label(self):
        text = "Random string HJ7K9LM2N3P4 with no label."
        results = extract_uei_numbers(text)
        assert len(results) == 0


# ═══════════════════════════════════════════════════════════════════════
# 8. DOLLAR_AMOUNT
# ═══════════════════════════════════════════════════════════════════════


class TestDollarAmount:
    def test_basic_dollar(self):
        text = "Total value is $4,500,000.00."
        results = extract_dollar_amounts(text)
        assert len(results) == 1
        assert results[0].metadata["normalized_value"] == 4_500_000.00

    def test_dollar_with_m_suffix(self):
        text = "Funded amount of $1.2M."
        results = extract_dollar_amounts(text)
        assert len(results) == 1
        assert results[0].metadata["normalized_value"] == 1_200_000.0

    def test_dollar_with_b_suffix(self):
        text = "Program ceiling $4.5B."
        results = extract_dollar_amounts(text)
        assert len(results) == 1
        assert results[0].metadata["normalized_value"] == 4_500_000_000.0

    def test_usd_prefix(self):
        text = "Estimated value USD 1,800,000."
        results = extract_dollar_amounts(text)
        assert len(results) == 1
        assert results[0].metadata["normalized_value"] == 1_800_000.0

    def test_multiple_amounts(self):
        text = "From $500,000.00 increased to $2,800,000.00."
        results = extract_dollar_amounts(text)
        assert len(results) == 2

    def test_normalization_1_2m(self):
        """$1.2M should normalize to 1200000.0"""
        text = "Amount: $1.2M"
        results = extract_dollar_amounts(text)
        assert len(results) == 1
        assert results[0].metadata["normalized_value"] == pytest.approx(1_200_000.0)


# ═══════════════════════════════════════════════════════════════════════
# 9. DATE
# ═══════════════════════════════════════════════════════════════════════


class TestDate:
    def test_dmy_format(self):
        text = "Effective 01 January 2026."
        results = extract_dates(text)
        assert len(results) == 1
        assert results[0].metadata["iso_date"] == "2026-01-01"

    def test_mdy_format(self):
        text = "Signed on January 1, 2026."
        results = extract_dates(text)
        assert len(results) == 1
        assert results[0].metadata["iso_date"] == "2026-01-01"

    def test_iso_format(self):
        text = "Start date: 2025-04-01."
        results = extract_dates(text)
        assert len(results) == 1
        assert results[0].metadata["iso_date"] == "2025-04-01"

    def test_us_format(self):
        text = "Due by 01/01/2026."
        results = extract_dates(text)
        assert len(results) == 1
        assert results[0].metadata["iso_date"] == "2026-01-01"

    def test_us_format_no_padding(self):
        text = "Due by 1/1/2026."
        results = extract_dates(text)
        assert len(results) == 1
        assert results[0].metadata["iso_date"] == "2026-01-01"

    def test_date_normalization_to_iso(self):
        """All date formats normalize to ISO 8601."""
        texts = [
            ("15 March 2025", "2025-03-15"),
            ("March 15, 2025", "2025-03-15"),
            ("2025-03-15", "2025-03-15"),
            ("03/15/2025", "2025-03-15"),
        ]
        for text, expected in texts:
            results = extract_dates(text)
            assert len(results) == 1, f"Failed for: {text}"
            assert results[0].metadata["iso_date"] == expected, f"Failed for: {text}"

    def test_invalid_date_rejected(self):
        text = "Date 13/32/2025 is invalid."
        results = extract_dates(text)
        assert len(results) == 0

    def test_no_false_positive_non_date(self):
        text = "Version 3.2 of the specification."
        results = extract_dates(text)
        assert len(results) == 0


# ═══════════════════════════════════════════════════════════════════════
# 10. POP_RANGE
# ═══════════════════════════════════════════════════════════════════════


class TestPopRange:
    def test_through_format(self):
        text = "Period: 01 Feb 2025 through 31 Jan 2026."
        results = extract_pop_ranges(text)
        assert len(results) == 1
        assert results[0].metadata["start_date"] == "2025-02-01"
        assert results[0].metadata["end_date"] == "2026-01-31"

    def test_from_to_format(self):
        text = "Performance from 2025-04-01 to 2026-03-31."
        results = extract_pop_ranges(text)
        assert len(results) == 1
        assert results[0].metadata["start_date"] == "2025-04-01"
        assert results[0].metadata["end_date"] == "2026-03-31"

    def test_pop_with_us_dates(self):
        text = "POP: 01/01/2026 to 12/31/2026"
        results = extract_pop_ranges(text)
        assert len(results) == 1
        assert results[0].metadata["start_date"] == "2026-01-01"
        assert results[0].metadata["end_date"] == "2026-12-31"

    def test_pop_extracts_start_and_end(self):
        text = "from January 1, 2025 to December 31, 2025"
        results = extract_pop_ranges(text)
        assert len(results) == 1
        assert results[0].metadata["start_date"] == "2025-01-01"
        assert results[0].metadata["end_date"] == "2025-12-31"

    def test_dash_separator(self):
        text = "POP: 01 Mar 2025 - 28 Feb 2026"
        results = extract_pop_ranges(text)
        assert len(results) == 1
        assert results[0].metadata["start_date"] == "2025-03-01"
        assert results[0].metadata["end_date"] == "2026-02-28"


# ═══════════════════════════════════════════════════════════════════════
# 11. SECURITY_LEVEL
# ═══════════════════════════════════════════════════════════════════════


class TestSecurityLevel:
    def test_secret(self):
        text = "Classification: SECRET"
        results = extract_security_levels(text)
        assert len(results) == 1
        assert results[0].entity_value == "SECRET"

    def test_cui(self):
        text = "Marking: CUI"
        results = extract_security_levels(text)
        assert len(results) == 1
        assert results[0].entity_value == "CUI"

    def test_controlled_unclassified_info(self):
        text = "Treated as Controlled Unclassified Information per policy."
        results = extract_security_levels(text)
        assert len(results) == 1
        assert results[0].entity_value == "CUI"

    def test_top_secret(self):
        text = "Classified at TOP SECRET level."
        results = extract_security_levels(text)
        assert len(results) == 1
        assert results[0].entity_value == "TOP_SECRET"

    def test_ts_sci(self):
        text = "Requires TS/SCI clearance."
        results = extract_security_levels(text)
        assert len(results) == 1
        assert results[0].entity_value == "TS/SCI"

    def test_fouo(self):
        text = "Marked FOUO."
        results = extract_security_levels(text)
        assert len(results) == 1
        assert results[0].entity_value == "FOUO"

    def test_for_official_use_only(self):
        text = "Treated as For Official Use Only."
        results = extract_security_levels(text)
        assert len(results) == 1
        assert results[0].entity_value == "FOUO"

    def test_unclassified(self):
        text = "Document is UNCLASSIFIED."
        results = extract_security_levels(text)
        assert len(results) == 1
        assert results[0].entity_value == "UNCLASSIFIED"

    def test_top_secret_no_false_secret(self):
        """TOP SECRET should not also produce a SECRET match."""
        text = "Classification: TOP SECRET"
        results = extract_security_levels(text)
        assert len(results) == 1
        assert results[0].entity_value == "TOP_SECRET"


# ═══════════════════════════════════════════════════════════════════════
# 12. CLIN
# ═══════════════════════════════════════════════════════════════════════


class TestClin:
    def test_basic_clin(self):
        text = "CLIN 0001 — Program Management"
        results = extract_clins(text)
        assert len(results) == 1
        assert results[0].entity_value == "0001"

    def test_clin_with_alpha_suffix(self):
        text = "CLIN 0002AA — Software Development"
        results = extract_clins(text)
        assert len(results) == 1
        assert results[0].entity_value == "0002AA"

    def test_multiple_clins(self):
        text = "CLIN 0001, CLIN 0002AA, and CLIN 0003."
        results = extract_clins(text)
        assert len(results) == 3

    def test_no_false_positive(self):
        text = "The clinical trial data."
        results = extract_clins(text)
        assert len(results) == 0


# ═══════════════════════════════════════════════════════════════════════
# Integration: extract_all_entities
# ═══════════════════════════════════════════════════════════════════════


class TestExtractAllEntities:
    def test_realistic_contract_paragraph(self):
        """A realistic paragraph containing at least 6 entity types."""
        text = (
            "Contract FA8726-24-C-0042 is awarded under FAR 52.212-4 and "
            "DFARS 252.204-7012. The total ceiling is $4,500,000.00 with "
            "NAICS Code: 541512 and PSC: D307. The period of performance is "
            "01 Feb 2025 through 31 Jan 2026. Security level: SECRET. "
            "CAGE Code: 1ABC2. CLIN 0001 covers program management."
        )
        results = extract_all_entities(text)

        types_found = {r.entity_type for r in results}
        assert "CONTRACT_NUMBER" in types_found
        assert "FAR_CLAUSE" in types_found
        assert "DFARS_CLAUSE" in types_found
        assert "DOLLAR_AMOUNT" in types_found
        assert "NAICS_CODE" in types_found
        assert "PSC_CODE" in types_found
        assert "POP_RANGE" in types_found
        assert "SECURITY_LEVEL" in types_found
        assert "CAGE_CODE" in types_found
        assert "CLIN" in types_found
        assert len(types_found) >= 6

    def test_results_sorted_by_start_char(self):
        text = (
            "See FAR 52.212-4 and DFARS 252.204-7012 in contract "
            "FA8726-24-C-0042 valued at $1.5M."
        )
        results = extract_all_entities(text)
        starts = [r.start_char for r in results]
        assert starts == sorted(starts)

    def test_results_deduplicated(self):
        """Same entity should not appear twice."""
        text = "FAR 52.212-4 is referenced in FAR 52.212-4 again."
        results = extract_all_entities(text)
        far_results = [r for r in results if r.entity_type == "FAR_CLAUSE"]
        # Two occurrences at different positions = two annotations
        assert len(far_results) == 2
        # But they should have different start_chars
        assert far_results[0].start_char != far_results[1].start_char

    def test_sample_award_file(self):
        """Test against the sample_award.txt test data file."""
        text = load_sample("sample_award.txt")
        results = extract_all_entities(text)
        types_found = {r.entity_type for r in results}
        assert "CONTRACT_NUMBER" in types_found
        assert "FAR_CLAUSE" in types_found
        assert "DFARS_CLAUSE" in types_found
        assert "DOLLAR_AMOUNT" in types_found
        assert "SECURITY_LEVEL" in types_found
        assert "CLIN" in types_found

    def test_sample_modification_file(self):
        text = load_sample("sample_modification.txt")
        results = extract_all_entities(text)
        types_found = {r.entity_type for r in results}
        assert "CONTRACT_NUMBER" in types_found
        assert "FAR_CLAUSE" in types_found
        assert "DOLLAR_AMOUNT" in types_found
        assert "DATE" in types_found or "POP_RANGE" in types_found

    def test_sample_nda_file(self):
        text = load_sample("sample_nda.txt")
        results = extract_all_entities(text)
        types_found = {r.entity_type for r in results}
        assert "CONTRACT_NUMBER" in types_found
        assert "UEI_NUMBER" in types_found
        assert "CAGE_CODE" in types_found

    def test_overlapping_boundaries_handled(self):
        """Entities that share boundaries should both be extracted."""
        text = "Under DFARS 252.204-7012 and FAR 52.204-21, contract W911NF-23-C-0019."
        results = extract_all_entities(text)
        types_found = {r.entity_type for r in results}
        assert "DFARS_CLAUSE" in types_found
        assert "FAR_CLAUSE" in types_found
        assert "CONTRACT_NUMBER" in types_found
        # All entities should have non-overlapping spans within same type
        for etype in types_found:
            typed = [r for r in results if r.entity_type == etype]
            for i in range(len(typed) - 1):
                assert typed[i].end_char <= typed[i + 1].start_char, (
                    f"Overlap in {etype}: {typed[i]} and {typed[i + 1]}"
                )

    def test_performance_large_document(self):
        """250,000 char document should complete in under 5 seconds."""
        # Build a ~250k char document by repeating realistic contract text
        base_paragraph = (
            "Contract FA8726-24-C-0042 is awarded under FAR 52.212-4 and "
            "DFARS 252.204-7012. The total ceiling is $4,500,000.00. "
            "NAICS Code: 541512. PSC: D307. CAGE Code: 1ABC2. "
            "Period of performance: 01 Feb 2025 through 31 Jan 2026. "
            "Security: SECRET. CLIN 0001 covers PM. UEI: HJ7K9LM2N3P4. "
            "The contractor shall comply with all terms and conditions as set "
            "forth herein and in the applicable Federal Acquisition Regulation "
            "clauses incorporated by reference or full text. All deliverables "
            "shall be submitted in accordance with the Contract Data Requirements "
            "List (CDRL). The Government reserves the right to exercise option "
            "periods as specified in the schedule.\n\n"
        )
        # Each paragraph is ~567 chars; need ~441 repetitions for 250k
        repetitions = (250_000 // len(base_paragraph)) + 1
        large_text = base_paragraph * repetitions
        assert len(large_text) >= 250_000

        start = time.perf_counter()
        results = extract_all_entities(large_text)
        elapsed = time.perf_counter() - start

        assert elapsed < 5.0, f"Took {elapsed:.2f}s, expected < 5s"
        assert len(results) > 0
