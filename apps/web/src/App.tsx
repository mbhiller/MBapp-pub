import { Link, Route, Routes, useNavigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PERM_VIEW_WRITE } from "./generated/permissions";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
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
import MessagesListPage from "./pages/MessagesListPage";
import MessageDetailPage from "./pages/MessageDetailPage";
import InventoryMovementsPage from "./pages/InventoryMovementsPage";
import DocsPage from "./pages/DocsPage";
import NotAuthorizedPage from "./pages/NotAuthorizedPage";
import CheckInConsolePage from "./pages/CheckInConsolePage";
import EventsListPage from "./pages/EventsListPage";
import EventDetailPage from "./pages/EventDetailPage";
import PublicCheckInPage from "./pages/PublicCheckInPage";

const PublicBookingPage = lazy(() => import("./pages/PublicBookingPage"));

function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Welcome to MBapp</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Discover events and check in with ease.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => navigate("/events")} className="w-full sm:w-auto">
              Browse Events
            </Button>
            <Button onClick={() => navigate("/events")} variant="outline" className="w-full sm:w-auto">
              Find My Check-In
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Pick your event first. On the event page, select ‘My Check-In’.
          </p>
        </CardContent>
      </Card>
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
          <Route path="/messages" element={<ProtectedRoute requiredPerm="message:read"><MessagesListPage /></ProtectedRoute>} />
          <Route path="/messages/:id" element={<ProtectedRoute requiredPerm="message:read"><MessageDetailPage /></ProtectedRoute>} />
          <Route path="/locations" element={<LocationsListPage />} />
          <Route path="/locations/:id" element={<LocationDetailPage />} />
          <Route path="/events" element={<EventsListPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/events/:eventId/my-checkin" element={<PublicCheckInPage />} />
          <Route path="/events/:eventId/checkin" element={<ProtectedRoute requiredPerm="event:read registration:read"><CheckInConsolePage /></ProtectedRoute>} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/public/book" element={<Suspense fallback={<div>Loading public booking...</div>}><PublicBookingPage /></Suspense>} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}
