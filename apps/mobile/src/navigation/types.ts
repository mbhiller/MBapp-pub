import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type ObjectRef = { id: string; type: string };

export type ScanIntent =
  | "attach-epc"
  | "lookup"
  | "create"
  | "assign-badge"
  | "none";

export type RootStackParamList = {
  Hub: undefined;
  Objects: { type?: string } | undefined;
  ObjectDetail:
    | ObjectRef
    | { obj: ObjectRef }
    | { item: ObjectRef };
  Products: undefined;
  ProductDetail: { id?: string; sku?: string; mode?: "new" | "edit" } | undefined;
  Tenants: undefined;
  Scan: { attachTo?: ObjectRef; intent?: ScanIntent } | undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
