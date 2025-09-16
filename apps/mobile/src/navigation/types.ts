import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  // Hub & utilities
  Hub: undefined;

  // Scan supports optional intents (used in ScanScreen)
  Scan:
    | {
        intent?: "navigate" | "attach-epc";
        attachTo?: { type: string; id: string };
      }
    | undefined;

  // Tenants
  Tenants: undefined;

  // Objects (generic)
  // allow optional "type" to satisfy callers that pass it
  ObjectsList: { type?: string } | undefined;
  ObjectDetail:
    | { id?: string; mode?: "new" | "edit"; type?: string }
    | undefined;

  // Products
  ProductsList: undefined;
  ProductDetail: { id?: string; mode?: "new" | "edit" } | undefined;

  // Events
  EventsList: undefined;
  EventDetail: { id?: string; mode?: "new" | "edit" } | undefined;

  // Registrations (✅ align with your list screen usage)
  RegistrationsList: { eventId?: string; eventName?: string } | undefined;
  RegistrationDetail: { id: string } | undefined;

  // Inventory
  InventoryList: undefined;
  InventoryDetail: { id?: string; mode?: "new" | "edit" } | undefined;
};

// Convenience prop helper used by many screens
export type RootStackScreenProps<RouteName extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, RouteName>;
