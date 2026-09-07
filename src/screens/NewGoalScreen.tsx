// The in-app "+": start (or replace) a goal with Qoach, as a modal. Hosts the
// same intake flow as onboarding — Electric Night, live AI, sufficiency gate —
// and lands the accepted plan on the profile. P1 is single-goal, so locking a
// new plan replaces the current one; concurrent goals arrive with the
// living-protocol phase.
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAppearance } from '../state/ThemeContext';
import { useNavigation, usePreventRemove, useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import FirstGoalScreen from '../onboarding/screens/FirstGoalScreen';
import { night } from '../onboarding/theme';
import { ensureNudgePermission } from '../lib/nudges';
import { useRally } from '../state/RallyContext';

export default function NewGoalScreen() {
  useAppearance();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { setGoalPlan, dropGoal } = useRally();
  // Fix 3 (owner spec): "Regenerate with the new engine" on old-shape goals —
  // arrives with the goal text prefilled and the old goal to retire on lock.
  const prefill: string | undefined = route.params?.prefill;
  const replaceGoalId: string | undefined = route.params?.replaceGoalId;

  // An iOS modal is swipe-to-dismiss by default, and the coach session is held
  // in memory only — nothing about it is written down until a plan is locked.
  // One accidental downward swipe during a 60-second generation therefore threw
  // away the goal, the whole interview and the verdict, silently, with nothing
  // to come back to. Reported from the field more than once.
  //
  // usePreventRemove is the mechanism that actually stops it: on iOS it sets
  // the sheet's `preventNativeDismiss`, where `gestureEnabled: false` only
  // governs the interactive pop gesture on PUSHED screens, not a modal's drag.
  const [busy, setBusy] = useState(false);
  // It blocks navigation.goBack() too, so a deliberate exit has to lower the
  // latch first — otherwise the wait screen's own door would be dead while it
  // is the one thing on screen offering a way out.
  const [leaving, setLeaving] = useState(false);
  usePreventRemove(busy && !leaving, () => {});
  useEffect(() => { if (leaving) navigation.goBack(); }, [leaving, navigation]);

  const onBusy = useCallback((v: boolean) => setBusy(v), []);

  return (
    <View style={{ flex: 1, backgroundColor: night.bg }}>
      <StatusBar style="light" />
      <FirstGoalScreen
        dismissLabel="Cancel"
        initialGoal={prefill}
        onBusy={onBusy}
        onDismiss={() => setLeaving(true)}
        onLocked={plan => {
          setGoalPlan(plan);
          if (replaceGoalId) dropGoal(replaceGoalId);
          navigation.goBack();
          // P4: protocol acceptance IS the notification-permission moment —
          // the plan they just locked is the reason the nudges exist.
          void ensureNudgePermission();
        }}
      />
    </View>
  );
}
