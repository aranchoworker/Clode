import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

/**
 * 다크 모드는 기기 설정을 따른다.
 *
 * 알람 발화 화면(Phase 4)은 새벽에 잠긴 화면에서 뜨는 경우가 많아서,
 * 밝은 배경이 그대로 뜨면 눈이 상한다. 그래서 발화 화면만은 테마와 무관하게
 * 항상 어두운 팔레트를 쓸 예정이라 `dark` 팔레트를 직접 가져다 쓸 수 있게 export 한다.
 */

export type Palette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  danger: string;
  dangerSurface: string;
  success: string;
};

export const lightPalette: Palette = {
  background: '#FFFFFF',
  surface: '#F6F7F9',
  surfaceAlt: '#EDEFF3',
  border: '#DFE3E8',
  text: '#14161A',
  textMuted: '#6B7280',
  primary: '#4C6FFF',
  primaryText: '#FFFFFF',
  danger: '#D93A3A',
  dangerSurface: '#FDECEC',
  success: '#1E9E6A',
};

export const darkPalette: Palette = {
  background: '#0E1013',
  surface: '#171A1F',
  surfaceAlt: '#1F242B',
  border: '#2A3038',
  text: '#F2F4F7',
  textMuted: '#9AA3AF',
  primary: '#7C93FF',
  primaryText: '#0E1013',
  danger: '#FF6B6B',
  dangerSurface: '#2A1A1C',
  success: '#4ADE9B',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export type Theme = {
  colors: Palette;
  isDark: boolean;
  spacing: typeof spacing;
  radius: typeof radius;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children, force }: { children: ReactNode; force?: 'light' | 'dark' }) {
  const scheme = useColorScheme();
  const isDark = force ? force === 'dark' : scheme === 'dark';

  const value = useMemo<Theme>(
    () => ({ colors: isDark ? darkPalette : lightPalette, isDark, spacing, radius }),
    [isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
