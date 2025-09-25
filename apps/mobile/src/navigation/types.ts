// apps/mobile/src/navigation/types.ts

export type RootStackParamList = {
  // Hub / global
  Hub: undefined;
  Tenants: undefined;
  Scan: { intent?: "navigate" | "attach-epc" } | undefined;

  DevEventsTools: undefined;
  // Products
  ProductsList: undefined;
  ProductDetail: { id?: string; mode?: "new" | "edit" };

  // Objects (generic manager for /objects/{type})
  ObjectsList: undefined;
  ObjectDetail: { type: string; id?: string };

  // Clients
  ClientsList: undefined;
  ClientDetail: { id?: string; mode?: "new" | "edit" };

  // Accounts
  AccountsList: undefined;
  AccountDetail: { id?: string; mode?: "new" | "edit" };

  // Inventory
  InventoryList: undefined;
  InventoryDetail: { id?: string; mode?: "new" | "edit" };

  // Events (+ deep link to registrations)
  EventsList: undefined;
  EventDetail: { id?: string; mode?: "new" | "edit"; event?: any };

  // Registrations (supports event-scoped filter)
  RegistrationsList: { eventId?: string } | undefined;
  RegistrationDetail: { id?: string; mode?: "new" | "edit" };

  // Reservations
  ReservationsList: undefined;
  ReservationDetail: { id?: string; mode?: "new" | "edit" };

  // Vendors & Employees
  VendorsList: undefined;
  VendorDetail: { id?: string; mode?: "new" | "edit" };
  
  EmployeesList: undefined;
  EmployeeDetail: { id?: string; mode?: "new" | "edit" };

  // Resources
  ResourcesList: undefined;
  ResourceDetail: { id?: string; mode?: "new" | "edit" };

  PurchaseOrdersList: undefined;
  PurchaseOrderDetail: { id?: string; mode?: "new"|"edit" };

  SalesOrdersList: undefined;
  SalesOrderDetail: { id?: string; mode?: "new"|"edit" };

  IntegrationsList: undefined;
  IntegrationDetail: { id?: string; mode?: "new"|"edit" };
  // Optional:
  IntegrationRunsList: { integrationId: string } | undefined;

};
