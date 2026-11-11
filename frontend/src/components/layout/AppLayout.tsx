import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileBottomNav, MobileDrawer } from "./MobileNav";
import { useAppStore } from "@/stores/appStore";
import { AddTorrentModal, DeleteConfirmDialog } from "@/components/torrents";
import {
  DashboardSkeleton,
  ListSkeleton,
  TorrentsSkeleton,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/utils";

function RouteSkeletonFallback() {
  const { pathname } = useLocation();

  if (pathname === "/torrents") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-36" />
        </div>
        <Skeleton className="h-11 w-full rounded-xl" />
        <TorrentsSkeleton count={4} />
      </div>
    );
  }

  if (pathname === "/") {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <ListSkeleton rows={5} />
    </div>
  );
}

export function AppLayout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar />
      <MobileDrawer />
      <div
        className={cn(
          "flex flex-col min-h-screen transition-[margin] duration-200 ease-in-out ml-0",
          sidebarOpen ? "md:ml-64" : "md:ml-[72px]"
        )}
      >
        <Header />
        <main className="flex-1 p-4 sm:p-6 pb-28 md:pb-8">
          <Suspense fallback={<RouteSkeletonFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <MobileBottomNav />
      <AddTorrentModal />
      <DeleteConfirmDialog />
    </div>
  );
}
