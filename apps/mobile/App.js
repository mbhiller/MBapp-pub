import 'react-native-gesture-handler';
import * as React from 'react';
import { Provider as PaperProvider } from 'react-native-paper';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Pressable, Text } from 'react-native';

import TenantsScreen from './src/features/tenants/TenantsScreen';
import ScanScreen from './src/screens/ScanScreen';
import ObjectDetailScreen from './src/screens/ObjectDetailScreen';

const Stack = createNativeStackNavigator();
const qc = new QueryClient();

export default function App() {
  return (
    <PaperProvider>
      <QueryClientProvider client={qc}>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen
              name="Tenants"
              component={TenantsScreen}
              options={({ navigation }) => ({
                title: 'Tenants',
                headerRight: () => (
                  <Pressable onPress={() => navigation.navigate('Scan')} style={{ paddingHorizontal: 8 }}>
                    <Text style={{ fontWeight: '600' }}>Scan</Text>
                  </Pressable>
                ),
              })}
            />
            <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scan' }} />
            <Stack.Screen name="ObjectDetail" component={ObjectDetailScreen} options={{ title: 'Object' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>
    </PaperProvider>
  );
}
