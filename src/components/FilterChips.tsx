import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

interface FilterChipsProps {
  selectedRegion?: string;
  selectedCategory?: string;
  onRegionSelect?: (region: string) => void;
  onCategorySelect?: (category: string) => void;
}

export const FilterChips: React.FC<FilterChipsProps> = ({
  selectedRegion: initialRegion = '전국',
  selectedCategory: initialCategory,
  onRegionSelect,
  onCategorySelect,
}) => {
  const [selectedRegion, setSelectedRegion] = useState(initialRegion);
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  
  const regions = ['전국', '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종'];
  const categories = ['축제', '공연', '전시', '행사'];
  
  const handleRegionPress = (region: string) => {
    setSelectedRegion(region);
    onRegionSelect?.(region);
  };
  
  const handleCategoryPress = (category: string) => {
    setSelectedCategory(selectedCategory === category ? undefined : category);
    onCategorySelect?.(category);
  };
  
  return (
    <View>
      {/* 지역 필터 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scrollView}
        contentContainerStyle={styles.chipContainer}
      >
        {regions.map((region) => (
          <TouchableOpacity
            key={region}
            style={[
              styles.chip,
              selectedRegion === region && styles.chipActive,
            ]}
            onPress={() => handleRegionPress(region)}
          >
            <Text
              style={[
                styles.chipText,
                selectedRegion === region && styles.chipTextActive,
              ]}
            >
              {region}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      
      {/* 카테고리 필터 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.scrollView, { marginTop: 8 }]}
        contentContainerStyle={styles.chipContainer}
      >
        {categories.map((category) => (
          <TouchableOpacity
            key={category}
            style={[
              styles.chip,
              selectedCategory === category ? styles.chipActive : styles.chipSecondary,
            ]}
            onPress={() => handleCategoryPress(category)}
          >
            <Text
              style={[
                styles.chipText,
                selectedCategory === category && styles.chipTextActive,
              ]}
            >
              {category}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flexGrow: 0,
  },
  chipContainer: {
    paddingHorizontal: 20,
  },
  chip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E8EB',
  },
  chipActive: {
    backgroundColor: '#3182F6',
    borderColor: '#3182F6',
  },
  chipSecondary: {
    backgroundColor: '#F2F4F6',
    borderColor: '#F2F4F6',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4E5968',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
});

