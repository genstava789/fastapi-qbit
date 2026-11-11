import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { MobileBottomNav, MobileDrawer } from "./MobileNav";
import { useAppStore } from "@/stores/appStore";
import { AddTorrentModal, DeleteConfirmDialog } from "@/components/torrents";
import { cn } from "@/lib/utils";

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
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
      <AddTorrentModal />
      <DeleteConfirmDialog />
    </div>
  );
}
