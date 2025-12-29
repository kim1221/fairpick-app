import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import adminService, { AdminFeaturedEvent } from '../services/adminService';

export const Route = createRoute('/admin', {
  component: Page,
});

function Page() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [events, setEvents] = useState<AdminFeaturedEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Check if admin key exists in localStorage
    const checkAuth = async () => {
      const storedKey = adminService['getAdminKey']();
      if (storedKey) {
        const isValid = await adminService.verifyAdminKey(storedKey);
        if (isValid) {
          setIsAuthenticated(true);
          loadFeaturedEvents();
        } else {
          adminService.clearAdminKey();
        }
      }
    };
    checkAuth();
  }, []);

  const handleLogin = async () => {
    if (!adminKey.trim()) {
      Alert.alert('에러', 'Admin Key를 입력해주세요.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const isValid = await adminService.verifyAdminKey(adminKey);
      if (isValid) {
        adminService.setAdminKey(adminKey);
        setIsAuthenticated(true);
        loadFeaturedEvents();
      } else {
        Alert.alert('인증 실패', 'Invalid Admin Key');
      }
    } catch (error) {
      Alert.alert('에러', '인증에 실패했습니다.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const loadFeaturedEvents = async () => {
    setIsLoading(true);
    try {
      const response = await adminService.getFeaturedEvents();
      setEvents(response.items);
    } catch (error) {
      Alert.alert('에러', 'Featured 이벤트를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    adminService.clearAdminKey();
    setIsAuthenticated(false);
    setAdminKey('');
    setEvents([]);
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.loginContainer}>
        <View style={styles.loginBox}>
          <Text style={styles.loginTitle}>Admin Login</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Admin Key"
            value={adminKey}
            onChangeText={setAdminKey}
            secureTextEntry
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleLogin}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>Login</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Featured 이벤트 관리</Text>
        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={handleLogout}>
          <Text style={styles.buttonText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0064FF" />
        </View>
      ) : (
        <ScrollView style={styles.scrollView}>
          <TouchableOpacity style={[styles.button, styles.primaryButton, styles.refreshButton]} onPress={loadFeaturedEvents}>
            <Text style={styles.buttonText}>새로고침</Text>
          </TouchableOpacity>

          {events.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Featured 이벤트가 없습니다.</Text>
            </View>
          ) : (
            events.map((event) => <EventItem key={event.id} event={event} onUpdate={loadFeaturedEvents} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

interface EventItemProps {
  event: AdminFeaturedEvent;
  onUpdate: () => void;
}

function EventItem({ event, onUpdate }: EventItemProps) {
  const [isFeatured, setIsFeatured] = useState(event.isFeatured);
  const [featuredOrder, setFeaturedOrder] = useState(event.featuredOrder?.toString() ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const orderValue = featuredOrder.trim() === '' ? null : parseInt(featuredOrder, 10);

      if (orderValue !== null && (isNaN(orderValue) || orderValue < 1)) {
        Alert.alert('에러', 'Featured Order는 1 이상의 정수여야 합니다.');
        setIsSaving(false);
        return;
      }

      await adminService.updateFeaturedStatus(event.id, {
        is_featured: isFeatured,
        featured_order: orderValue,
      });

      Alert.alert('성공', 'Featured 상태가 업데이트되었습니다.');
      onUpdate();
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || '업데이트에 실패했습니다.';
      Alert.alert('에러', errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges =
    isFeatured !== event.isFeatured ||
    (featuredOrder.trim() === '' ? null : parseInt(featuredOrder, 10)) !==
      event.featuredOrder;

  return (
    <View style={styles.eventCard}>
      <Text style={styles.eventTitle}>{event.title}</Text>
      <Text style={styles.eventSubtitle}>
        {event.mainCategory} &gt; {event.subCategory}
      </Text>
      <Text style={styles.eventInfo}>지역: {event.region}</Text>
      <Text style={styles.eventInfo}>
        기간: {formatDate(event.startAt)} ~ {formatDate(event.endAt)}
      </Text>

      <View style={styles.controlsContainer}>
        <View style={styles.toggleContainer}>
          <Text style={styles.controlLabel}>Featured:</Text>
          <TouchableOpacity
            style={[styles.toggleButton, isFeatured && styles.toggleButtonActive]}
            onPress={() => setIsFeatured(!isFeatured)}
          >
            <Text style={[styles.toggleText, isFeatured && styles.toggleTextActive]}>
              {isFeatured ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.orderContainer}>
          <Text style={styles.controlLabel}>Order:</Text>
          <TextInput
            style={styles.orderInput}
            value={featuredOrder}
            onChangeText={setFeaturedOrder}
            keyboardType="number-pad"
            placeholder="null"
            placeholderTextColor="#999"
          />
        </View>

        <TouchableOpacity
          style={[
            styles.button,
            styles.primaryButton,
            styles.saveButton,
            (!hasChanges || isSaving) && styles.disabledButton,
          ]}
          onPress={handleSave}
          disabled={!hasChanges || isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Text style={styles.buttonText}>저장</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

const styles = StyleSheet.create({
  loginContainer: {
    flex: 1,
    backgroundColor: '#F7FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loginBox: {
    backgroundColor: 'white',
    padding: 32,
    borderRadius: 12,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  loginTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1A202C',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: 'white',
  },
  container: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  header: {
    backgroundColor: 'white',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  refreshButton: {
    marginBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    padding: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#718096',
  },
  eventCard: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  eventTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A202C',
    marginBottom: 8,
  },
  eventSubtitle: {
    fontSize: 14,
    color: '#4A5568',
    marginBottom: 4,
  },
  eventInfo: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 2,
  },
  controlsContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3748',
    marginRight: 8,
  },
  toggleButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
    borderWidth: 1,
    borderColor: '#CBD5E0',
  },
  toggleButtonActive: {
    backgroundColor: '#0064FF',
    borderColor: '#0064FF',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4A5568',
  },
  toggleTextActive: {
    color: 'white',
  },
  orderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 6,
    padding: 6,
    width: 80,
    fontSize: 14,
    textAlign: 'center',
    backgroundColor: 'white',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  primaryButton: {
    backgroundColor: '#0064FF',
  },
  secondaryButton: {
    backgroundColor: '#718096',
  },
  saveButton: {
    marginLeft: 'auto',
  },
  disabledButton: {
    backgroundColor: '#CBD5E0',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
