// The in-app "+": start (or replace) a goal with Qoach, as a modal. Hosts the
// same intake flow as onboarding — Electric Night, live AI, sufficiency gate —
// and lands the accepted plan on the profile. P1 is single-goal, so locking a
// new plan replaces the current one; concurrent goals arrive with the
// living-protocol phase.
import React from 'react';
import { View } from 'react-native';
import { useAppearance } from '../state/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import FirstGoalScreen from '../onboarding/screens/FirstGoalScreen';
import { night } from '../onboarding/theme';
import { useRally } from '../state/RallyContext';

export default function NewGoalScreen() {
  useAppearance();
  const navigation = useNavigation<any>();
  const { setGoalPlan } = useRally();

  return (
    <View style={{ flex: 1, backgroundColor: night.bg }}>
      <StatusBar style="light" />
      <FirstGoalScreen
        dismissLabel="Cancel"
        onDismiss={() => navigation.goBack()}
        onLocked={plan => {
          setGoalPlan(plan);
          navigation.goBack();
        }}
      />
    </View>
  );
}
