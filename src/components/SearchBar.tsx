import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';

export const SearchBar: React.FC = () => {
  const handlePress = () => {
    Alert.alert('준비 중', '검색 기능은 곧 추가될 예정입니다.');
  };
  
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>🔍</Text>
      <Text style={styles.placeholder}>공연, 전시, 지역 검색</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  icon: {
    fontSize: 18,
    marginRight: 10,
  },
  placeholder: {
    fontSize: 15,
    color: '#B0B8C1',
  },
});

