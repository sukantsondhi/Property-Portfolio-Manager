import { LoaderCircle } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./context/AuthContext";
import { PortfolioProvider } from "./context/PortfolioContext";
import { AccessDeniedPage } from "./pages/AccessDeniedPage";
import { AdminPage } from "./pages/AdminPage";
import { ArchivePage } from "./pages/ArchivePage";
import { DashboardPage } from "./pages/DashboardPage";
import { FinancePage } from "./pages/FinancePage";
import { HistoryPage } from "./pages/HistoryPage";
import { HistoryDetailPage } from "./pages/HistoryDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { OrganizationSelectPage } from "./pages/OrganizationSelectPage";
import { PropertiesPage } from "./pages/PropertiesPage";
import { PropertyDetailPage } from "./pages/PropertyDetailPage";

function SessionBoundary({ children }: { children: React.ReactNode }) {
  const { user, loading, denied } = useAuth();
  if (loading) return <div className="loading"><LoaderCircle /><span>Opening Property Portfolio Manager…</span></div>;
  if (denied) return <AccessDeniedPage />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PortfolioApp() {
  const { organization } = useAuth();
  if (!organization) return <Navigate to="/select-organization" replace />;
  return <PortfolioProvider><AppShell><Routes>
    <Route index element={<DashboardPage />} />
    <Route path="properties" element={<PropertiesPage />} />
    <Route path="properties/:id" element={<PropertyDetailPage />} />
    <Route path="history" element={<HistoryPage />} />
    <Route path="history/:propertyId/:yearId" element={<HistoryDetailPage />} />
    <Route path="finance" element={<FinancePage />} />
    <Route path="archive" element={<ArchivePage />} />
    <Route path="organization" element={<OrganizationPage />} />
    <Route path="admin" element={<AdminPage />} />
    <Route path="*" element={<Navigate to="/app/properties" replace />} />
  </Routes></AppShell></PortfolioProvider>;
}

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/access-denied" element={<AccessDeniedPage />} />
    <Route path="/select-organization" element={<SessionBoundary><OrganizationSelectPage /></SessionBoundary>} />
    <Route path="/app/*" element={<SessionBoundary><PortfolioApp /></SessionBoundary>} />
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes>;
}
