import { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { Snackbar } from 'react-native-paper';

import { useTenants } from './useTenants';

export default function TenantsScreen() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch, error } = useTenants();
  const [refreshing, setRefreshing] = useState(false);
  const [snackbar, setSnackbar] = useState<{ visible: boolean; msg: string }>({
    visible: false,
    msg: '',
  });

  const showSnack = (msg: string) => setSnackbar({ visible: true, msg });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    showSnack('Refreshing…');
    try {
      await refetch({ throwOnError: false });
      showSnack('Updated!');
    } catch {
      showSnack('Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      return () => {};
    }, [qc])
  );

  if (isLoading && !data)
    return <Text style={{ padding: 16 }}>Loading tenants…</Text>;
  if (error) {
    const msg = (error as any)?.message ?? 'Unknown error';
    return (
      <Text style={{ padding: 16 }}>
        Failed to load tenants: {msg}. Pull to retry.
      </Text>
    );
  }

  return (
    <>
      <FlatList
        data={data ?? []}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <View
            style={{ padding: 12, borderBottomWidth: 1, borderColor: '#eee' }}
          >
            <Text style={{ fontWeight: '600' }}>{item.name}</Text>
            <Text style={{ color: '#666' }}>{item.slug}</Text>
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || isFetching}
            onRefresh={onRefresh}
          />
        }
        contentContainerStyle={{ flexGrow: 1 }}
        ListEmptyComponent={
          <Text style={{ padding: 16 }}>No tenants yet.</Text>
        }
      />

      <Snackbar
        visible={snackbar.visible}
        onDismiss={() => setSnackbar({ visible: false, msg: '' })}
        duration={1500}
      >
        {snackbar.msg}
      </Snackbar>
    </>
  );
}
