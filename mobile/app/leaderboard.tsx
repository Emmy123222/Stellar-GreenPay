/**
 * app/leaderboard.tsx
 * Leaderboard screen — ranked donor list with badge icons and XLM totals.
 * Highlights the current user's row when their address matches.
 */
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

// In a real app this would come from wallet connection state.
// For demo purposes this is left empty so no row is auto-highlighted.
const CURRENT_USER_ADDRESS = '';

interface LeaderboardEntry {
  rank: number;
  publicKey: string;
  displayName: string | null;
  totalDonatedXLM: string;
  projectsSupported: number;
  topBadge: string | null;
}

const BADGE_ICONS: Record<string, string> = {
  seedling: '🌱',
  tree:     '🌳',
  forest:   '🌲',
  earth:    '🌍',
};

const RANK_MEDALS: Record<number, string> = {
  1: '🥇',
  2: '🥈',
  3: '🥉',
};

export default function LeaderboardScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/leaderboard`);
      setEntries(res.data.data ?? []);
    } catch {
      setError('Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#227239" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Top Donors</Text>
        <Text style={styles.headerSub}>Ranked by total XLM donated</Text>
      </View>

      {entries.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No donors yet — be the first!</Text>
        </View>
      ) : (
        entries.map((entry) => {
          const isCurrentUser =
            CURRENT_USER_ADDRESS && entry.publicKey === CURRENT_USER_ADDRESS;
          return (
            <TouchableOpacity
              key={entry.publicKey}
              activeOpacity={0.7}
              onPress={() =>
                router.push(`/profile/${entry.publicKey}` as `${string}`)
              }
              style={[styles.row, isCurrentUser && styles.rowHighlighted]}
              accessibilityLabel={`View profile of ${entry.displayName ?? entry.publicKey.slice(0, 6)}, donated ${parseFloat(entry.totalDonatedXLM).toFixed(2)} XLM`}
              accessibilityRole="button"
            >
              <Text style={styles.rankText}>
                {RANK_MEDALS[entry.rank] ?? `#${entry.rank}`}
              </Text>

              <View style={styles.rowInfo}>
                <Text
                  style={[styles.donorName, isCurrentUser && styles.donorNameHighlighted]}
                  numberOfLines={1}
                >
                  {entry.displayName ??
                    `${entry.publicKey.slice(0, 6)}…${entry.publicKey.slice(-4)}`}
                </Text>
                <Text style={styles.donorMeta}>
                  {entry.projectsSupported}{' '}
                  {entry.projectsSupported === 1 ? 'project' : 'projects'}
                </Text>
              </View>

              <View style={styles.rowRight}>
                {entry.topBadge && (
                  <Text style={styles.badgeIcon}>
                    {BADGE_ICONS[entry.topBadge] ?? '🏅'}
                  </Text>
                )}
                <Text
                  style={[styles.xlmAmount, isCurrentUser && styles.xlmAmountHighlighted]}
                >
                  {parseFloat(entry.totalDonatedXLM).toFixed(2)} XLM
                </Text>
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f7f0',
  },
  content: {
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  errorText: {
    fontSize: 15,
    color: '#c62828',
  },
  emptyText: {
    fontSize: 15,
    color: '#5a7a5a',
  },
  header: {
    backgroundColor: '#227239',
    padding: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSub: {
    fontSize: 13,
    color: '#c8e6c9',
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    padding: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  rowHighlighted: {
    backgroundColor: '#e8f5e9',
    borderWidth: 1.5,
    borderColor: '#227239',
  },
  rankText: {
    fontSize: 22,
    width: 40,
    textAlign: 'center',
  },
  rowInfo: {
    flex: 1,
    marginLeft: 10,
  },
  donorName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a2e1a',
  },
  donorNameHighlighted: {
    color: '#227239',
  },
  donorMeta: {
    fontSize: 12,
    color: '#5a7a5a',
    marginTop: 2,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  badgeIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  xlmAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1a2e1a',
  },
  xlmAmountHighlighted: {
    color: '#227239',
  },
});
