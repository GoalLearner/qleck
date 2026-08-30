import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

// Hold the brand splash (owner fix, build 11): keep it up while the app
// boots, and never less than ~1.4s total — it used to blink away.
const SPLASH_MIN_MS = 1400;
const SPLASH_T0 = Date.now();
SplashScreen.preventAutoHideAsync().catch(() => {});
// Fonts are vendored into assets/fonts rather than imported from the
// @expo-google-fonts packages. Expo emits a package-sourced asset under
// dist/assets/node_modules/..., and some static hosts (Netlify Drop among
// them) drop node_modules directories from an upload — every face then 404s,
// useFonts never resolves, and the app hangs on a blank loading screen with
// no error. Keeping the files in the repo keeps them out of that path.

import RallyTabBar from './src/components/RallyTabBar';
import GoalsScreen from './src/screens/GoalsScreen';
import HomeScreen from './src/screens/HomeScreen';
import AdjustPlanScreen from './src/screens/AdjustPlanScreen';
import GraduationScreen from './src/screens/GraduationScreen';
import HelpScreen from './src/screens/HelpScreen';
import NewGoalScreen from './src/screens/NewGoalScreen';
import OnboardingFlow from './src/onboarding/OnboardingFlow';
import ProfileScreen from './src/screens/ProfileScreen';
// Rally-era social surfaces (Plans/Streaks/Create/Friends/Event/Challenge
// screens) are quarantined out of the shell per the owner's coach-first call
// (2026-08-24); they return behind real backends per ROADMAP P6.
import { RallyProvider, useRally } from './src/state/RallyContext';
import { ThemeProvider, useTheme } from './src/state/ThemeContext';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

// Built per render: colors.bg changes with the appearance setting, so a
// module-level constant would pin the navigator to whichever mode loaded first.
const navThemeFor = () => ({
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg },
});

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

function AppShell() {
  const { mode } = useTheme();
  // null = still reading the stored session flag (interim until P3 sessions).
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem('qleck-session').then(v => setLoggedIn(v === '1')).catch(() => setLoggedIn(false));
  }, []);
  const logIn = () => { setLoggedIn(true); AsyncStorage.setItem('qleck-session', '1').catch(() => {}); };
  const logOut = () => { setLoggedIn(false); AsyncStorage.removeItem('qleck-session').catch(() => {}); };
  // Keys are the family names every style refers to (src/theme.ts fonts.*),
  // so they must not be renamed.
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular: require('./assets/fonts/PlusJakartaSans_400Regular.ttf'),
    PlusJakartaSans_500Medium: require('./assets/fonts/PlusJakartaSans_500Medium.ttf'),
    PlusJakartaSans_600SemiBold: require('./assets/fonts/PlusJakartaSans_600SemiBold.ttf'),
    PlusJakartaSans_700Bold: require('./assets/fonts/PlusJakartaSans_700Bold.ttf'),
    PlusJakartaSans_800ExtraBold: require('./assets/fonts/PlusJakartaSans_800ExtraBold.ttf'),
    YoungSerif_400Regular: require('./assets/fonts/YoungSerif_400Regular.ttf'),
    // Onboarding ("Electric Night") type ramp.
    SpaceGrotesk_700Bold: require('./assets/fonts/SpaceGrotesk_700Bold.ttf'),
    DMSans_400Regular: require('./assets/fonts/DMSans_400Regular.ttf'),
    DMSans_500Medium: require('./assets/fonts/DMSans_500Medium.ttf'),
  });

  // Owner fix (build 11): the brand splash blinked away as soon as JS was
  // ready. Hold it for at least SPLASH_MIN_MS from launch — hideAsync fires
  // only once fonts + session state are ready AND the minimum has elapsed.
  useEffect(() => {
    if ((fontsLoaded || fontError) && loggedIn !== null) {
      const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - SPLASH_T0));
      const t = setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, wait);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [fontsLoaded, fontError, loggedIn]);

  // Render anyway if a face fails to load. A missing font is a cosmetic
  // problem; a permanently blank screen is a broken app, and that is exactly
  // what this gate produced when the fonts 404'd on the first web deploy.
  if ((!fontsLoaded && !fontError) || loggedIn === null) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <RallyProvider>
        <NavigationContainer theme={navThemeFor()}>
          {/* one appearance for every surface — the coach and the tabs agree */}
          <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
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
                <RootStack.Screen name="Graduation" component={GraduationScreen} options={{ presentation: 'modal' }} />
                <RootStack.Screen name="Help" component={HelpScreen} options={{ presentation: 'modal' }} />
                <RootStack.Screen name="AdjustPlan" component={AdjustPlanScreen} options={{ presentation: 'modal' }} />
              </>
            )}
          </RootStack.Navigator>
        </NavigationContainer>
      </RallyProvider>
    </SafeAreaProvider>
  );
}

export default function App() {
  // ThemeProvider is outermost: it rewrites the live palettes before anything
  // below it renders, so no surface ever paints a frame in the wrong mode.
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
