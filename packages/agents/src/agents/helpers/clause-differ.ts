/**
 * ClauseDiffer — compares two sets of clauses and identifies changes.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface Clause {
  clauseNumber: string;
  clauseTitle: string;
  clauseType: "FAR" | "DFARS" | "AGENCY_SUPPLEMENT";
  text?: string;
}

export interface ClauseChange {
  clauseNumber: string;
  clauseTitle: string;
  clauseType: "FAR" | "DFARS" | "AGENCY_SUPPLEMENT";
  oldText?: string;
  newText?: string;
}

export interface ClauseDiff {
  added: Clause[];
  removed: Clause[];
  modified: ClauseChange[];
}

// ─── ClauseDiffer ────────────────────────────────────────────────────

export class ClauseDiffer {
  /**
   * Compare old and new clause sets.
   * - Added: in newClauses but not in oldClauses (by clauseNumber)
   * - Removed: in oldClauses but not in newClauses (by clauseNumber)
   * - Modified: same clauseNumber exists in both but text differs
   */
  compare(oldClauses: Clause[], newClauses: Clause[]): ClauseDiff {
    const oldMap = new Map<string, Clause>();
    for (const c of oldClauses) {
      oldMap.set(c.clauseNumber, c);
    }

    const newMap = new Map<string, Clause>();
    for (const c of newClauses) {
      newMap.set(c.clauseNumber, c);
    }

    const added: Clause[] = [];
    const removed: Clause[] = [];
    const modified: ClauseChange[] = [];

    // Find added and modified
    for (const [num, newClause] of newMap) {
      const oldClause = oldMap.get(num);
      if (!oldClause) {
        added.push(newClause);
      } else if (
        newClause.text !== undefined &&
        oldClause.text !== undefined &&
        newClause.text !== oldClause.text
      ) {
        modified.push({
          clauseNumber: num,
          clauseTitle: newClause.clauseTitle,
          clauseType: newClause.clauseType,
          oldText: oldClause.text,
          newText: newClause.text,
        });
      }
    }

    // Find removed
    for (const [num, oldClause] of oldMap) {
      if (!newMap.has(num)) {
        removed.push(oldClause);
      }
    }

    return { added, removed, modified };
  }
}
