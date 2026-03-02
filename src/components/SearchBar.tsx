import React, { useState } from 'react';
import { SearchField } from '@toss/tds-react-native';

interface SearchBarProps {
  onSearch?: (query: string) => void;
  placeholder?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  placeholder = '공연, 전시, 지역 검색',
}) => {
  const [value, setValue] = useState('');

  return (
    <SearchField
      value={value}
      placeholder={placeholder}
      hasClearButton
      onChange={(e) => setValue(e.nativeEvent.text)}
      {...({
        onSubmitEditing: () => {
          if (value.trim()) onSearch?.(value.trim());
        },
        returnKeyType: 'search',
      } as any)}
    />
  );
};
