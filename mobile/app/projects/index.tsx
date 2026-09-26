/**
 * app/projects/index.tsx
 * Projects browse screen — with offline cache support (#482)
 *
 * Search is debounced (300ms) and every in-flight request is aborted when a
 * newer one starts, so typing a query fires a single API call instead of one
 * per keystroke (#1129).
 */
import { ActivityIndicator, FlatList, View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListRenderItemInfo } from 'react-native';
import axios from 'axios';
import { useTheme } from '../theme';
import { getCachedData, setCachedData } from '../../utils/cache';
import { useDebounce } from '../../hooks/useDebounce';


const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const CACHE_KEY_PROJECTS = 'projects:list';
const PROJECT_CARD_HEIGHT = 206;

interface ClimateProject {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl?: string;
  goalXLM: string;
  raisedXLM: string;
  donorCount: number;
  status: string;
}

const getProjectItemLayout = (_: ArrayLike<ClimateProject> | null | undefined, index: number) => ({
  length: PROJECT_CARD_HEIGHT,
  offset: PROJECT_CARD_HEIGHT * index,
  index,
});

/** Axios throws this when a request is cancelled through its AbortSignal. */
const isCanceled = (error: unknown) => {
  const err = error as { code?: string; name?: string } | null;
  return err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError';
};

const progressPercent = (raised: string, goal: string) => {
  const raisedAmount = parseFloat(raised);
  const goalAmount = parseFloat(goal);
  if (!goalAmount || isNaN(raisedAmount) || isNaN(goalAmount)) return 0;
  return Math.min(100, Math.round((raisedAmount / goalAmount) * 100));
};

export default function ProjectsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounce(searchQuery);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  // Full unfiltered list, used to filter locally when a search fails offline.
  const allProjectsRef = useRef<ClimateProject[]>([]);

  const loadProjects = useCallback(async (query: string, signal: AbortSignal) => {
    const isInitialLoad = query === '';
    if (isInitialLoad) setLoading(true);
    else setSearching(true);

    try {
      const url = query
        ? `${API_URL}/api/projects?search=${encodeURIComponent(query)}`
        : `${API_URL}/api/projects`;
      const res = await axios.get(url, { signal });
      const data = res.data.data as ClimateProject[];
      if (isInitialLoad) {
        allProjectsRef.current = data;
        setIsOffline(false);
        await setCachedData(CACHE_KEY_PROJECTS, data);
      }
      setProjects(data);
    } catch (error) {
      if (isCanceled(error)) return;
      if (isInitialLoad) {
        const cached = await getCachedData<ClimateProject[]>(CACHE_KEY_PROJECTS);
        if (cached) {
          allProjectsRef.current = cached.data;
          setProjects(cached.data);
          setIsOffline(true);
        } else {
          console.error('Error loading projects:', error);
        }
      } else {
        // Search failed (e.g. offline) — filter the already-loaded list locally.
        const needle = query.toLowerCase();
        setProjects(
          allProjectsRef.current.filter(p =>
            p.name.toLowerCase().includes(needle) || p.category.toLowerCase().includes(needle)
          )
        );
      }
    } finally {
      if (isInitialLoad) setLoading(false);
      else setSearching(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadProjects(debouncedQuery, controller.signal);
    // Abort the in-flight request when the query changes or on unmount so a
    // stale response can never overwrite a newer one.
    return () => controller.abort();
  }, [debouncedQuery, loadProjects]);

  const renderProject = useCallback(({ item: project }: ListRenderItemInfo<ClimateProject>) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}
      onPress={() => router.push(`/projects/${project.id}`)}
      accessibilityLabel={`View ${project.name} project`}
      accessibilityRole="button"
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.category, { color: colors.primary }]}>{project.category}</Text>
        <Text style={[styles.status, { color: colors.secondaryText }]}>{project.status}</Text>
      </View>
      <Text style={[styles.name, { color: colors.primaryText }]}>{project.name}</Text>
      <Text style={[styles.description, { color: colors.secondaryText }]} numberOfLines={2}>
        {project.description}
      </Text>
      <View style={styles.progressContainer}>
        <View
          style={[styles.progressBar, { backgroundColor: colors.border }]}
        >
          <View
            style={[
              styles.progressFill,
              { width: `${progressPercent(project.raisedXLM, project.goalXLM)}%`, backgroundColor: colors.primary }
            ]}
          />
        </View>
        <Text style={[styles.progressText, { color: colors.secondaryText }]}
        >
          {parseFloat(project.raisedXLM).toFixed(2)} / {parseFloat(project.goalXLM).toFixed(2)} XLM
        </Text>
      </View>
      <Text style={[styles.donorCount, { color: colors.muted }]}>{project.donorCount} donors</Text>
    </TouchableOpacity>
  ), [colors, router]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}> 
        <Text style={[styles.loadingText, { color: colors.secondaryText }]}>Loading projects...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Offline — showing cached data</Text>
        </View>
      )}
      <TextInput

        style={[styles.searchInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.primaryText }]}
        placeholder="Search projects..."
        placeholderTextColor={colors.placeholder}
        value={searchQuery}
        onChangeText={setSearchQuery}
        accessibilityLabel="Search projects"
        accessibilityRole="search"
      />
      {searching && (
        <View style={styles.searchStatus} accessibilityRole="alert" accessibilityLabel="Searching projects">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.searchStatusText, { color: colors.secondaryText }]}>Searching…</Text>
        </View>
      )}
      <FlatList
        style={[styles.scroll, { borderColor: colors.background }]}
        data={projects}
        renderItem={renderProject}
        keyExtractor={(item) => item.id}
        getItemLayout={getProjectItemLayout}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchInput: {
    margin: 16,
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  searchStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -4,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  searchStatusText: {
    fontSize: 13,
  },
  loadingText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 40,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    height: PROJECT_CARD_HEIGHT,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  category: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  status: {
    fontSize: 12,
  },
  name: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    marginBottom: 12,
  },
  progressContainer: {
    marginTop: 8,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 12,
    marginTop: 4,
  },
  donorCount: {
    fontSize: 12,
    marginTop: 8,
  },
  offlineBanner: {
    backgroundColor: '#f5a623',
    padding: 8,
    alignItems: 'center',
  },
  offlineBannerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
