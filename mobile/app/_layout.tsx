/**
 * app/_layout.tsx
 * Root layout for the mobile app using expo-router
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { ThemeProvider, themes } from './theme';
import { useDeepLink } from '../hooks/useDeepLink';

function DeepLinkHandler() {
  useDeepLink();
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const themeMode = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = themes[themeMode];

  return (
    <ThemeProvider>
      <DeepLinkHandler />
      <StatusBar style={theme.statusBarStyle} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: theme.header },
        headerTintColor: theme.headerText,
        headerTitleStyle: { fontFamily: 'Lora_700Bold' },
      }}>
        <Stack.Screen name="index" options={{ title: 'Home' }} />
        <Stack.Screen name="projects" options={{ title: 'Projects' }} />
        <Stack.Screen name="projects/[id]" options={{ title: 'Project Details' }} />
        <Stack.Screen name="donate/[id]" options={{ title: 'Donate' }} />
        <Stack.Screen name="impact" options={{ title: 'My Impact' }} />
        <Stack.Screen name="profile/[address]" options={{ title: 'Donor Profile' }} />
        <Stack.Screen name="leaderboard" options={{ title: 'Leaderboard' }} />
        <Stack.Screen name="recurring" options={{ title: 'Monthly Giving' }} />
      </Stack>
    </ThemeProvider>
  );
}
