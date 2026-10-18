import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { pasangPenjagaJaringan } from '@/utils/modeLokal';

// Dipasang di tingkat modul, BUKAN di dalam komponen: fetch() pertama bisa
// terjadi sebelum render pertama selesai (pembacaan sesi di (tabs)/index),
// jadi penjaganya harus sudah ada sebelum komponen apa pun berjalan. Tanpa
// EXPO_PUBLIC_SUMBER=lokal panggilan ini tidak melakukan apa pun.
pasangPenjagaJaringan();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
