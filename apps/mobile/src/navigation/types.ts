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
  PartyList: { role?: string; q?: string; viewId?: string } | undefined;
  PartyDetail: { id?: string; mode?: "new" } | undefined;

  // Inventory
  InventoryList: { viewId?: string } | undefined;
  InventoryDetail: DetailParams;

  // Resources
  ResourcesList: undefined;
  ResourceDetail: DetailParams;

  // Purchasing
  PurchaseOrdersList: { viewId?: string } | undefined;
  PurchaseOrderDetail: DetailParams;
  EditPurchaseOrder: { id?: string; purchaseOrderId?: string; poId?: string };

  // Sales
  SalesOrdersList: { viewId?: string } | undefined;
  SalesOrderDetail: DetailParams;
  EditSalesOrder: { soId: string };

  // Backorders
  BackordersList: { soId?: string; itemId?: string; status?: "open" | "ignored" | "converted"; preferredVendorId?: string } | undefined;
  BackorderDetail: { id: string };

  // Routing and Delivery
  RoutePlanList: undefined;
  RoutePlanDetail: DetailParams;

  // Workspaces (Sprint III)
  WorkspaceHub: undefined;
  ViewsManage: { initialEntityType?: string } | undefined;
  WorkspacesManage: { initialEntityType?: string } | undefined;
  WorkspaceDetail: { workspaceId: string };
  
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
  
  // Products (Sprint XIV)
  ProductsList: { viewId?: string } | undefined;
  ProductDetail: DetailParams;
  CreateProduct: undefined;
  EditProduct: { id: string };
  
};
