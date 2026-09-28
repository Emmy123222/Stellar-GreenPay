/**
 * app/impact.tsx
 * My Impact screen - donor stats, history, and shareable certificate
 */
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { useTheme } from './theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

interface Donation {
  id: string;
  projectId: string;
  amount: string;
  currency: string;
  createdAt: string;
  co2OffsetKg?: number;
  message?: string;
}

interface MonthlyImpactPoint {
  key: string;
  label: string;
  value: number;
}

interface DonorProfile {
  publicKey: string;
  displayName?: string;
  totalDonatedXLM: string;
  projectsSupported: number;
  badges: any[];
}

interface ImpactStats {
  co2OffsetKg: number;
  projectsSupported: number;
}

function buildMonthlyImpactPoints(donations: Donation[]): MonthlyImpactPoint[] {
  const monthlyTotals = new Map<number, number>();

  donations.forEach(donation => {
    if (typeof donation.co2OffsetKg !== 'number' || !Number.isFinite(donation.co2OffsetKg)) return;

    const date = new Date(donation.createdAt);
    if (Number.isNaN(date.getTime())) return;

    const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth();
    monthlyTotals.set(monthIndex, (monthlyTotals.get(monthIndex) ?? 0) + donation.co2OffsetKg);
  });

  if (monthlyTotals.size === 0) return [];

  const firstMonth = Math.min(...monthlyTotals.keys());
  const lastMonth = Math.max(...monthlyTotals.keys());
  const points: MonthlyImpactPoint[] = [];

  for (let monthIndex = firstMonth; monthIndex <= lastMonth; monthIndex += 1) {
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    const date = new Date(Date.UTC(year, month, 1));
    points.push({
      key: `${year}-${month + 1}`,
      label: date.toLocaleDateString(undefined, {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }),
      value: monthlyTotals.get(monthIndex) ?? 0,
    });
  }

  return points;
}

export default function ImpactScreen() {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<DonorProfile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [impactStats, setImpactStats] = useState<ImpactStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [publicKey, setPublicKey] = useState('');
  const [chartViewportWidth, setChartViewportWidth] = useState(0);
  const [selectedImpactKey, setSelectedImpactKey] = useState<string | null>(null);
  const certificateRef = useRef<any>(null);
  const monthlyImpact = buildMonthlyImpactPoints(donations);
  const chartWidth = Math.max(chartViewportWidth, monthlyImpact.length * 68, 120);
  const chartMaxValue = Math.max(
    1,
    Math.ceil(Math.max(0, ...monthlyImpact.map(point => point.value)) / 4) * 4
  );
  const chartHeight = 188;
  const chartCoordinates = monthlyImpact.map((point, index) => ({
    ...point,
    x: monthlyImpact.length === 1
      ? chartWidth / 2
      : 24 + index * (chartWidth - 48) / (monthlyImpact.length - 1),
    y: chartHeight - 20 - (point.value / chartMaxValue) * (chartHeight - 40),
  }));
  const selectedImpact = chartCoordinates.find(point => point.key === selectedImpactKey);

  useEffect(() => {
    const demoKey = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
    setPublicKey(demoKey);
    loadImpactData(demoKey);
  }, []);

  const loadImpactData = async (pk: string) => {
    try {
      const [profileRes, donationsRes, impactRes] = await Promise.all([
        axios.get(`${API_URL}/api/profiles/${pk}`).catch(() => ({ data: { data: null } })),
        axios.get(`${API_URL}/api/donations/donor/${pk}`).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_URL}/api/impact/donor/${pk}`).catch(() => ({ data: { data: null } })),
      ]);
      setProfile(profileRes.data.data);
      setDonations(donationsRes.data.data);
      setImpactStats(impactRes.data.data);
    } catch (error) {
      console.error('Error loading impact data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      const uri = await captureRef(certificateRef, { format: 'png', quality: 1.0 });
      // Prefix with file:// for Android compatibility
      const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/png',
        dialogTitle: 'Share your impact certificate',
      });
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.loadingText, { color: colors.secondaryText }]}>Loading your impact...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <Text style={[styles.title, { color: colors.headerText }]}>My Impact</Text>
        <Text style={[styles.subtitle, { color: colors.headerText }]}>{publicKey.slice(0, 8)}...{publicKey.slice(-4)}</Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
          <Text style={[styles.statIcon, { color: colors.accent }]}>💚</Text>
          <Text style={[styles.statValue, { color: colors.accent }]}>
            {profile ? parseFloat(profile.totalDonatedXLM).toFixed(2) : '0'}
          </Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>XLM Donated</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
          <Text style={[styles.statIcon, { color: colors.accent }]}>🌍</Text>
          <Text style={[styles.statValue, { color: colors.accent }]}>
            {profile ? profile.projectsSupported : 0}
          </Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Projects</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
          <Text style={[styles.statIcon, { color: colors.accent }]}>🏆</Text>
          <Text style={[styles.statValue, { color: colors.accent }]}>
            {profile ? profile.badges.length : 0}
          </Text>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Badges</Text>
        </View>
      </View>

      <View style={[styles.chartCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
        <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>Monthly CO₂ offset</Text>
        {monthlyImpact.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No monthly impact data available</Text>
        ) : (
          <>
            <Text style={[styles.chartAxisTitle, { color: colors.secondaryText }]}>CO₂ offset (kg)</Text>
            <View style={styles.chartRow}>
              <View style={styles.chartTicks}>
                {[4, 3, 2, 1, 0].map(tick => (
                  <Text key={tick} style={[styles.chartTick, { color: colors.muted }]}>
                    {Math.round(chartMaxValue * tick / 4)}
                  </Text>
                ))}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                onLayout={event => setChartViewportWidth(event.nativeEvent.layout.width)}
              >
                <View style={{ width: chartWidth }}>
                  <View style={[styles.chartPlot, { height: chartHeight }]}>
                    {[0, 1, 2, 3, 4].map(tick => (
                      <View
                        key={tick}
                        style={[styles.chartGridline, { top: 20 + tick * (chartHeight - 40) / 4, backgroundColor: colors.border }]}
                      />
                    ))}
                    {chartCoordinates.slice(0, -1).map((point, index) => {
                      const nextPoint = chartCoordinates[index + 1];
                      const width = Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y);
                      const angle = Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x);

                      return (
                        <View
                          key={`${point.key}-${nextPoint.key}`}
                          style={[
                            styles.chartLine,
                            {
                              width,
                              left: (point.x + nextPoint.x - width) / 2,
                              top: (point.y + nextPoint.y) / 2,
                              backgroundColor: colors.accent,
                              transform: [{ rotate: `${angle}rad` }],
                            },
                          ]}
                        />
                      );
                    })}
                    {chartCoordinates.map(point => (
                      <TouchableOpacity
                        key={point.key}
                        accessibilityRole="button"
                        accessibilityLabel={`${point.label}: ${point.value} kg CO₂ offset`}
                        accessibilityState={{ selected: point.key === selectedImpactKey }}
                        onPress={() => setSelectedImpactKey(point.key)}
                        style={[styles.chartPointHit, { left: point.x - 18, top: point.y - 18 }]}
                      >
                        <View
                          style={[
                            styles.chartPoint,
                            { backgroundColor: colors.accent, borderColor: colors.surface },
                            point.key === selectedImpactKey && styles.chartPointSelected,
                          ]}
                        />
                      </TouchableOpacity>
                    ))}
                    {selectedImpact && (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.chartTooltip,
                          {
                            left: Math.max(0, Math.min(selectedImpact.x - 48, chartWidth - 96)),
                            top: Math.max(0, selectedImpact.y - 52),
                            backgroundColor: colors.primaryText,
                          },
                        ]}
                      >
                        <Text style={styles.chartTooltipText}>{selectedImpact.label}</Text>
                        <Text style={styles.chartTooltipValue}>{selectedImpact.value} kg CO₂</Text>
                      </View>
                    )}
                  </View>
                  <View style={[styles.chartXLabels, { height: 28 }]}>
                    {chartCoordinates.map(point => (
                      <Text
                        key={point.key}
                        numberOfLines={1}
                        style={[
                          styles.chartXLabel,
                          { left: point.x - 30, color: colors.muted },
                        ]}
                      >
                        {point.label}
                      </Text>
                    ))}
                  </View>
                </View>
              </ScrollView>
            </View>
          </>
        )}
      </View>

      <View style={[styles.historyCard, { backgroundColor: colors.surface, shadowColor: colors.cardShadow, borderColor: colors.cardBorder }]}>
        <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>Donation History</Text>
        {donations.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No donations yet</Text>
        ) : (
          donations.map(donation => (
            <View key={donation.id} style={[styles.donationRow, { borderBottomColor: colors.border }]}>
              <View style={styles.donationInfo}>
                <Text style={[styles.donationProject, { color: colors.primaryText }]}>Project {donation.projectId.slice(0, 8)}</Text>
                {donation.message && (
                  <Text style={[styles.donationMessage, { color: colors.secondaryText }]}>"{donation.message}"</Text>
                )}
              </View>
              <View style={styles.donationAmount}>
                <Text style={[styles.amount, { color: colors.accent }]}>
                  {donation.currency === 'USDC'
                    ? `$${parseFloat(donation.amount).toFixed(2)} USDC`
                    : `${parseFloat(donation.amount).toFixed(2)} XLM`}
                </Text>
                <Text style={[styles.date, { color: colors.muted }]}>
                  {new Date(donation.createdAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Impact Certificate — captured as PNG for sharing */}
      <View
        ref={certificateRef}
        collapsable={false}
        style={styles.certificateCard}
      >
        <Text style={styles.certBrand}>Stellar GreenPay</Text>
        <Text style={styles.certTitle}>Climate Impact Certificate</Text>
        <Text style={styles.certRow}>
          {publicKey.slice(0, 8)}...{publicKey.slice(-4)}
        </Text>
        <Text style={styles.certRow}>
          CO₂ Offset: {impactStats?.co2OffsetKg ?? 0} kg
        </Text>
        <Text style={styles.certRow}>
          Total Donated: {profile ? parseFloat(profile.totalDonatedXLM).toFixed(2) : '0'} XLM
        </Text>
      </View>

      <TouchableOpacity
        onPress={handleShare}
        disabled={loading}
        style={styles.shareButton}
        accessibilityLabel="Share your climate impact certificate"
        accessibilityRole="button"
      >
        <Text style={styles.shareButtonText}>Share Certificate</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 40,
  },
  header: {
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  statIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  chartCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 20,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  chartAxisTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  chartRow: {
    flexDirection: 'row',
  },
  chartTicks: {
    width: 36,
    height: 188,
    paddingVertical: 20,
    justifyContent: 'space-between',
  },
  chartTick: {
    fontSize: 10,
    textAlign: 'right',
    paddingRight: 8,
  },
  chartPlot: {
    position: 'relative',
  },
  chartGridline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  chartLine: {
    position: 'absolute',
    height: 2,
    transformOrigin: 'center',
  },
  chartPointHit: {
    position: 'absolute',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartPoint: {
    width: 12,
    height: 12,
    borderWidth: 2,
    borderRadius: 6,
  },
  chartPointSelected: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  chartTooltip: {
    position: 'absolute',
    minWidth: 96,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: 'center',
    zIndex: 2,
  },
  chartTooltipText: {
    color: '#ffffff',
    fontSize: 10,
  },
  chartTooltipValue: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  chartXLabels: {
    position: 'relative',
  },
  chartXLabel: {
    position: 'absolute',
    width: 60,
    textAlign: 'center',
    fontSize: 10,
  },
  historyCard: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  donationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  donationInfo: {
    flex: 1,
  },
  donationProject: {
    fontSize: 14,
    fontWeight: '600',
  },
  donationMessage: {
    fontSize: 12,
    marginTop: 2,
  },
  donationAmount: {
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  date: {
    fontSize: 10,
    marginTop: 2,
  },
  certificateCard: {
    margin: 16,
    padding: 24,
    borderRadius: 12,
    backgroundColor: '#227239',
  },
  certBrand: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  certTitle: {
    color: '#d4edda',
    fontSize: 14,
    marginBottom: 16,
  },
  certRow: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 8,
  },
  shareButton: {
    margin: 16,
    marginTop: 0,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#227239',
    alignItems: 'center',
  },
  shareButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});
