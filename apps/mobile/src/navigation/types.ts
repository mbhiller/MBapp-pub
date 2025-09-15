import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Hub: undefined;
  ProductsList: undefined;
  ProductDetail: { id?: string; mode?: "new" };
  ObjectsList: { type?: string } | undefined;
  ObjectDetail: { type: string; id: string };
  Tenants: undefined;
  Scan: { attachTo?: { type: string; id: string }; intent?: "navigate" | "attach" | string } | undefined;

  // New
  EventsList: undefined;
  EventDetail: { id?: string; mode?: "new" };
  RegistrationsList: { eventId: string; eventName?: string };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
