import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/context';
import { AddFriendScreen } from '../screens/AddFriendScreen';
import { BlocksScreen } from '../screens/BlocksScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SignupScreen } from '../screens/SignupScreen';
import { useTheme } from '../theme';

export type AuthStackParams = {
  Login: undefined;
  Signup: undefined;
};

export type MainStackParams = {
  Tabs: undefined;
  AddFriend: undefined;
  Blocks: undefined;
};

export type TabParams = {
  Home: undefined;
  Friends: undefined;
  Settings: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParams>();
const MainStack = createNativeStackNavigator<MainStackParams>();
const Tabs = createBottomTabNavigator<TabParams>();

function TabNavigator() {
  const { t } = useI18n();
  const { colors } = useTheme();

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: t('tab.home'),
          tabBarIcon: ({ color, size }) => <Ionicons name="alarm" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="Friends"
        options={{
          title: t('tab.friends'),
          tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} />,
        }}
      >
        {/* 친구 추가는 탭이 아니라 스택 위로 띄운다. 탭에 두면 검색 후 돌아올 곳이 애매해진다. */}
        {({ navigation }) => <FriendsScreen onAddFriend={() => navigation.navigate('AddFriend')} />}
      </Tabs.Screen>
      <Tabs.Screen
        name="Settings"
        options={{
          title: t('tab.settings'),
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} />,
        }}
      >
        {({ navigation }) => <SettingsScreen onOpenBlocks={() => navigation.navigate('Blocks')} />}
      </Tabs.Screen>
    </Tabs.Navigator>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login">
        {({ navigation }) => <LoginScreen onGoToSignup={() => navigation.navigate('Signup')} />}
      </AuthStack.Screen>
      <AuthStack.Screen name="Signup">
        {({ navigation }) => <SignupScreen onGoToLogin={() => navigation.goBack()} />}
      </AuthStack.Screen>
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  const { t } = useI18n();
  const { colors } = useTheme();

  return (
    <MainStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      <MainStack.Screen name="Tabs" component={TabNavigator} options={{ headerShown: false }} />
      <MainStack.Screen
        name="AddFriend"
        component={AddFriendScreen}
        options={{ title: t('search.title') }}
      />
      <MainStack.Screen
        name="Blocks"
        component={BlocksScreen}
        options={{ title: t('blocks.title') }}
      />
    </MainStack.Navigator>
  );
}

export function RootNavigator() {
  const { state } = useAuth();
  const { colors, isDark } = useTheme();

  // React Navigation 자체 테마도 맞춰야 화면 전환 중 흰 배경이 번쩍이지 않는다.
  const navTheme: NavTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  if (state.status === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {state.status === 'signedIn' ? <MainNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
