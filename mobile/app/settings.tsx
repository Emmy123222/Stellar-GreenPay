/**
 * app/settings.tsx
 * Settings screen — app preferences with a version footer for support.
 *
 * The footer displays `Constants.expoConfig.version` formatted as
 * "GreenPay v<version> (build <build>)" and tapping it copies the
 * string to the clipboard for easy sharing with support.
 */
import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from './theme';

export function getAppVersionString(): string {
  const version =
    Constants.expoConfig?.version ??
    (Constants as unknown as { manifest?: { version?: string } }).manifest
      ?.version ??
    '1.0.0';

  const buildNumber =
    Platform.select({
      ios:
        Constants.expoConfig?.ios?.buildNumber ??
        Constants.nativeBuildVersion ??
        '1',
      android: Constants.expoConfig?.android?.versionCode
        ? String(Constants.expoConfig.android.versionCode)
        : (Constants.nativeBuildVersion ?? '1'),
      default: Constants.nativeBuildVersion ?? '1',
    }) ?? '1';

  return `GreenPay v${version} (build ${buildNumber})`;
}

export default function SettingsScreen() {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const versionString = getAppVersionString();

  const handleCopyVersion = async () => {
    try {
      await Clipboard.setStringAsync(versionString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — leave footer as-is.
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <Text style={[styles.headerTitle, { color: colors.headerText }]}>
          Settings
        </Text>
        <Text style={[styles.headerSub, { color: colors.headerText }]}>
          Manage your GreenPay preferences
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={[styles.placeholder, { color: colors.secondaryText }]}>
          More settings are coming soon.
        </Text>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handleCopyVersion}
          activeOpacity={0.7}
          accessibilityLabel={`App version ${versionString}. Tap to copy.`}
          accessibilityRole="button"
          testID="settings-version"
        >
          <Text style={[styles.versionText, { color: colors.muted }]}>
            {versionString}
          </Text>
        </TouchableOpacity>
        {copied ? (
          <Text
            style={[styles.copiedText, { color: colors.primary }]}
            accessibilityRole="alert"
          >
            Copied to clipboard
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  header: {
    padding: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: 'bold',
  },
  headerSub: {
    fontSize: 13,
    marginTop: 4,
    opacity: 0.85,
  },
  body: {
    flex: 1,
    padding: 16,
  },
  placeholder: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  versionText: {
    fontSize: 13,
    textAlign: 'center',
  },
  copiedText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
