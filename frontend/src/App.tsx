import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { AppLayout } from "@/components/layout";

const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage }))
);
const TorrentsPage = lazy(() =>
  import("@/pages/TorrentsPage").then((m) => ({ default: m.TorrentsPage }))
);
const ProwlarrPage = lazy(() =>
  import("@/pages/ProwlarrPage").then((m) => ({ default: m.ProwlarrPage }))
);
const CrossSeedPage = lazy(() =>
  import("@/pages/CrossSeedPage").then((m) => ({ default: m.CrossSeedPage }))
);
const NetworkPage = lazy(() =>
  import("@/pages/NetworkPage").then((m) => ({ default: m.NetworkPage }))
);
const FileBrowserPage = lazy(() =>
  import("@/pages/FileBrowserPage").then((m) => ({ default: m.FileBrowserPage }))
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/torrents" element={<TorrentsPage />} />
            <Route path="/prowlarr" element={<ProwlarrPage />} />
            <Route path="/crossseed" element={<CrossSeedPage />} />
            <Route path="/network" element={<NetworkPage />} />
            <Route path="/files" element={<FileBrowserPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "rgba(12, 12, 15, 0.96)",
            color: "#fafafa",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            backdropFilter: "blur(16px)",
            borderRadius: "12px",
            fontSize: "13px",
          },
        }}
      />
    </QueryClientProvider>
  );
}
