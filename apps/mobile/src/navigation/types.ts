// apps/mobile/src/navigation/types.ts

export type ObjectRef =
  | { id: string; type: string }
  | { obj: { id: string; type: string; [k: string]: any } }
  | { item: { id: string; type: string; [k: string]: any } };

export type RootStackParamList = {
  Objects:
    | { type?: string } // default "horse"
    | undefined;
  ObjectDetail: ObjectRef | undefined;
  Scan:
    | undefined
    | { attachTo: { id: string; type: string } };
  Tenants: undefined;
};
