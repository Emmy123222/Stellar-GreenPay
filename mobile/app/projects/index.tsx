/**
 * app/projects/index.tsx
 * Projects browse screen
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

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
  const [projects, setProjects] = useState<ClimateProject[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<ClimateProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

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
      setProjects(res.data.data);
      setFilteredProjects(res.data.data);
    } catch (error) {
      console.error('Error loading projects:', error);
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
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading projects...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search projects..."
        value={searchQuery}
        onChangeText={setSearchQuery}
      />
      <ScrollView style={styles.scroll}>
        {filteredProjects.map(project => (
          <TouchableOpacity
            key={project.id}
            style={styles.card}
            onPress={() => router.push(`/projects/${project.id}`)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.category}>{project.category}</Text>
              <Text style={styles.status}>{project.status}</Text>
            </View>
            <Text style={styles.name}>{project.name}</Text>
            <Text style={styles.description} numberOfLines={2}>
              {project.description}
            </Text>
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progressPercent(project.raisedXLM, project.goalXLM)}%` }
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {parseFloat(project.raisedXLM).toFixed(2)} / {parseFloat(project.goalXLM).toFixed(2)} XLM
              </Text>
            </View>
            <Text style={styles.donorCount}>{project.donorCount} donors</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f7f0',
  },
  searchInput: {
    margin: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    fontSize: 16,
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  loadingText: {
    fontSize: 18,
    color: '#5a7a5a',
    textAlign: 'center',
    marginTop: 40,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  category: {
    fontSize: 12,
    color: '#227239',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  status: {
    fontSize: 12,
    color: '#5a7a5a',
  },
  name: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a2e1a',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    color: '#5a7a5a',
    marginBottom: 12,
  },
  progressContainer: {
    marginTop: 8,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#e8f3e8',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#227239',
  },
  progressText: {
    fontSize: 12,
    color: '#5a7a5a',
    marginTop: 4,
  },
  donorCount: {
    fontSize: 12,
    color: '#8aaa8a',
    marginTop: 8,
  },
});
