// Goals — "the plan, without the wall", ported from the Claude Design canvas
// `Qleck Goals.dc.html`. Two levels: a calm shelf (one card per system with
// where you are and what today costs) → a detail view (the goal in its own
// words, the week track, and the phases as an accordion — only the phase
// you're living in opens with full reps; the rest fold to one row each).
// One readable column serves phone and desktop alike.
//
// Dropping a goal stays an explicit, two-tap act — never a side effect of
// adding another. "Tweak it with Qoach" wires to the P4 revise client; for
// now it opens the AdjustPlan modal.
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useAppearance } from '../state/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import YouAvatar from '../components/YouAvatar';
import { goalDot, goalTitle, kindLook } from '../components/protocolViews';
import { RepSheet, freqChip, hasHowTo } from '../components/RepSheet';
import type { ProtocolPhase, ProtocolStep } from '../api/coachTypes';
import { apiBase, localDate } from '../api/device';
import { oddsTier, phaseForWeek, planEndDate, planIsOver, reforecastOdds, repsForDate, weekOf, type Reforecast } from '../lib/protocolTime';
import { laterVersions } from '../lib/ticks';
import { planShape, plural } from '../lib/copy';
import { isTestGoal } from '../lib/testGoal';
import { Pop } from '../onboarding/ui';
import { useRally, type ActiveGoal } from '../state/RallyContext';
import { colors, fonts } from '../theme';


const COUNT_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five'];

function wkLabel(p: ProtocolPhase): string {
  return p.start_week === p.end_week ? `WEEK ${p.start_week}` : `WK ${p.start_week}–${p.end_week}`;
}

// The rep's cost as a quiet chip: "20 min · 3/wk", "45 min · daily", "weekly".
/* ── the week track: one cell per plan week ─────────────────────────────── */

/**
 * Plan progress. One cell per week reads beautifully for a 4-week plan and
 * breaks completely for a 52-week one: 52 cells plus their gaps need ~300px
 * and the shelf gives it 90, so the row ran off the card. Past ~14 weeks the
 * cells would be sub-pixel anyway, so long plans get a continuous bar instead
 * — same information, honest at any length.
 */
const MAX_CELLS = 14;

function WeekTrack({ weeks, week, filled, done = false }: {
  weeks: number; week: number; filled: boolean; done?: boolean;
}) {
  const height = filled ? 5 : 6;

  if (weeks > MAX_CELLS) {
    const frac = done ? 1 : Math.min(1, Math.max(0, (week - 1) / weeks));
    return (
      <View
        style={{
          flex: 1, height, borderRadius: 3, overflow: 'hidden',
          backgroundColor: filled ? colors.borderStrong : 'transparent',
          borderWidth: filled ? 0 : 1, borderColor: colors.outline,
        }}
      >
        <View
          style={{
            width: `${Math.max(frac * 100, done ? 100 : 2)}%`,
            height, borderRadius: 3,
            backgroundColor: done ? colors.success : colors.ink,
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: filled ? 4 : 5 }}>
      {Array.from({ length: weeks }, (_, i) => {
        // weekOf clamps at the duration, so the final cell would otherwise sit
        // on "current" forever and the track could never fill.
        const past = done || i < week - 1;
        const now = !done && i === week - 1;
        return (
          <View
            key={i}
            style={{
              flex: 1, minWidth: 0, height, borderRadius: 3, borderWidth: 1,
              backgroundColor: past ? colors.success : filled && now ? colors.ink : 'transparent',
              borderColor: past
                ? colors.success
                : filled
                  ? colors.borderStrong
                  : now ? colors.ink : colors.outline,
              ...(filled && !past && !now ? { backgroundColor: colors.borderStrong } : null),
            }}
          />
        );
      })}
    </View>
  );
}

/* ── level one: the shelf ───────────────────────────────────────────────── */

interface GoalModel {
  goal: ActiveGoal;
  dot: string;
  week: number;
  nowIdx: number;
  phase: ProtocolPhase;
  repsToday: number;
  /** Accepted odds re-forecast against actual adherence; null without odds. */
  rf: Reforecast | null;
  /** The plan's weeks have run out: it is finished, not on week N of N. */
  ended: boolean;
}

function GoalCard({ m, onOpen, onSeeHow }: { m: GoalModel; onOpen: () => void; onSeeHow?: () => void }) {
  // A paused goal schedules nothing — it must not read as running (P4).
  const paused = m.goal.status === 'paused';
  // A plan whose weeks have run out is not "week 6 of 6, one rep today": it
  // is finished, and the only useful thing on this card is the way into how
  // it went. Today already knew this; Goals did not.
  const ended = m.ended;
  // Every goal is private until you share it, and a shared one used to look
  // exactly like a private one here — you had to open the goal to find out.
  // These goals are intimate; whether somebody else can see this one is not a
  // detail to go hunting for. This is the whole of "public or private": there
  // is no public, only you and at most one person you handed a link to.
  const shared = !!m.goal.shareToken;
  return (
    <Pressable
      onPress={onOpen}
      style={{
        backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: 26, paddingVertical: 20, paddingHorizontal: 22,
        opacity: paused ? 0.62 : 1,
      }}
    >
      {(paused || shared || ended || isTestGoal(m.goal)) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {isTestGoal(m.goal) && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.outline }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 9.5, letterSpacing: 1.3, color: colors.muted }}>
                TEST PLAN
              </Text>
            </View>
          )}
          {ended && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.successBg }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 9.5, letterSpacing: 1.3, color: colors.success }}>
                PLAN COMPLETE
              </Text>
            </View>
          )}
          {paused && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.outline }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 9.5, letterSpacing: 1.3, color: colors.muted }}>
                PAUSED — NOTHING SCHEDULED
              </Text>
            </View>
          )}
          {shared && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.successBg }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 9.5, letterSpacing: 1.3, color: colors.success }}>
                SHARED — ONE LINK IS LIVE
              </Text>
            </View>
          )}
        </View>
      )}
      {/* one title, once: the serif line carries the goal; the dot is its
          color key (owner call 2026-08-25 — the caps name was redundant) */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.dot, marginTop: 8 }} />
        <Text style={{ flex: 1, fontFamily: fonts.serif, fontSize: 17, lineHeight: 23.8, color: colors.ink }}>
          {goalTitle(m.goal.statement, m.goal.protocol)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.2, color: colors.sectionLabel }}>
            {ended ? `${plural(m.goal.protocol.duration_weeks, 'WEEK')}, DONE` : `WEEK ${m.week} OF ${m.goal.protocol.duration_weeks}`}
          </Text>
          <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: colors.sectionLabel }}>›</Text>
        </View>
      </View>
      {/* flexWrap: three chips + the week track overflowed the card when a
          phase title ran long ("Solid odds · 85%" clipped off the edge). */}
      {ended ? (
        <Pressable onPress={onSeeHow} style={{ marginTop: 14, alignSelf: 'flex-start' }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.accentLink }}>See how it went \u203a</Text>
        </Pressable>
      ) : (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <View style={{ maxWidth: '100%', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.successBg }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.success }}>Now: {m.phase.title}</Text>
        </View>
        <View style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.chipBg }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.muted }}>
            {m.repsToday} {m.repsToday === 1 ? 'rep' : 'reps'} today
          </Text>
        </View>
        {/* The accepted odds, re-forecast against how the plan is actually
            going (derived, never stored). Green while holding; amber with the
            drop spelled out when recent weeks slipped. Absent on goals from
            before the odds existed. */}
        {m.rf ? (
          <View style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: m.rf.drifted ? colors.inviteBg : colors.successBg }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 11, color: m.rf.drifted ? colors.inviteAccent : colors.success }}>
              {m.rf.drifted ? `was ${m.rf.original} · now ${m.rf.current}%` : `${oddsTier(m.rf.current).label} · ${m.rf.current}%`}
            </Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={{ width: 90, flexDirection: 'row' }}>
          <WeekTrack weeks={m.goal.protocol.duration_weeks} week={m.week} filled />
        </View>
      </View>
      )}
    </Pressable>
  );
}

/* ── level two: the detail with the phase accordion ─────────────────────── */

/**
 * Manifest keys are written for the model ("training_days_per_week"). Nothing
 * in the app has ever had to say them out loud before, so there is no existing
 * label map — every other surface just does key.replace(/_/g, ' ').
 *
 * These read as the user's own words, because that is the whole claim being
 * made: "you told us". Anything unmapped falls back to the de-underscored key,
 * which is unlovely but never wrong.
 */
/**
 * The rep as a row (design handoff turn 2, 2026-09-01). It used to render
 * `details` in full under the title, so a real instruction — five gym days, the
 * warm-up rule, the reason behind it — became a paragraph crammed into a list
 * item, cut off mid-sentence, reading as a blob.
 *
 * The row now stays short: title, a two-line gist, and a way in. The
 * instructions get a home of their own in RepSheet.
 */
function RepRow({ step, onOpen }: { step: ProtocolStep; onOpen?: () => void }) {
  const look = kindLook(step.kind);
  const more = hasHowTo(step);
  const gist = step.how_to?.gist || step.details;
  // Every rep opens its sheet now, how-to or not: the sheet is where "Not for
  // me" lives, and a rep whose instructions fit in a sentence was the one you
  // could not get at.
  const retired = typeof step.retired_from_week === 'number';
  return (
    <Pressable
      onPress={retired ? undefined : onOpen}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 11, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: colors.chipBg, opacity: retired ? 0.5 : 1 }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 10, backgroundColor: look.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, color: look.fg }}>{look.glyph}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 14, lineHeight: 18.2, color: colors.ink, textDecorationLine: retired ? 'line-through' : 'none' }}>{step.title}</Text>
        {retired ? (
          <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: colors.muted, marginTop: 4 }}>
            Dropped in week {step.retired_from_week}
          </Text>
        ) : null}
        {!retired && !!gist && (
          <Text numberOfLines={2} style={{ fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 3 }}>
            {gist}
          </Text>
        )}
        {more && !retired ? (
          <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: colors.success, marginTop: 5 }}>How to do it ›</Text>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.chipBg, marginTop: 4 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 10.5, color: colors.muted }}>{freqChip(step)}</Text>
      </View>
    </Pressable>
  );
}

function PhaseCard({ goal, phase, now, open, onToggle, onOpenStep }: {
  goal: ActiveGoal; phase: ProtocolPhase; now: boolean; open: boolean; onToggle: () => void;
  onOpenStep: (step: ProtocolStep, phaseLabel: string) => void;
}) {
  const phaseLabel = `${phase.title} · WK ${phase.start_week}–${phase.end_week}`;
  const milestones = goal.protocol.milestones
    .filter(mi => mi.week >= phase.start_week && mi.week <= phase.end_week)
    .sort((a, b) => a.week - b.week);
  return (
    <View
      style={{
        backgroundColor: colors.card, borderWidth: 1, borderRadius: 26, overflow: 'hidden',
        borderColor: now ? colors.successBorder : colors.border,
      }}
    >
      <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 20 }}>
        <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: now ? colors.successBg : colors.chipBg }}>
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 1, color: now ? colors.success : colors.sectionLabel }}>{wkLabel(phase)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.serif, fontSize: 16.5, lineHeight: 20.6, color: now ? colors.ink : colors.inkSoft }}>{phase.title}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.sectionLabel, marginTop: 2 }}>{phase.focus}</Text>
        </View>
        {now ? (
          <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.successBg }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 1, color: colors.success }}>NOW</Text>
          </View>
        ) : (
          <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: colors.sectionLabel }}>{phase.steps.length} reps</Text>
        )}
        <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: colors.sectionLabel, width: 12, textAlign: 'center' }}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && phase.steps.map(step => (
        <RepRow key={step.id} step={step} onOpen={() => onOpenStep(step, phaseLabel)} />
      ))}
      {open && milestones.map(mi => (
        <View
          key={mi.id}
          style={{
            marginHorizontal: 14, marginBottom: 14, marginTop: 10,
            flexDirection: 'row', alignItems: 'baseline', gap: 9,
            backgroundColor: colors.inviteBg, borderWidth: 1, borderColor: colors.inviteBorder,
            borderRadius: 16, paddingVertical: 11, paddingHorizontal: 15,
          }}
        >
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, color: colors.inviteAccent }}>⚑</Text>
          <Text style={{ flexShrink: 1, fontFamily: fonts.serif, fontSize: 14, lineHeight: 18.2, color: colors.ink }}>{mi.title}</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: colors.inviteAccent }}>week {mi.week}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * P4 per-goal delete, on archived goals only. Distinct from dropping: this
 * erases the goal, its protocol versions and every check-in server-side —
 * there is no undo, so it arms first and says what it costs.
 */
function DeleteGoalButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Pressable
      onPress={async () => {
        if (busy) return;
        if (!armed) { setArmed(true); return; }
        setBusy(true);
        try { await onDelete(); } catch { setBusy(false); setArmed(false); }
      }}
      hitSlop={8}
      style={{
        marginLeft: 10, paddingVertical: 6, paddingHorizontal: armed ? 10 : 8,
        borderRadius: 999, borderWidth: 1, opacity: busy ? 0.5 : 1,
        borderColor: armed ? colors.danger : colors.hairline,
      }}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: armed ? 10 : 13, color: armed ? colors.danger : colors.muted }}>
        {busy ? '…' : armed ? 'ERASE FOR GOOD' : '×'}
      </Text>
    </Pressable>
  );
}

function DropGoalButton({ onDrop }: { onDrop: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Pressable
      onPress={() => (armed ? onDrop() : setArmed(true))}
      style={{
        alignSelf: 'center', marginTop: 22, paddingVertical: 9, paddingHorizontal: 20,
        borderRadius: 999, borderWidth: 1.5,
        borderColor: armed ? colors.danger : colors.dangerBorder,
      }}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: colors.danger }}>
        {armed ? 'Tap again to drop this goal' : 'Drop this goal'}
      </Text>
    </Pressable>
  );
}

/** The public page a witness opens — built from the owner's own token. */
const witnessUrl = (token: string) => `${apiBase()}/w/${token}`;

/**
 * P4.5 the witness. The protocols already tell people to recruit a human —
 * "tell one person and give them your quit date" is a step Qoach writes on
 * its own — and until now the app had no way to be that connection.
 *
 * The copy has to be exact about what the other person sees, because these
 * goals are intimate: they get streaks and effort, never the miss detail,
 * and only this one goal.
 */
function WitnessRow({ shared, onShare, onStop }: {
  shared: string | null;
  onShare: () => Promise<string>;
  onStop: () => Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(shared);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // The raw link is hidden: it is two lines of opaque hex that the buttons
  // already act on, and on iOS the share sheet does the whole job. It is only
  // ever NEEDED when a web clipboard write is blocked, so it stays out of the
  // way until exactly that happens — see `send`.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setUrl(shared); }, [shared]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try { setUrl(await onShare()); } catch { /* offline — the row stays as it was */ }
    finally { setBusy(false); }
  };
  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try { await onStop(); setUrl(null); } catch { /* leave it showing */ }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!url) return;
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { setRevealed(true); }   // blocked: show it so it can be copied by hand
      return;
    }
    // Texting it to someone IS the feature — the share sheet is the shortest
    // path from "I made this" to a person actually holding the link.
    await Share.share({ message: url }).catch(() => {});
  };

  return (
    <View style={{ marginBottom: 18, padding: 16, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 10, letterSpacing: 1.4, color: colors.sectionLabel }}>
        A WITNESS
      </Text>
      {url ? (
        <>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.ink }}>
            One person can watch this goal.
          </Text>
          {revealed ? (
            <Text selectable numberOfLines={2} style={{ fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: colors.muted }}>
              {url}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Pressable
              onPress={send}
              style={{ height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 12.5, color: colors.bg }}>
                {copied ? 'Copied' : Platform.OS === 'web' ? 'Copy link' : 'Send it'}
              </Text>
            </Pressable>
            <Pressable
              onPress={stop}
              style={{ height: 38, paddingHorizontal: 16, borderRadius: 19, borderWidth: 1.5, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}
            >
              <Text style={{ fontFamily: fonts.bold, fontSize: 12.5, color: colors.ink }}>Stop sharing</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 19.5, color: colors.inkSoft }}>
            Being watched is the oldest trick there is. Give one person a link and they
            can see your streak — no app, no account, nothing to install.
          </Text>
          <Pressable
            onPress={start}
            style={{ alignSelf: 'flex-start', marginTop: 4, height: 38, paddingHorizontal: 16, borderRadius: 19, borderWidth: 1.5, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 12.5, color: colors.ink }}>
              {busy ? 'Making a link…' : 'Let someone watch'}
            </Text>
          </Pressable>
        </>
      )}
      <Text style={{ fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.sectionLabel, marginTop: 2 }}>
        They see your streak and the days you showed up — never which days you missed,
        never what you typed, and only this goal. You can stop any time.
      </Text>
    </View>
  );
}

/**
 * P4 pause: life happens, and the alternative to pausing was dropping the
 * goal outright. Resuming pays back the paused days server-side, so a plan
 * that sat still for a fortnight resumes at the week it left, not the week
 * the calendar reached.
 */
function PauseButton({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      onPress={async () => { if (busy) return; setBusy(true); try { await onToggle(); } finally { setBusy(false); } }}
      style={{
        alignSelf: 'center', marginTop: 22, paddingVertical: 9, paddingHorizontal: 20,
        borderRadius: 999, borderWidth: 1.5, borderColor: colors.outline, opacity: busy ? 0.6 : 1,
      }}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: colors.ink }}>
        {busy ? (paused ? 'Resuming…' : 'Pausing…') : paused ? 'Resume this goal' : 'Pause this goal'}
      </Text>
    </Pressable>
  );
}

function DetailView({ m, onBack, onDrop, onTweak, onSeeHow, onRegenerate, onTogglePause, shareUrl, onShare, onStopSharing }: {
  m: GoalModel; onBack: () => void; onDrop: () => void; onTweak: (stepId?: string) => void;
  /** A finished plan's only move: the graduation screen. */
  onSeeHow: () => void;
  /** Old-shape goals only: rebuild with the current engine. Lives on the
   *  parent because DetailView has no navigator of its own — the button used
   *  to reach for `navigation` here and got the DOM global instead, which
   *  TypeScript accepts and iOS throws on. Nothing happened when tapped. */
  onRegenerate: () => void;
  onTogglePause: () => Promise<void>;
  shareUrl: string | null;
  onShare: () => Promise<string>;
  onStopSharing: () => Promise<void>;
}) {
  const { dropRep } = useRally();
  const [open, setOpen] = useState<number>(m.nowIdx);
  // The rep whose how-to sheet is showing. Held here rather than inside
  // PhaseCard so the sheet overlays the screen, not one collapsed card.
  const [sheet, setSheet] = useState<{ step: ProtocolStep; phaseLabel: string; week: number } | null>(null);
  const protocol = m.goal.protocol;
  return (
    <FadeInUp>
      <Pressable onPress={onBack} style={{ alignSelf: 'flex-start', paddingVertical: 2 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.muted }}>‹ Your systems</Text>
      </Pressable>

      <View style={{ marginTop: 14, backgroundColor: colors.navy, borderRadius: 26, paddingVertical: 22, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.dot, marginTop: 10 }} />
          <Text style={{ flex: 1, fontFamily: fonts.serif, fontSize: 20, lineHeight: 28, color: colors.creamText }}>
            {goalTitle(m.goal.statement, m.goal.protocol)}
          </Text>
        </View>
        {!protocol.sessions?.length && (
          <Pressable
            onPress={onRegenerate}
            style={{ marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' }}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: colors.creamText }}>⟳ Regenerate with the new engine</Text>
          </Pressable>
        )}
        <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.onNavySoft, marginTop: 10 }}>
          {planShape(protocol.duration_weeks, protocol.phases.length)} · built with Qoach
          {m.rf ? ` · ${m.rf.current}% — ${m.rf.drifted ? `slipping, was ${m.rf.original}%` : oddsTier(m.rf.current).label.toLowerCase()} — if you do the reps` : ''}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, marginBottom: 20, marginHorizontal: 4 }}>
        <WeekTrack weeks={protocol.duration_weeks} week={m.week} filled={false} />
        <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: colors.muted }}>
          {m.ended
            ? `all ${plural(protocol.duration_weeks, 'week')} lived · ${plural(protocol.phases.length, 'phase')}`
            : `week ${m.week} of ${protocol.duration_weeks} · phase ${m.nowIdx + 1} of ${protocol.phases.length}`}
        </Text>
      </View>

      {/* Above the plan, not under it (owner call 2026-09-01). At the bottom it
          sat below the phases, the tweak link, Pause and Drop, so it read as a
          setting and the owner did not know the feature existed. */}
      <WitnessRow shared={shareUrl} onShare={onShare} onStop={onStopSharing} />

      <View style={{ gap: 10 }}>
        {protocol.phases.map((phase, pi) => (
          <PhaseCard
            key={phase.id}
            goal={m.goal}
            phase={phase}
            now={pi === m.nowIdx}
            open={pi === open}
            onToggle={() => setOpen(prev => (prev === pi ? -1 : pi))}
            onOpenStep={(step, phaseLabel) => setSheet({ step, phaseLabel, week: m.week })}
          />
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', marginTop: 14, paddingHorizontal: 4 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: colors.sectionLabel }}>Plan feels off? </Text>
        <Pressable onPress={() => onTweak()}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 12.5, color: colors.accentLink, textDecorationLine: 'underline' }}>
            Tweak it with Qoach
          </Text>
        </Pressable>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: colors.sectionLabel }}> — nothing here is sacred.</Text>
      </View>

      {/* A finished plan has nothing to pause and nothing to tweak: the only
          move left is to look at how it went and choose what happens next. */}
      {m.ended ? (
        <Pressable
          onPress={onSeeHow}
          style={{ marginTop: 18, paddingVertical: 15, borderRadius: 999, backgroundColor: colors.ink, alignItems: 'center' }}
        >
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 15, color: colors.bg }}>See how it went</Text>
        </Pressable>
      ) : (
        <PauseButton paused={m.goal.status === 'paused'} onToggle={onTogglePause} />
      )}
      <DropGoalButton onDrop={onDrop} />
      {sheet ? (
        <RepSheet
          step={sheet.step}
          phaseLabel={sheet.phaseLabel}
          goalId={m.goal.id}
          onClose={() => setSheet(null)}
          onTweak={stepId => { setSheet(null); onTweak(stepId); }}
          odds={m.goal.odds}
          laterVersions={laterVersions(m.goal.protocol, sheet.step.id)}
          onDrop={m.goal.status === 'paused' ? undefined : (ids, price) => dropRep(m.goal.id, ids, sheet.week, { price })}
        />
      ) : null}
    </FadeInUp>
  );
}

/* ── the screen ─────────────────────────────────────────────────────────── */

export default function GoalsScreen() {
  useAppearance();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { goals, finishedGoals, checkInsByGoal, dropGoal, pauseGoalById, resumeGoalById, deleteGoalById, shareGoalById, unshareGoalById } = useRally();
  const [selId, setSelId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  };

  const today = localDate();
  const models: GoalModel[] = goals.map((goal, i) => {
    const week = weekOf(goal.startedOn, today, goal.protocol.duration_weeks, goal.pauses);
    const phase = phaseForWeek(goal.protocol, week);
    return {
      goal, week, phase,
      dot: goalDot(i),
      nowIdx: Math.max(0, goal.protocol.phases.findIndex(p => p.id === phase.id)),
      repsToday: repsForDate(goal.protocol, goal.startedOn, today, checkInsByGoal[goal.id] ?? []).length,
      rf: reforecastOdds(goal.odds, goal.protocol, goal.startedOn, checkInsByGoal[goal.id] ?? [], today),
      ended: goal.status !== 'paused' && planIsOver(goal.startedOn, goal.protocol.duration_weeks, today, goal.pauses),
    };
  });
  const sel = models.find(m => m.goal.id === selId) ?? null;
  // "three live" means three plans that are actually running — a finished
  // one is not on the clock, and counting it made that line a lie on the day
  // a plan ended.
  const live = models.filter(m => !m.ended && m.goal.status !== 'paused').length;
  const liveCount = COUNT_WORDS[live] ?? String(live);

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 20 }}>
          {sel ? (
            <DetailView
              key={sel.goal.id}
              m={sel}
              onBack={() => setSelId(null)}
              onDrop={() => { dropGoal(sel.goal.id); setSelId(null); }}
              onTweak={stepId => navigation.navigate('AdjustPlan', { goalId: sel.goal.id, ...(stepId ? { stepId } : {}) })}
              onSeeHow={() => navigation.navigate('Graduation', { goalId: sel.goal.id })}
              onRegenerate={() => navigation.navigate('NewGoal', { prefill: sel.goal.statement, replaceGoalId: sel.goal.id })}
              shareUrl={sel.goal.shareToken ? witnessUrl(sel.goal.shareToken) : null}
              onShare={() => shareGoalById(sel.goal.id)}
              onStopSharing={() => unshareGoalById(sel.goal.id)}
              onTogglePause={async () => {
                if (sel.goal.status === 'paused') await resumeGoalById(sel.goal.id);
                else { await pauseGoalById(sel.goal.id); setSelId(null); }
              }}
            />
          ) : (
            <FadeInUp>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.serif, fontSize: 30, lineHeight: 34.5, color: colors.ink }}>Your systems</Text>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, marginTop: 6 }}>
                    {goals.length === 0
                      ? 'Nothing on the clock yet'
                      : live === 0
                        ? 'Nothing on the clock — see how the last one went'
                        : `${liveCount} live · built with Qoach`}
                  </Text>
                </View>
                <Pressable onPress={() => navigation.navigate('You')}>
                  <YouAvatar size={42} fontSize={13} />
                </Pressable>
              </View>

              {goals.length > 0 && (
                <Pressable
                  onPress={() => navigation.navigate('Ledger')}
                  style={{ alignSelf: 'flex-start', marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: colors.outline }}
                >
                  <Text style={{ fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 1, color: colors.ink }}>THE LEDGER</Text>
                  <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: colors.sectionLabel }}>week by week ›</Text>
                </Pressable>
              )}

              <View style={{ gap: 12, marginTop: 24 }}>
                {goals.length === 0 && (
                  <View style={{ backgroundColor: colors.navy, borderRadius: 26, padding: 24 }}>
                    <Text style={{ fontFamily: fonts.serif, fontSize: 20, lineHeight: 26, color: colors.creamText }}>
                      No goal locked yet.
                    </Text>
                    <Text style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.onNavyMuted, marginTop: 8 }}>
                      Tap + and tell Qoach what you want to pull off — it turns any realistic goal
                      into a week-by-week protocol you can hold yourself to.
                    </Text>
                  </View>
                )}
                {models.map(m => (
                  <GoalCard
                    key={m.goal.id}
                    m={m}
                    onOpen={() => setSelId(m.goal.id)}
                    onSeeHow={() => navigation.navigate('Graduation', { goalId: m.goal.id })}
                  />
                ))}
                <Pressable
                  onPress={() => navigation.navigate('NewGoal')}
                  style={{
                    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.outline,
                    borderRadius: 26, padding: 16, alignItems: 'center',
                  }}
                >
                  <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.muted }}>
                    ＋ Start another system with Qoach
                  </Text>
                </Pressable>

                {/* The archive: plans that ended, completed or dropped. Before
                    this they simply disappeared, taking their history with
                    them. */}
                {finishedGoals.length > 0 && (
                  <View style={{ marginTop: 18 }}>
                    <Text style={{ fontFamily: fonts.extrabold, fontSize: 10.5, letterSpacing: 1.4, color: colors.sectionLabel, marginBottom: 10 }}>
                      FINISHED
                    </Text>
                    <View style={{ gap: 8 }}>
                      {finishedGoals.map(g => (
                        <View
                          key={g.id}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 12,
                            backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
                            borderRadius: 20, paddingVertical: 14, paddingHorizontal: 18,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text numberOfLines={1} style={{ fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 21, color: colors.inkSoft }}>
                              {goalTitle(g.statement, g.protocol)}
                            </Text>
                            <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.sectionLabel, marginTop: 2 }}>
                              {plural(g.protocol.duration_weeks, 'week')} · {g.startedOn} to {planEndDate(g.startedOn, g.protocol.duration_weeks, g.pauses)}
                            </Text>
                          </View>
                          <View style={{ width: 70, flexDirection: 'row' }}>
                            <WeekTrack weeks={g.protocol.duration_weeks} week={g.protocol.duration_weeks} filled done />
                          </View>
                          <DeleteGoalButton onDelete={() => deleteGoalById(g.id)} />
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            </FadeInUp>
          )}
        </View>
      </ScrollView>

      {toast !== '' && (
        <View pointerEvents="none" style={{ position: 'absolute', top: Math.max(insets.top, 24), left: 0, right: 0, alignItems: 'center', zIndex: 40 }}>
          <Pop>
            <View style={{ backgroundColor: colors.navy, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 18, maxWidth: 420 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.creamText }}>{toast}</Text>
            </View>
          </Pop>
        </View>
      )}
    </FadeInUp>
  );
}
