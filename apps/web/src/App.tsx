import { Link, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PERM_VIEW_WRITE } from "./generated/permissions";
import CreatePartyPage from "./pages/CreatePartyPage";
import EditPartyPage from "./pages/EditPartyPage";
import PartiesListPage from "./pages/PartiesListPage";
import PartyDetailPage from "./pages/PartyDetailPage";
import CreateProductPage from "./pages/CreateProductPage";
import EditProductPage from "./pages/EditProductPage";
import ProductsListPage from "./pages/ProductsListPage";
import ProductDetailPage from "./pages/ProductDetailPage";
import SalesOrderDetailPage from "./pages/SalesOrderDetailPage";
import SalesOrdersListPage from "./pages/SalesOrdersListPage";
import CreateSalesOrderPage from "./pages/CreateSalesOrderPage";
import EditSalesOrderPage from "./pages/EditSalesOrderPage";
import InventoryListPage from "./pages/InventoryListPage";
import InventoryDetailPage from "./pages/InventoryDetailPage";
import ViewsListPage from "./pages/ViewsListPage";
import CreateViewPage from "./pages/CreateViewPage";
import ViewDetailPage from "./pages/ViewDetailPage";
import EditViewPage from "./pages/EditViewPage";
import WorkspacesListPage from "./pages/WorkspacesListPage";
import WorkspaceDetailPage from "./pages/WorkspaceDetailPage";
import BackordersListPage from "./pages/BackordersListPage";
import BackorderDetailPage from "./pages/BackorderDetailPage";
import SuggestPurchaseOrdersPage from "./pages/SuggestPurchaseOrdersPage";
import PurchaseOrdersListPage from "./pages/PurchaseOrdersListPage";
import PurchaseOrderDetailPage from "./pages/PurchaseOrderDetailPage";
import CreatePurchaseOrderPage from "./pages/CreatePurchaseOrderPage";
import EditPurchaseOrderPage from "./pages/EditPurchaseOrderPage";
import LocationsListPage from "./pages/LocationsListPage";
import LocationDetailPage from "./pages/LocationDetailPage";
import InventoryMovementsPage from "./pages/InventoryMovementsPage";
import DocsPage from "./pages/DocsPage";
import NotAuthorizedPage from "./pages/NotAuthorizedPage";

const PublicBookingPage = lazy(() => import("./pages/PublicBookingPage"));

function HomePage() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h1>Welcome to MBapp Web</h1>
      <p>This is the AWS-first web client foundation.</p>
      <div style={{ display: "flex", gap: 12 }}>
        <Link to="/parties">Parties</Link>
        <Link to="/products">Products</Link>
        <Link to="/sales-orders">Sales Orders</Link>
        <Link to="/backorders">Backorders</Link>
        <Link to="/purchase-orders">Purchase Orders</Link>
        <Link to="/inventory">Inventory</Link>
        <Link to="/locations">Locations</Link>
        <Link to="/views">Views</Link>
        <Link to="/workspaces">Workspaces</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/not-authorized" element={<NotAuthorizedPage />} />
          <Route path="/parties" element={<PartiesListPage />} />
          <Route path="/parties/new" element={<ProtectedRoute requiredPerm="party:write"><CreatePartyPage /></ProtectedRoute>} />
          <Route path="/parties/:id" element={<PartyDetailPage />} />
          <Route path="/parties/:id/edit" element={<ProtectedRoute requiredPerm="party:write"><EditPartyPage /></ProtectedRoute>} />
          <Route path="/products" element={<ProductsListPage />} />
          <Route path="/products/new" element={<ProtectedRoute requiredPerm="product:write"><CreateProductPage /></ProtectedRoute>} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/products/:id/edit" element={<ProtectedRoute requiredPerm="product:write"><EditProductPage /></ProtectedRoute>} />
          <Route path="/sales-orders" element={<SalesOrdersListPage />} />
          <Route path="/sales-orders/new" element={<ProtectedRoute requiredPerm="sales:write"><CreateSalesOrderPage /></ProtectedRoute>} />
          <Route path="/sales-orders/:id" element={<SalesOrderDetailPage />} />
          <Route path="/sales-orders/:id/edit" element={<ProtectedRoute requiredPerm="sales:write"><EditSalesOrderPage /></ProtectedRoute>} />
          <Route path="/inventory" element={<InventoryListPage />} />
          <Route path="/inventory/:id" element={<InventoryDetailPage />} />
          <Route path="/inventory-movements" element={<InventoryMovementsPage />} />
          <Route path="/views" element={<ViewsListPage />} />
          <Route path="/views/new" element={<ProtectedRoute requiredPerm={PERM_VIEW_WRITE}><CreateViewPage /></ProtectedRoute>} />
          <Route path="/views/:id" element={<ViewDetailPage />} />
          <Route path="/views/:id/edit" element={<ProtectedRoute requiredPerm={PERM_VIEW_WRITE}><EditViewPage /></ProtectedRoute>} />
          <Route path="/workspaces" element={<WorkspacesListPage />} />
          <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
          <Route path="/backorders" element={<BackordersListPage />} />
          <Route path="/backorders/:id" element={<BackorderDetailPage />} />
          <Route path="/backorders/:id/suggest-po" element={<SuggestPurchaseOrdersPage />} />
          <Route path="/purchase-orders" element={<PurchaseOrdersListPage />} />
          <Route path="/purchase-orders/new" element={<ProtectedRoute requiredPerm="purchase:write"><CreatePurchaseOrderPage /></ProtectedRoute>} />
          <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
          <Route path="/purchase-orders/:id/edit" element={<ProtectedRoute requiredPerm="purchase:write"><EditPurchaseOrderPage /></ProtectedRoute>} />
          <Route path="/locations" element={<LocationsListPage />} />
          <Route path="/locations/:id" element={<LocationDetailPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/public/book" element={<Suspense fallback={<div>Loading public booking...</div>}><PublicBookingPage /></Suspense>} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}
