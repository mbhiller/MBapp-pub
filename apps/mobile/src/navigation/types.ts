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
  Tenants: undefined;
  DevDiagnostics: undefined;

  // Objects (generic)
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

  // Registrations list can be filtered by a specific event
  RegistrationsList: { eventId?: string } | undefined;
  RegistrationDetail: DetailParams;

  // Reservations (optionally filtered by resource)
  ReservationsList: undefined;
  ReservationDetail: DetailParams;

  // Vendors
  VendorsList: undefined;
  VendorDetail: DetailParams;

  // Employees
  EmployeesList: undefined;
  EmployeeDetail: DetailParams;
  //
  OrganizationsList: undefined;
  OrganizationDetail: DetailParams;
  // Resources
  ResourcesList: undefined;
  ResourceDetail: DetailParams;

  // Purchasing
  PurchaseOrdersList: undefined;
  PurchaseOrderDetail: DetailParams;

  // Sales
  SalesOrdersList: undefined;
  SalesOrderDetail: DetailParams;

  // Integrations
  IntegrationsList: undefined;
  IntegrationDetail: DetailParams;
  // IntegrationRunsList?: undefined; // if/when you enable it

  // ✅ Goods Receipts (added)
  GoodsReceiptsList: undefined;
  GoodsReceiptDetail: DetailParams;

  // ✅ Sales Fulfillments (added)
  SalesFulfillmentsList: undefined;
  SalesFulfillmentDetail: DetailParams;
  
};
