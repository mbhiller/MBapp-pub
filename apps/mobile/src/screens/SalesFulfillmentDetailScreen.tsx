import * as React from "react";
import { View, Text, ActivityIndicator, Pressable, ScrollView } from "react-native";
import { useColors } from "../features/_shared/useColors";
import { useObject, useUpsertObject } from "../features/_shared/useObject";
import type { components } from "../api/generated-types";
type SalesFulfillment = components["schemas"]["SalesFulfillment"];

export default function SalesFulfillmentDetailScreen({ route, navigation }: any) {
  const t = useColors();
  const id: string | undefined = route?.params?.id;
  const { data, isLoading, isError, error } = useObject<SalesFulfillment>("salesFulfillment", id);
  const save = useUpsertObject<SalesFulfillment>("salesFulfillment");

  if (isLoading) return <View style={{ flex:1, justifyContent:"center", alignItems:"center" }}><ActivityIndicator/></View>;
  if (isError) return <View style={{ padding:16 }}><Text style={{ color: t.colors.danger }}>Error: {String(error?.message)}</Text></View>;

  const sf = data;
  return (
    <ScrollView style={{ flex:1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: t.colors.text, fontWeight: "700", fontSize: 18 }}>
        {sf?.id ? `Sales Fulfillment ${sf.id.slice(0,8)}` : "New Sales Fulfillment"}
      </Text>
      {sf?.ts ? <Text style={{ color: t.colors.muted, marginTop: 6 }}>{new Date(sf.ts).toLocaleString()}</Text> : null}
      <Text style={{ color: t.colors.muted, marginTop: 6 }}>SO: {sf?.soId ?? "—"}</Text>
      <Text style={{ color: t.colors.muted, marginTop: 6 }}>Lines: {sf?.lines?.length ?? 0}</Text>
      {sf?.carrier ? <Text style={{ color: t.colors.muted, marginTop: 6 }}>Carrier: {sf.carrier}</Text> : null}
      {sf?.tracking ? <Text style={{ color: t.colors.muted, marginTop: 6 }}>Tracking: {sf.tracking}</Text> : null}

      <Pressable
        onPress={() => { if (!sf) return; save.mutate({ id: sf.id! }); }}
        style={{ marginTop: 20, backgroundColor: t.colors.primary, padding: 12, borderRadius: 10, alignItems: "center" }}
      >
        <Text style={{ color: t.colors.buttonText, fontWeight: "700" }}>{save.isPending ? "Saving…" : "Save"}</Text>
      </Pressable>
    </ScrollView>
  );
}
