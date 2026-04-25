/**
 * app/_layout.tsx
 * Root layout for the mobile app using expo-router
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: '#227239' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontFamily: 'Lora_700Bold' },
      }}>
        <Stack.Screen name="index" options={{ title: 'Home' }} />
        <Stack.Screen name="projects" options={{ title: 'Projects' }} />
        <Stack.Screen name="projects/[id]" options={{ title: 'Project Details' }} />
        <Stack.Screen name="donate/[id]" options={{ title: 'Donate' }} />
        <Stack.Screen name="impact" options={{ title: 'My Impact' }} />
      </Stack>
    </>
  );
}
