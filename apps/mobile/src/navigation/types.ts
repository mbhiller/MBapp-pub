// Central route & screen prop types shared across the mobile app.

import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type ScanIntent =
  | "navigate"
  | "attach-epc"
  | "link"
  | "add-to-order"
  | "receive-po"
  | "inventory-move"
  | "ticket-validate"
  | "badge-clock"
  | "add-to-service";

// A lightweight "reference" to an object in MBapp
export type ObjectRef = { id: string; type: string };

export type RootStackParamList = {
  Hub: undefined;
  ProductsList: undefined;
  ProductDetail:
    | { id?: string; mode?: "new" | "edit" | "view" }
    | undefined;
  ObjectsList: undefined;
  ObjectDetail: ObjectRef;
  Tenants: undefined;
  Scan:
    | {
        intent?: ScanIntent;
        attachTo?: ObjectRef;
        poId?: string;
      }
    | undefined;
};

// Convenience alias used across screens (this is what your files expected)
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
