import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { YoungSerif_400Regular } from '@expo-google-fonts/young-serif';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';

import RallyTabBar from './src/components/RallyTabBar';
import GoalsScreen from './src/screens/GoalsScreen';
import HomeScreen from './src/screens/HomeScreen';
import NewGoalScreen from './src/screens/NewGoalScreen';
import OnboardingFlow from './src/onboarding/OnboardingFlow';
import ProfileScreen from './src/screens/ProfileScreen';
// Rally-era social surfaces (Plans/Streaks/Create/Friends/Event/Challenge
// screens) are quarantined out of the shell per the owner's coach-first call
// (2026-08-24); they return behind real backends per ROADMAP P6.
import { RallyProvider, useRally } from './src/state/RallyContext';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg },
};

// Lives inside RallyProvider so the funnel's result can land in app state
// before we flip to the tabs.
function Onboarding({ onDone }: { onDone: () => void }) {
  const { applyOnboarding } = useRally();
  return (
    <OnboardingFlow
      onAuthenticated={result => {
        applyOnboarding(result);
        onDone();
      }}
    />
  );
}

function Tabs({ onLogout }: { onLogout: () => void }) {
  return (
    <Tab.Navigator
      tabBar={props => <RallyTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tab.Screen name="Today" component={HomeScreen} />
      <Tab.Screen name="Goals" component={GoalsScreen} />
      <Tab.Screen name="You">
        {() => <ProfileScreen onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  // null = still reading the stored session flag (interim until P3 sessions).
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem('qleck-session').then(v => setLoggedIn(v === '1')).catch(() => setLoggedIn(false));
  }, []);
  const logIn = () => { setLoggedIn(true); AsyncStorage.setItem('qleck-session', '1').catch(() => {}); };
  const logOut = () => { setLoggedIn(false); AsyncStorage.removeItem('qleck-session').catch(() => {}); };
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    YoungSerif_400Regular,
    // Onboarding ("Electric Night") type ramp.
    SpaceGrotesk_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
  });

  if (!fontsLoaded || loggedIn === null) {
    return <View style={{ flex: 1, backgroundColor: '#0C0F14' }} />;
  }

  return (
    <SafeAreaProvider>
      <RallyProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style={loggedIn ? 'dark' : 'light'} />
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            {!loggedIn ? (
              <RootStack.Screen name="Onboarding">
                {() => <Onboarding onDone={logIn} />}
              </RootStack.Screen>
            ) : (
              <>
                <RootStack.Screen name="Tabs">
                  {() => <Tabs onLogout={logOut} />}
                </RootStack.Screen>
                <RootStack.Screen name="NewGoal" component={NewGoalScreen} options={{ presentation: 'modal' }} />
              </>
            )}
          </RootStack.Navigator>
        </NavigationContainer>
      </RallyProvider>
    </SafeAreaProvider>
  );
}
