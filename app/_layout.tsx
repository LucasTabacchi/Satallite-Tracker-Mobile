import { Stack } from 'expo-router';

export default function Layout() {
  return <Stack screenOptions={{ headerStyle: { backgroundColor: '#101816' }, headerTintColor: '#eef0e5', headerShadowVisible: false, contentStyle: { backgroundColor: '#101816' } }}>
    <Stack.Screen name="index" options={{ title: 'Orbit · Satellite Tracker' }} />
  </Stack>;
}
