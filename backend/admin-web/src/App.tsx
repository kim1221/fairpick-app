import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminLayout from './layouts/AdminLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EventsPage from './pages/EventsPage';
import CreateEventPage from './pages/CreateEventPage';
import HotSuggestionsPage from './pages/HotSuggestionsPage';
import CurationThemesPage from './pages/CurationThemesPage';
import OpsPage from './pages/OpsPage';
import PersonalizationPage from './pages/PersonalizationPage';
import RecommendationDebugPage from './pages/RecommendationDebugPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const adminKey = localStorage.getItem('adminKey');
  
  if (!adminKey) {
    return <Navigate to="/login" replace />;
  }

  return <AdminLayout>{children}</AdminLayout>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          
          {/* /admin 경로 추가 */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <EventsPage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/events"
            element={
              <ProtectedRoute>
                <EventsPage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/events/create"
            element={
              <ProtectedRoute>
                <CreateEventPage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/hot-suggestions"
            element={
              <ProtectedRoute>
                <HotSuggestionsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/curation-themes"
            element={
              <ProtectedRoute>
                <CurationThemesPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/ops"
            element={
              <ProtectedRoute>
                <OpsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/personalization"
            element={
              <ProtectedRoute>
                <PersonalizationPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/debug/recommendation"
            element={
              <ProtectedRoute>
                <RecommendationDebugPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
