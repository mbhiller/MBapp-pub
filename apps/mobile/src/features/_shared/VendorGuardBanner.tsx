import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { useColors } from "./useColors";
import { useNavigation } from "@react-navigation/native";

export function VendorGuardBanner({
  vendorId, vendorHasRole, onChangeVendor
}: { vendorId?: string | null; vendorHasRole: boolean; onChangeVendor: () => void; }) {
  const t = useColors();
  const nav = useNavigation<any>();
  const show = !vendorId || !vendorHasRole;
  if (!show) return null;

  return (
    <View style={{ borderWidth: 1, padding: 10, borderRadius: 8, marginBottom: 10 }}>
      <Text style={{ marginBottom: 6 }}>
        { !vendorId ? "Vendor required" : "Selected party is not a Vendor" }
      </Text>
      <View style={{ flexDirection: "row", columnGap: 16 }}>
        <Pressable onPress={onChangeVendor}><Text>Change vendor</Text></Pressable>
        {!!vendorId && !vendorHasRole && (
          <Pressable onPress={() => nav.navigate("PartyDetail", { id: vendorId, mode: "edit", autoAddRole: "vendor" })}>
            <Text>Open Vendor</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
