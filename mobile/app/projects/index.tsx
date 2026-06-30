/**
 * app/projects/index.tsx
 * Projects browse screen — with offline cache support (#482)
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useTheme } from '../theme';
import { getCachedData, setCachedData } from '../../utils/cache';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';
const CACHE_KEY_PROJECTS = 'projects:list';

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

export default function ProjectsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<ClimateProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      setFilteredProjects(
        projects.filter(p =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.category.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    } else {
      setFilteredProjects(projects);
    }
  }, [searchQuery, projects]);

  const loadProjects = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/projects`);
      const data = res.data.data;
      setProjects(data);
      setFilteredProjects(data);
      setIsOffline(false);
      await setCachedData(CACHE_KEY_PROJECTS, data);
    } catch (error) {
      const cached = await getCachedData<ClimateProject[]>(CACHE_KEY_PROJECTS);
      if (cached) {
        setProjects(cached.data);
        setFilteredProjects(cached.data);
        setIsOffline(true);
      } else {
        console.error('Error loading projects:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const progressPercent = (raised: string, goal: string) => {
    const r = parseFloat(raised);
    const g = parseFloat(goal);
    if (!g || isNaN(r) || isNaN(g)) return 0;
    return Math.min(100, Math.round((r / g) * 100));
  };

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
        <View style={styles.offlineBanner} accessibilityRole="alert" accessibilityLabel="Offline — showing cached data">
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
      <ScrollView style={[styles.scroll, { borderColor: colors.background }]}>
        {filteredProjects.map(project => (
          <TouchableOpacity
            key={project.id}
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
              <View style={[styles.progressBar, { backgroundColor: colors.border }]}> 
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progressPercent(project.raisedXLM, project.goalXLM)}%`, backgroundColor: colors.primary }
                  ]}
                />
              </View>
              <Text style={[styles.progressText, { color: colors.secondaryText }]}> 
                {parseFloat(project.raisedXLM).toFixed(2)} / {parseFloat(project.goalXLM).toFixed(2)} XLM
              </Text>
            </View>
            <Text style={[styles.donorCount, { color: colors.muted }]}>{project.donorCount} donors</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
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
  loadingText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 40,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
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
