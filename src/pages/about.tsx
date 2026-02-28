import { createRoute } from '@granite-js/react-native';
import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

export const Route = createRoute('/about', {
  component: Page,
});

type Adaptive = ReturnType<typeof useAdaptive>;

const createStyles = (a: Adaptive) => StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: a.grey100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: a.grey900,
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 18,
    color: a.grey700,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 26,
  },
  button: {
    marginTop: 24,
    backgroundColor: a.blue500,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

function Page() {
  const navigation = Route.useNavigation();
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const handleGoBack = () => {
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>About Granite</Text>
      <Text style={styles.description}>Granite is a powerful and flexible React Native Framework 🚀</Text>
      <TouchableOpacity style={styles.button} onPress={handleGoBack}>
        <Text style={styles.buttonText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}
