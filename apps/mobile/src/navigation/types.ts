import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Hub: undefined;
  ProductsList: undefined;
  ProductDetail: { id?: string; mode?: "new" };
  ObjectsList: { type?: string } | undefined;
  ObjectDetail: { type: string; id: string };
  Tenants: undefined;
  // Add optional 'intent' so ScanScreen can read route.params.intent safely
  Scan: {
    attachTo?: { type: string; id: string };
    intent?: "navigate" | "attach" | string;
  } | undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
