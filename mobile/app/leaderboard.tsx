/**
 * app/leaderboard.tsx
 * Leaderboard screen — ranked donor list with badge icons and XLM totals.
 * Highlights the current user's row when their address matches.
 */
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const PAGE_SIZE = 20;

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
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`${API_URL}/api/leaderboard`, {
        params: { limit: PAGE_SIZE },
      });
      const data = res.data?.data ?? [];
      setEntries(data);
      setNextCursor(res.data?.next_cursor ?? null);
      setHasMore(res.data?.has_more ?? false);
    } catch {
      setError('Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await axios.get(`${API_URL}/api/leaderboard`, {
        params: { limit: PAGE_SIZE },
      });
      const data = res.data?.data ?? [];
      setEntries(data);
      setNextCursor(res.data?.next_cursor ?? null);
      setHasMore(res.data?.has_more ?? false);
      setError(null);
    } catch {
      setError('Failed to load leaderboard');
    } finally {
      setRefreshing(false);
    }
  };

  const loadMore = async () => {
    if (loading || loadingMore || !hasMore || !nextCursor) {
      return;
    }

    try {
      setLoadingMore(true);
      const res = await axios.get(`${API_URL}/api/leaderboard`, {
        params: { limit: PAGE_SIZE, cursor: nextCursor },
      });
      const newEntries = res.data?.data ?? [];
      setEntries((prev) => [...prev, ...newEntries]);
      setNextCursor(res.data?.next_cursor ?? null);
      setHasMore(res.data?.has_more ?? false);
    } catch {
      // Keep current list on pagination error
    } finally {
      setLoadingMore(false);
    }
  };

  const renderItem = useCallback(({ item }: { item: LeaderboardEntry }) => {
    const isCurrentUser =
      !!CURRENT_USER_ADDRESS && item.publicKey === CURRENT_USER_ADDRESS;
    return (
      <TouchableOpacity
        key={item.publicKey}
        activeOpacity={0.7}
        onPress={() =>
          router.push(`/profile/${item.publicKey}` as `${string}`)
        }
        style={[styles.row, isCurrentUser && styles.rowHighlighted]}
        accessibilityLabel={`View profile of ${item.displayName ?? item.publicKey.slice(0, 6)}, donated ${parseFloat(item.totalDonatedXLM).toFixed(2)} XLM`}
        accessibilityRole="button"
      >
        <Text style={styles.rankText}>
          {RANK_MEDALS[item.rank] ?? `#${item.rank}`}
        </Text>

        <View style={styles.rowInfo}>
          <Text
            style={[styles.donorName, isCurrentUser && styles.donorNameHighlighted]}
            numberOfLines={1}
          >
            {item.displayName ??
              `${item.publicKey.slice(0, 6)}…${item.publicKey.slice(-4)}`}
          </Text>
          <Text style={styles.donorMeta}>
            {item.projectsSupported}{' '}
            {item.projectsSupported === 1 ? 'project' : 'projects'}
          </Text>
        </View>

        <View style={styles.rowRight}>
          {item.topBadge && (
            <Text style={styles.badgeIcon}>
              {BADGE_ICONS[item.topBadge] ?? '🏅'}
            </Text>
          )}
          <Text
            style={[styles.xlmAmount, isCurrentUser && styles.xlmAmountHighlighted]}
          >
            {parseFloat(item.totalDonatedXLM).toFixed(2)} XLM
          </Text>
        </View>
      </TouchableOpacity>
    );
  }, [router]);

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader} testID="leaderboard-footer-loader">
        <ActivityIndicator size="small" color="#227239" />
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#227239" />
      </View>
    );
  }

  if (error && entries.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={entries}
      keyExtractor={(item, index) => `${item.publicKey}-${item.rank ?? index}`}
      renderItem={renderItem}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Top Donors</Text>
          <Text style={styles.headerSub}>Ranked by total XLM donated</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No donors yet — be the first!</Text>
        </View>
      }
      ListFooterComponent={renderFooter}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshing={refreshing}
      onRefresh={handleRefresh}
    />
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
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
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
