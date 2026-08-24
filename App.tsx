import React, { useState } from 'react';
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
import ChallengeDetailScreen from './src/screens/ChallengeDetailScreen';
import ChallengesScreen from './src/screens/ChallengesScreen';
import CreateScreen from './src/screens/CreateScreen';
import EventDetailScreen from './src/screens/EventDetailScreen';
import FriendProfileScreen from './src/screens/FriendProfileScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import HomeScreen from './src/screens/HomeScreen';
import OnboardingFlow from './src/onboarding/OnboardingFlow';
import PlansScreen from './src/screens/PlansScreen';
import ProfileScreen from './src/screens/ProfileScreen';
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
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Plans" component={PlansScreen} />
      <Tab.Screen name="Streaks" component={ChallengesScreen} />
      <Tab.Screen name="You">
        {() => <ProfileScreen onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
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

  if (!fontsLoaded) {
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
                {() => <Onboarding onDone={() => setLoggedIn(true)} />}
              </RootStack.Screen>
            ) : (
              <>
                <RootStack.Screen name="Tabs">
                  {() => <Tabs onLogout={() => setLoggedIn(false)} />}
                </RootStack.Screen>
                <RootStack.Screen name="Event" component={EventDetailScreen} />
                <RootStack.Screen name="Challenge" component={ChallengeDetailScreen} />
                <RootStack.Screen name="Friends" component={FriendsScreen} />
                <RootStack.Screen name="Friend" component={FriendProfileScreen} />
                <RootStack.Screen name="Create" component={CreateScreen} options={{ presentation: 'modal' }} />
              </>
            )}
          </RootStack.Navigator>
        </NavigationContainer>
      </RallyProvider>
    </SafeAreaProvider>
  );
}
