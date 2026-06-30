import { createContext, useContext, ReactNode } from 'react';
import { useColorScheme, ColorSchemeName } from 'react-native';

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  surface: string;
  primary: string;
  accent: string;
  header: string;
  headerText: string;
  buttonBackground: string;
  buttonText: string;
  cardBorder: string;
  cardShadow: string;
  primaryText: string;
  secondaryText: string;
  muted: string;
  inputBackground: string;
  inputBorder: string;
  placeholder: string;
  border: string;
  statusBarStyle: 'light' | 'dark';
}

export interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
}

const themes: Record<ThemeMode, ThemeColors> = {
  light: {
    background: '#f0f7f0',
    surface: '#ffffff',
    primary: '#227239',
    accent: '#1a2e1a',
    header: '#227239',
    headerText: '#ffffff',
    buttonBackground: '#227239',
    buttonText: '#ffffff',
    cardBorder: '#e8f3e8',
    cardShadow: '#000000',
    primaryText: '#1a2e1a',
    secondaryText: '#5a7a5a',
    muted: '#8aaa8a',
    inputBackground: '#ffffff',
    inputBorder: '#e8f3e8',
    placeholder: '#8aaa8a',
    border: '#d8e4d8',
    statusBarStyle: 'dark',
  },
  dark: {
    background: '#06140a',
    surface: '#102214',
    primary: '#60d07b',
    accent: '#ade4af',
    header: '#1b472f',
    headerText: '#f1f7f1',
    buttonBackground: '#3da668',
    buttonText: '#ffffff',
    cardBorder: '#1c3928',
    cardShadow: '#000000',
    primaryText: '#e6f5e9',
    secondaryText: '#b2d5b5',
    muted: '#88b18f',
    inputBackground: '#122917',
    inputBorder: '#24472f',
    placeholder: '#7a9b80',
    border: '#1f3c28',
    statusBarStyle: 'light',
  },
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const colorScheme = useColorScheme();
  const mode: ThemeMode = colorScheme === 'dark' ? 'dark' : 'light';
  const colors = themes[mode];

  return (
    <ThemeContext.Provider value={{ mode, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

export { themes };
