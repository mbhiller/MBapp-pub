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

export type RootStackParamList = {
  // Hub / Global
  Hub: undefined;
  Scan: ScanParams | undefined;          // <-- allow params (fixes route.params?.intent)
  DevDiagnostics: undefined;
  // Tenants
  Tenants: undefined;

  // Objects (generic manager)
  ObjectsList: undefined;
  ObjectDetail: DetailParams;

  // Products
  ProductsList: undefined;
  ProductDetail: DetailParams;

  // Clients
  ClientsList: undefined;
  ClientDetail: DetailParams;

  // Accounts
  AccountsList: undefined;
  AccountDetail: DetailParams;

  // Inventory
  InventoryList: undefined;
  InventoryDetail: DetailParams;

  // Events & Registrations
  EventsList: undefined;
  EventDetail: DetailParams;
  RegistrationsList: { eventId?: string } | undefined;
  RegistrationDetail: DetailParams;

  // Reservations
  ReservationsList: undefined;
  ReservationDetail: DetailParams;

  // Resources
  ResourcesList: undefined;
  ResourceDetail: DetailParams;

  // Vendors / Employees
  VendorsList: undefined;
  VendorDetail: DetailParams;
  EmployeesList: undefined;
  EmployeeDetail: DetailParams;

  // Purchasing
  PurchaseOrdersList: undefined;
  PurchaseOrderDetail: DetailParams;

  // Sales
  SalesOrdersList: undefined;
  SalesOrderDetail: DetailParams;

  // Integrations
  IntegrationsList: undefined;
  IntegrationDetail: DetailParams;
};
