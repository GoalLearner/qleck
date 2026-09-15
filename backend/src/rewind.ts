/**
 * The interview transcript, turn by turn — import-free so the harness can
 * check it without a model (`npm run check:rewind`).
 *
 * Until 15 Sep nothing on the server remembered the interview turn by turn:
 * the structured answers were one merged object that only ever grew, the
 * answer chips were never stored, and a question's entry held only its text.
 * That made "go back and change an earlier answer" impossible to do honestly —
 * there was no record of what Qoach knew when it asked question 2.
 *
 * So every question entry now records, at the moment it is asked:
 *   - `suggested`: the answer chips exactly as delivered, and
 *   - `before`: the structured state the question was chosen from
 *     (domain, needs_clarification, answers).
 * A rewind to question k restores entry k's `before`, drops everything after
 * it, and runs the normal turn with the new answer — the extraction merges on
 * top of `before`, so the progress gate sees the same delta the original turn
 * did. Neither field ever reaches a model: every reader of the transcript
 * reads only `question`, `why` and `answer`.
 */

export interface StructureSnapshot {
  domain: string | null;
  needs_clarification: number;
  answers: Record<string, string>;
}

export interface TranscriptEntry {
  question: string;
  why: string;
  answer?: string;
  /** The answer chips as delivered (15 Sep). Missing on older entries. */
  suggested?: string[];
  /** The structured state this question was chosen from (15 Sep). */
  before?: StructureSnapshot;
}

function parseAnswers(raw: string | null | undefined): Record<string, string> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, string>) } : {};
  } catch { return {}; }
}

/** The entry for a question about to be pushed, with its snapshot. */
export function entryFor(
  q: { question: string; why_it_matters: string; suggested_answers?: string[] },
  session: { domain: string | null; needs_clarification: number; answers: string },
): TranscriptEntry {
  return {
    question: q.question,
    why: q.why_it_matters,
    suggested: Array.isArray(q.suggested_answers) ? [...q.suggested_answers] : [],
    before: {
      domain: session.domain ?? null,
      needs_clarification: session.needs_clarification ?? 0,
      answers: parseAnswers(session.answers),
    },
  };
}

export function parseTranscript(raw: string): TranscriptEntry[] | null {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as TranscriptEntry[]) : null;
  } catch { return null; }
}

/**
 * Has the answer `answer` to entry `index` already landed in this stored row?
 * True when a retried or duplicated request would change nothing: the entry
 * carries exactly this answer and the turn it produced is what's stored — one
 * pending question after it (still open), or it is the last entry and the
 * interview has reached its verdict. Everything else is false, including a
 * corrupt transcript (never throws).
 */
export function answeredAt(row: { status: string; transcript: string }, index: number, answer: string): boolean {
  if (!Number.isInteger(index) || index < 0) return false;
  const tx = parseTranscript(row.transcript);
  if (!tx || index >= tx.length) return false;
  if (tx[index]?.answer !== answer) return false;
  if (row.status === 'open') return tx.length === index + 2 && tx[index + 1]?.answer === undefined;
  if (row.status === 'verdict') return tx.length === index + 1;
  return false;
}
