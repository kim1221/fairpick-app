import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

type Adaptive = ReturnType<typeof useAdaptive>;

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

  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

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

const createStyles = (a: Adaptive) => StyleSheet.create({
  scrollView: {
    flexGrow: 0,
  },
  chipContainer: {
    paddingHorizontal: 20,
  },
  chip: {
    backgroundColor: a.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: a.grey200,
  },
  chipActive: {
    backgroundColor: a.blue500,
    borderColor: a.blue500,
  },
  chipSecondary: {
    backgroundColor: a.grey100,
    borderColor: a.grey100,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: a.grey700,
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
});
