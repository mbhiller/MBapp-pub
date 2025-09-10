import React, { useCallback, useState } from "react";
import { View, Text, FlatList, RefreshControl } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "@react-navigation/native";
import { Snackbar } from "react-native-paper";

import { useTenants } from "./useTenants";
import { Screen } from "../../ui/Screen";
import { Section } from "../../ui/Section";
import { NonProdBadge } from "../../ui/NonProdBadge";
import { useTheme } from "../../ui/ThemeProvider";

type Tenant = { id: string; name: string; slug?: string };

export default function TenantsScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch, error } = useTenants();
  const [refreshing, setRefreshing] = useState(false);
  const [snackbar, setSnackbar] = useState<{ visible: boolean; msg: string }>({ visible: false, msg: "" });

  const showSnack = (msg: string) => setSnackbar({ visible: true, msg });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    showSnack("Refreshing…");
    try {
      await refetch({ throwOnError: false });
      showSnack("Updated!");
    } catch {
      showSnack("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ["tenants"] });
      return () => {};
    }, [qc])
  );

  const renderItem = ({ item }: { item: Tenant }) => (
    <View
      style={{
        padding: 14,
        backgroundColor: t.card,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
      }}
    >
      <Text style={{ fontWeight: "800", color: t.text }}>{item.name}</Text>
      <Text style={{ color: t.textMuted, marginTop: 2 }}>{item.slug || "—"}</Text>
      <Text selectable numberOfLines={1} style={{ color: t.textMuted, marginTop: 4 }}>
        ID: <Text style={{ color: t.text }}>{item.id}</Text>
      </Text>
    </View>
  );

  return (
    <Screen title="Tenants" scroll={false}>
      {/* Non-prod badge */}
      <View style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}>
        <NonProdBadge />
      </View>

      <Section label="Directory" style={{ marginTop: 8, padding: 0, overflow: "hidden" }}>
        {isLoading && !data ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: t.textMuted }}>Loading tenants…</Text>
          </View>
        ) : error ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: t.danger }}>
              Failed to load tenants. Pull to retry.
            </Text>
          </View>
        ) : (
          <FlatList
            data={(data ?? []) as Tenant[]}
            keyExtractor={(x) => x.id}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl refreshing={refreshing || isFetching} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <View style={{ padding: 16 }}>
                <Text style={{ color: t.textMuted }}>No tenants yet.</Text>
              </View>
            }
            contentContainerStyle={{ flexGrow: 1 }}
          />
        )}
      </Section>

      <Snackbar
        visible={snackbar.visible}
        onDismiss={() => setSnackbar({ visible: false, msg: "" })}
        duration={1500}
      >
        {snackbar.msg}
      </Snackbar>
    </Screen>
  );
}
