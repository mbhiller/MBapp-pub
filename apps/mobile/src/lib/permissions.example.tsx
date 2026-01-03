// Example: How to use hasPerm + usePolicy in mobile screens
//
// This demonstrates the mobile RBAC pattern established in Sprint AA E1.

import * as React from "react";
import { View, Pressable, Text } from "react-native";
import { usePolicy } from "../providers/PolicyProvider";
import { hasPerm } from "../lib/permissions";
import { PERM_OBJECTS_WRITE, PERM_PURCHASE_WRITE } from "../generated/permissions";
import { useToast } from "../features/_shared/Toast";

export default function ExampleScreen() {
  // 1. Get policy from centralized provider
  const { policy, policyLoading, policyError } = usePolicy();
  const toast = useToast();

  // 2. Check permissions using hasPerm helper
  const canWriteBackorders = hasPerm(policy, PERM_OBJECTS_WRITE);
  const canSuggestPO = hasPerm(policy, PERM_PURCHASE_WRITE);

  // 3. Use permission checks to gate actions
  const handleIgnore = async () => {
    if (!canWriteBackorders) {
      toast("You lack permission to ignore backorders", "error");
      return;
    }
    // ... perform action
  };

  return (
    <View>
      {/* 4. Disable button if user lacks permission */}
      <Pressable
        disabled={!canWriteBackorders || policyLoading}
        onPress={handleIgnore}
      >
        <Text>Ignore Backorder</Text>
      </Pressable>
    </View>
  );
}
