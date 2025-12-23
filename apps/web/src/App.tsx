import { Link, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import CreatePartyPage from "./pages/CreatePartyPage";
import EditPartyPage from "./pages/EditPartyPage";
import PartiesListPage from "./pages/PartiesListPage";
import PartyDetailPage from "./pages/PartyDetailPage";

function HomePage() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h1>Welcome to MBapp Web</h1>
      <p>This is the AWS-first web client foundation.</p>
      <p>
        <Link to="/parties">Go to Parties</Link>
      </p>
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
        </Routes>
      </Layout>
    </ErrorBoundary>
  );
}
