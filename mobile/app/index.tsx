/**
 * app/index.tsx
 * Home screen — live project list fetched from /api/projects
 */
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useTheme } from './theme';
import { getCachedData, setCachedData } from '../utils/cache';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const CACHE_KEY_PROJECTS = 'home:projects_list';

interface ClimateProject {
  id: string;
  name: string;
  description: string;
  category: string;
  goalXLM: string;
  raisedXLM: string;
  donorCount: number;
  verified: boolean;
  status: string;
}

function SkeletonCard({ colors }: { colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
      <View style={[styles.skeletonLine, { width: '40%', backgroundColor: colors.border }]} />
      <View style={[styles.skeletonLine, { width: '70%', marginTop: 8, height: 18, backgroundColor: colors.border }]} />
      <View style={[styles.skeletonLine, { width: '90%', marginTop: 6, backgroundColor: colors.border }]} />
      <View style={[styles.skeletonLine, { width: '60%', marginTop: 6, backgroundColor: colors.border }]} />
      <View style={[styles.skeletonProgress, { backgroundColor: colors.border, marginTop: 14 }]} />
    </View>
  );
}

function ProjectCard({
  project,
  colors,
  onPress,
}: {
  project: ClimateProject;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
}) {
  const progress = (() => {
    const r = parseFloat(project.raisedXLM);
    const g = parseFloat(project.goalXLM);
    if (!g || isNaN(r) || isNaN(g)) return 0;
    return Math.min(100, Math.round((r / g) * 100));
  })();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.cardBorder, shadowColor: colors.cardShadow }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.category, { color: colors.primary }]}>{project.category}</Text>
        <View style={styles.badgeRow}>
          {project.verified && (
            <View style={[styles.verifiedBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.verifiedText}>✓ Verified</Text>
            </View>
          )}
        </View>
      </View>

      <Text style={[styles.projectName, { color: colors.primaryText }]} numberOfLines={1}>
        {project.name}
      </Text>
      <Text style={[styles.projectDescription, { color: colors.secondaryText }]} numberOfLines={2}>
        {project.description}
      </Text>

      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: colors.primary }]} />
        </View>
        <View style={styles.progressRow}>
          <Text style={[styles.progressText, { color: colors.secondaryText }]}>
            {parseFloat(project.raisedXLM).toFixed(0)} / {parseFloat(project.goalXLM).toFixed(0)} XLM
          </Text>
          <Text style={[styles.donorCount, { color: colors.muted }]}>{project.donorCount} donors</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  const loadProjects = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) setRefreshing(true);
    setNetworkError(false);

    try {
      const res = await axios.get(`${API_URL}/api/projects`);
      const data: ClimateProject[] = res.data.data ?? res.data;
      setProjects(data);
      await setCachedData(CACHE_KEY_PROJECTS, data);
    } catch {
      const cached = await getCachedData<ClimateProject[]>(CACHE_KEY_PROJECTS);
      if (cached) {
        setProjects(cached.data);
      } else {
        setNetworkError(true);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const renderSkeleton = () => (
    <FlatList
      data={[1, 2, 3, 4, 5]}
      keyExtractor={(item: number) => String(item)}
      renderItem={() => <SkeletonCard colors={colors} />}
      contentContainerStyle={styles.listContent}
      scrollEnabled={false}
      ListHeaderComponent={<Header colors={colors} />}
    />
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {renderSkeleton()}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={projects}
        keyExtractor={(item: ClimateProject) => item.id}
        renderItem={({ item }: { item: ClimateProject }) => (
          <ProjectCard
            project={item}
            colors={colors}
            onPress={() => router.push(`/projects/${item.id}`)}
          />
        )}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={<Header colors={colors} />}
        ListEmptyComponent={
          networkError ? (
            <View style={styles.errorContainer}>
              <Text style={[styles.errorText, { color: colors.secondaryText }]}>
                Unable to load projects. Check your connection.
              </Text>
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: colors.primary }]}
                onPress={() => { setLoading(true); loadProjects(); }}
              >
                <Text style={[styles.retryText, { color: colors.buttonText }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.muted }]}>No projects found.</Text>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadProjects(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

function Header({ colors }: { colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={[styles.header, { backgroundColor: colors.primary }]}>
      <Text style={[styles.title, { color: colors.headerText }]}>Stellar GreenPay</Text>
      <Text style={[styles.subtitle, { color: colors.headerText }]}>Climate donations on Stellar</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  header: {
    padding: 24,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    marginTop: 4,
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  category: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  verifiedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  projectName: {
    fontSize: 17,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  projectDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  progressContainer: {
    marginTop: 12,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  progressText: {
    fontSize: 11,
  },
  donorCount: {
    fontSize: 11,
  },
  errorContainer: {
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  retryButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 48,
    fontSize: 15,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
  },
  skeletonProgress: {
    height: 6,
    borderRadius: 3,
    width: '100%',
  },
});
