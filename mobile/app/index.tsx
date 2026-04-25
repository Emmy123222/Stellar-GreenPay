/**
 * app/index.tsx
 * Home screen - featured projects and global stats
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Image } from 'react-native';
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
}

export default function HomeScreen() {
  const router = useRouter();
  const [featuredProject, setFeaturedProject] = useState<ClimateProject | null>(null);
  const [globalStats, setGlobalStats] = useState({ totalDonations: 0, totalXLMRaised: '0' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [featuredRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/api/projects/featured`),
        axios.get(`${API_URL}/api/stats/global`)
      ]);
      setFeaturedProject(featuredRes.data.data);
      setGlobalStats(statsRes.data.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Stellar GreenPay</Text>
        <Text style={styles.subtitle}>Climate donations on Stellar</Text>
      </View>

      <View style={styles.statsCard}>
        <Text style={styles.statsTitle}>Global Impact</Text>
        <Text style={styles.statsValue}>{globalStats.totalDonations} donations</Text>
        <Text style={styles.statsSub}>{globalStats.totalXLMRaised} XLM raised</Text>
      </View>

      {featuredProject && (
        <View style={styles.featuredCard}>
          <Text style={styles.featuredTitle}>Featured Project</Text>
          <Text style={styles.projectName}>{featuredProject.name}</Text>
          <Text style={styles.projectDescription} numberOfLines={3}>
            {featuredProject.description}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push(`/projects/${featuredProject.id}`)}
          >
            <Text style={styles.buttonText}>View Project</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={styles.browseButton}
        onPress={() => router.push('/projects')}
      >
        <Text style={styles.browseButtonText}>Browse All Projects</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f7f0',
  },
  header: {
    padding: 24,
    backgroundColor: '#227239',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    fontFamily: 'Lora_700Bold',
  },
  subtitle: {
    fontSize: 16,
    color: '#e8f3e8',
    marginTop: 4,
  },
  loadingText: {
    fontSize: 18,
    color: '#5a7a5a',
    textAlign: 'center',
    marginTop: 40,
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
  statsTitle: {
    fontSize: 14,
    color: '#8aaa8a',
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  statsValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#227239',
    marginTop: 8,
  },
  statsSub: {
    fontSize: 16,
    color: '#5a7a5a',
    marginTop: 4,
  },
  featuredCard: {
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
  featuredTitle: {
    fontSize: 14,
    color: '#8aaa8a',
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  projectName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a2e1a',
    marginTop: 8,
  },
  projectDescription: {
    fontSize: 14,
    color: '#5a7a5a',
    marginTop: 8,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#227239',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  browseButton: {
    backgroundColor: '#e8f3e8',
    padding: 16,
    margin: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  browseButtonText: {
    color: '#227239',
    fontSize: 16,
    fontWeight: '600',
  },
});
