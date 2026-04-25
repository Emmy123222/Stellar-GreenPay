/**
 * app/projects/[id].tsx
 * Project detail screen
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

interface ClimateProject {
  id: string;
  name: string;
  description: string;
  category: string;
  location: string;
  imageUrl?: string;
  goalXLM: string;
  raisedXLM: string;
  donorCount: number;
  co2OffsetKg: number;
  walletAddress: string;
  status: string;
}

export default function ProjectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [project, setProject] = useState<ClimateProject | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) loadProject(id as string);
  }, [id]);

  const loadProject = async (projectId: string) => {
    try {
      const res = await axios.get(`${API_URL}/api/projects/${projectId}`);
      setProject(res.data.data);
    } catch (error) {
      console.error('Error loading project:', error);
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
        <Text style={styles.loadingText}>Loading project...</Text>
      </View>
    );
  }

  if (!project) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Project not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.category}>{project.category}</Text>
        <Text style={styles.name}>{project.name}</Text>
        <Text style={styles.location}>📍 {project.location}</Text>
      </View>

      <View style={styles.statsCard}>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{parseFloat(project.raisedXLM).toFixed(2)}</Text>
            <Text style={styles.statLabel}>XLM Raised</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{project.donorCount}</Text>
            <Text style={styles.statLabel}>Donors</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{project.co2OffsetKg.toFixed(0)}</Text>
            <Text style={styles.statLabel}>kg CO₂</Text>
          </View>
        </View>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>Fundraising Progress</Text>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${progressPercent(project.raisedXLM, project.goalXLM)}%` }
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {progressPercent(project.raisedXLM, project.goalXLM)}% complete
        </Text>
        <Text style={styles.goalText}>
          Goal: {parseFloat(project.goalXLM).toFixed(2)} XLM
        </Text>
      </View>

      <View style={styles.descriptionCard}>
        <Text style={styles.sectionTitle}>About this project</Text>
        <Text style={styles.description}>{project.description}</Text>
      </View>

      <TouchableOpacity
        style={styles.donateButton}
        onPress={() => router.push(`/donate/${project.id}`)}
      >
        <Text style={styles.donateButtonText}>🌱 Donate Now</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f7f0',
  },
  loadingText: {
    fontSize: 18,
    color: '#5a7a5a',
    textAlign: 'center',
    marginTop: 40,
  },
  errorText: {
    fontSize: 18,
    color: '#5a7a5a',
    textAlign: 'center',
    marginTop: 40,
  },
  header: {
    padding: 24,
    backgroundColor: '#227239',
  },
  category: {
    fontSize: 14,
    color: '#e8f3e8',
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 8,
  },
  location: {
    fontSize: 14,
    color: '#e8f3e8',
    marginTop: 4,
  },
  statsCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#227239',
  },
  statLabel: {
    fontSize: 12,
    color: '#8aaa8a',
    marginTop: 4,
  },
  progressCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a2e1a',
    marginBottom: 12,
  },
  progressBar: {
    height: 12,
    backgroundColor: '#e8f3e8',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#227239',
  },
  progressText: {
    fontSize: 14,
    color: '#5a7a5a',
    marginTop: 8,
    textAlign: 'center',
  },
  goalText: {
    fontSize: 12,
    color: '#8aaa8a',
    marginTop: 4,
    textAlign: 'center',
  },
  descriptionCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a2e1a',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#5a7a5a',
    lineHeight: 20,
  },
  donateButton: {
    backgroundColor: '#227239',
    padding: 16,
    margin: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  donateButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
