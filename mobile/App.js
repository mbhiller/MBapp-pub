// App.js
import 'react-native-gesture-handler';
import * as React from 'react';
import { Provider as PaperProvider } from 'react-native-paper';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import TenantsScreen from './src/features/tenants/TenantsScreen';

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
              options={{ title: 'Tenants' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>
    </PaperProvider>
  );
}
