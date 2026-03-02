import { createRoute } from '@granite-js/react-native';
import React, { useEffect } from 'react';
import { View, Text, Alert } from 'react-native';

function TestPage() {
  console.log('🟢 TEST ROUTE HIT!');
  console.warn('🟢 TEST WARN!');
  console.error('🟢 TEST ERROR!');

  useEffect(() => {
    Alert.alert('TEST ROUTE', 'test-route.tsx is rendering!');
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00FF00' }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold' }}>
        🟢 TEST ROUTE WORKS!
      </Text>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createRoute as any)('/test-route', {
  component: TestPage,
});
