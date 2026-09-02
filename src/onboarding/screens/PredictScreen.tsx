// One question, between the interview and the verdict: what do YOU think?
//
// Qoach's number arrives with nothing to measure it against. A first-time user
// sees "85%" and cannot tell whether that is honest, generous or harsh, so the
// number lands as decoration and the product's whole claim — that it tells you
// the truth about your odds — is unverifiable from a single figure. Commit to a
// guess first and the number becomes a GAP, which is the part that means
// something. It also turns the honesty into something witnessed rather than
// asserted: the app contradicts a call the user made ten seconds ago.
//
// BANDS, NOT A PERCENTAGE. Nobody holds a calibrated 73% in their head. Asking
// for a precise number would invite a precision the guess does not carry, and
// then "you said 73, I say 85" would over-read a 12-point difference that means
// nothing — which is exactly the overstatement this product exists to refuse.
// Four bands say as much as the guess honestly can.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { night, nightFonts } from '../theme';
import { Screen, Spacer, Sub, TextButton, Title } from '../ui';

/** The user's own words for their own odds. Qoach's vocabulary for ITS number
 *  (oddsTier in lib/protocolTime) stays separate on purpose — these are a
 *  hunch, those are a judgement, and they should not sound alike. */
export const GUESS_BANDS: { label: string; value: number }[] = [
  { label: 'A long shot', value: 15 },
  { label: 'A coin flip', value: 50 },
  { label: 'Pretty likely', value: 75 },
  { label: 'Nailed on', value: 93 },
];

/** The band a percentage falls in — used to read a guess back to the user. */
export function bandFor(pct: number): string {
  let best = GUESS_BANDS[0];
  for (const b of GUESS_BANDS) {
    if (Math.abs(b.value - pct) < Math.abs(best.value - pct)) best = b;
  }
  return best.label;
}

export default function PredictScreen({ onPick }: { onPick: (pct: number | null) => void }) {
  return (
    <Screen>
      <Spacer />
      <Title>Before I answer.</Title>
      <Sub style={{ marginTop: 10 }}>
        What do you think your chances are of pulling this off?
      </Sub>

      <View style={{ gap: 10, marginTop: 30 }}>
        {GUESS_BANDS.map(b => (
          <Pressable
            key={b.label}
            onPress={() => onPick(b.value)}
            style={({ pressed }) => ({
              height: 56, borderRadius: 999,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: pressed ? night.accentSoft : 'transparent',
              borderWidth: 1.5, borderColor: night.borderStrong,
            })}
          >
            <Text style={{ fontFamily: nightFonts.display, fontSize: 15.5, color: night.text }}>
              {b.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Spacer />

      {/* This screen sits between the questions and the answer they are waiting
          for. Impatience must never be trapped here. */}
      <TextButton label="Just tell me" onPress={() => onPick(null)} color={night.textMuted} height={48} />
    </Screen>
  );
}
