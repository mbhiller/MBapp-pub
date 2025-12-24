import { Link, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import CreatePartyPage from "./pages/CreatePartyPage";
import EditPartyPage from "./pages/EditPartyPage";
import PartiesListPage from "./pages/PartiesListPage";
import PartyDetailPage from "./pages/PartyDetailPage";
import CreateProductPage from "./pages/CreateProductPage";
import EditProductPage from "./pages/EditProductPage";
import ProductsListPage from "./pages/ProductsListPage";
import ProductDetailPage from "./pages/ProductDetailPage";
import InventoryListPage from "./pages/InventoryListPage";
import InventoryDetailPage from "./pages/InventoryDetailPage";
import ViewsListPage from "./pages/ViewsListPage";
import CreateViewPage from "./pages/CreateViewPage";
import ViewDetailPage from "./pages/ViewDetailPage";
import EditViewPage from "./pages/EditViewPage";
import WorkspacesListPage from "./pages/WorkspacesListPage";
import WorkspaceDetailPage from "./pages/WorkspaceDetailPage";

function HomePage() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h1>Welcome to MBapp Web</h1>
      <p>This is the AWS-first web client foundation.</p>
      <div style={{ display: "flex", gap: 12 }}>
        <Link to="/parties">Parties</Link>
        <Link to="/products">Products</Link>
        <Link to="/inventory">Inventory</Link>
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
          <Route path="/parties" element={<PartiesListPage />} />
          <Route path="/parties/new" element={<CreatePartyPage />} />
          <Route path="/parties/:id" element={<PartyDetailPage />} />
          <Route path="/parties/:id/edit" element={<EditPartyPage />} />
          <Route path="/products" element={<ProductsListPage />} />
          <Route path="/products/new" element={<CreateProductPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/products/:id/edit" element={<EditProductPage />} />
          <Route path="/inventory" element={<InventoryListPage />} />
          <Route path="/inventory/:id" element={<InventoryDetailPage />} />
          <Route path="/views" element={<ViewsListPage />} />
          <Route path="/views/new" element={<CreateViewPage />} />
          <Route path="/views/:id" element={<ViewDetailPage />} />
          <Route path="/views/:id/edit" element={<EditViewPage />} />
          <Route path="/workspaces" element={<WorkspacesListPage />} />
          <Route path="/workspaces/:id" element={<WorkspaceDetailPage />} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}
