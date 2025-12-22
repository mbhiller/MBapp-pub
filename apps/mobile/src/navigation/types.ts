// apps/mobile/src/navigation/types.ts

// Generic shape for detail screens: open by id or start with initial payload.
// We also support a small "mode" hint for your Scan/List screens ("new" | "edit").
export type DetailParams<T = any> = {
  id?: string;
  initial?: Partial<T>;
  mode?: "new" | "edit";
};

// Optional params used by Scan to decide what to do after a scan.
export type ScanParams = {
  intent?: "navigate" | "attach_epc" | string;
};

// export type ListFilterParams = Record<string, any>;
export type RootStackParamList = {
  // Hub / global
  Hub: undefined;
  
  // Dev Tools
  DevTools: undefined;

  // Parties
  PartyList: { role?: string; q?: string } | undefined;
  PartyDetail: { id?: string; mode?: "new" } | undefined;

  // Inventory
  InventoryList: undefined;
  InventoryDetail: DetailParams;

  // Resources
  ResourcesList: undefined;
  ResourceDetail: DetailParams;

  // Purchasing
  PurchaseOrdersList: undefined;
  PurchaseOrderDetail: DetailParams;

  // Sales
  SalesOrdersList: undefined;
  SalesOrderDetail: DetailParams;

  // Routing and Delivery
  RoutePlanList: undefined;
  RoutePlanDetail: DetailParams;

  // Workspaces (Sprint III)
  WorkspaceHub: undefined;
  
  // Registrations (Sprint IV)
  RegistrationsList: undefined;
  RegistrationDetail: DetailParams;

  // Reservations (Sprint V)
  ReservationsList: undefined;
  ReservationDetail: DetailParams;
  
  CreateReservation: undefined;
  EditReservation: { id: string };
  
  // Events (Sprint IX)
  EventsList: undefined;
  EventDetail: DetailParams;
  
};
