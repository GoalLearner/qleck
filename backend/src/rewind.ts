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
/** Answers one interview may change. Three is not a technical limit — it is
 *  the point past which the conversation is being rewritten rather than
 *  corrected, and every change spends two model calls. */
export const MAX_REWINDS = 3;

export type RewindPlan =
  /** This exact change already landed — answer with what is stored. */
  | { kind: 'replay' }
  | { kind: 'refused'; error: string; status: 400 | 409; extra?: Record<string, unknown> }
  /** The session as it was when that question was asked, with the question
   *  pending again. The caller runs the normal turn on it. */
  | {
      kind: 'rewind';
      transcript: string;
      clarify_turns: number;
      domain: string | null;
      needs_clarification: number;
      answers: string;
    };

/**
 * What changing the answer to question `index` means for the stored row.
 *
 * Pure, so the order of refusals is checkable without a database or a model.
 * That order matters: the replay check sits above the status check, so a
 * retried change whose turn produced the verdict replays the verdict instead
 * of being told the session is closed.
 */
export function planRewind(
  row: { status: string; transcript: string; rewinds?: number | null },
  index: number,
  answer: string,
): RewindPlan {
  const tx = parseTranscript(row.transcript);
  if (!tx) return { kind: 'refused', error: 'rewind_unavailable', status: 409 };
  if (!Number.isInteger(index) || index < 0 || index >= tx.length) {
    return { kind: 'refused', error: 'invalid_index', status: 400 };
  }
  if (answeredAt(row, index, answer)) return { kind: 'replay' };
  if (row.status !== 'open') return { kind: 'refused', error: 'session_not_open', status: 409 };
  // The question on screen is answered, not changed — that is /messages.
  if (index >= tx.length - 1) return { kind: 'refused', error: 'invalid_index', status: 400 };
  const entry = tx[index];
  if (entry.answer === undefined) return { kind: 'refused', error: 'invalid_index', status: 400 };
  if (entry.answer === answer) return { kind: 'refused', error: 'unchanged_answer', status: 400 };
  // Sessions from before 15 Sep carry no snapshot, so there is no honest
  // state to go back to. Refused rather than guessed.
  if (!entry.before) return { kind: 'refused', error: 'rewind_unavailable', status: 409 };
  if ((row.rewinds ?? 0) >= MAX_REWINDS) {
    return { kind: 'refused', error: 'rewind_cap', status: 409, extra: { max: MAX_REWINDS } };
  }
  const kept = tx.slice(0, index + 1).map((e, i) => (i === index ? { ...e } : e));
  delete kept[index].answer;
  return {
    kind: 'rewind',
    transcript: JSON.stringify(kept),
    clarify_turns: kept.length,
    domain: entry.before.domain ?? null,
    needs_clarification: entry.before.needs_clarification ?? 0,
    answers: JSON.stringify(entry.before.answers ?? {}),
  };
}

export function answeredAt(row: { status: string; transcript: string }, index: number, answer: string): boolean {
  if (!Number.isInteger(index) || index < 0) return false;
  const tx = parseTranscript(row.transcript);
  if (!tx || index >= tx.length) return false;
  if (tx[index]?.answer !== answer) return false;
  if (row.status === 'open') return tx.length === index + 2 && tx[index + 1]?.answer === undefined;
  if (row.status === 'verdict') return tx.length === index + 1;
  return false;
}
