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

import RallyTabBar from './src/components/RallyTabBar';
import ChallengeDetailScreen from './src/screens/ChallengeDetailScreen';
import ChallengesScreen from './src/screens/ChallengesScreen';
import CreateScreen from './src/screens/CreateScreen';
import EventDetailScreen from './src/screens/EventDetailScreen';
import FriendProfileScreen from './src/screens/FriendProfileScreen';
import FriendsScreen from './src/screens/FriendsScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import PlansScreen from './src/screens/PlansScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { RallyProvider } from './src/state/RallyContext';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg },
};

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
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.loginNavy }} />;
  }

  return (
    <SafeAreaProvider>
      <RallyProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style={loggedIn ? 'dark' : 'light'} />
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            {!loggedIn ? (
              <RootStack.Screen name="Login">
                {() => <LoginScreen onLogin={() => setLoggedIn(true)} />}
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
