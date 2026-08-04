import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import AnalyticsScreen from './src/screens/AnalyticsScreen';
import StoriesScreen from './src/screens/StoriesScreen';
import FriendsStoriesScreen from './src/screens/FriendsStoriesScreen';
import RepostScreen from './src/screens/RepostScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

type IconName = keyof typeof Ionicons.glyphMap;
const ICONS: Record<string, IconName> = {
  Analytics: 'stats-chart',
  'My Stories': 'person-circle-outline',
  'Friends Stories': 'people-circle-outline',
  Repost: 'repeat',
  Settings: 'menu',
};

// Settings needs to open the Paywall, which lives in the root stack.
function SettingsTab() {
  const navigation = useNavigation<any>();
  return <SettingsScreen onOpenPaywall={() => navigation.navigate('Paywall')} />;
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 24,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.pill,
          borderTopWidth: 0,
          paddingTop: 8,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={ICONS[route.name] ?? 'ellipse'} size={size - 2} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Analytics" component={AnalyticsScreen} />
      <Tab.Screen name="My Stories" component={StoriesScreen} />
      <Tab.Screen name="Friends Stories" component={FriendsStoriesScreen} />
      <Tab.Screen name="Repost" component={RepostScreen} />
      <Tab.Screen name="Settings" component={SettingsTab} />
    </Tab.Navigator>
  );
}

function PaywallModal() {
  const navigation = useNavigation<any>();
  return <PaywallScreen onClose={() => navigation.goBack()} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="Tabs" component={Tabs} />
          <RootStack.Screen
            name="Paywall"
            component={PaywallModal}
            options={{ presentation: 'modal' }}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
