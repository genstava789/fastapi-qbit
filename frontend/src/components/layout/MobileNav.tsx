import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { useHealth } from "@/hooks/useTorrents";
import {
  LayoutDashboard,
  Download,
  Search,
  FolderOpen,
  Cloud,
  GitFork,
  Wifi,
  Settings,
  X,
  Server,
  Circle,
  Plus,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const bottomNavItems = [
  { path: "/", icon: LayoutDashboard, label: "Home" },
  { path: "/torrents", icon: Download, label: "Torrents" },
  { path: "/prowlarr", icon: Search, label: "Search" },
  { path: "/files", icon: FolderOpen, label: "Files" },
  { path: "/drive", icon: Cloud, label: "Drive" },
];

const drawerNavItems = [
  { path: "/", icon: LayoutDashboard, label: "Dashboard" },
  { path: "/torrents", icon: Download, label: "Torrents" },
  { path: "/prowlarr", icon: Search, label: "Prowlarr Search" },
  { path: "/crossseed", icon: GitFork, label: "Cross-Seed" },
  { path: "/network", icon: Wifi, label: "Network Agent" },
  { path: "/files", icon: FolderOpen, label: "File Browser" },
  { path: "/drive", icon: Cloud, label: "Google Drive" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

export function MobileBottomNav() {
  const setMobileMenuOpen = useAppStore((s) => s.setMobileMenuOpen);

  return (
    <nav
      aria-label="Mobile Navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-glass-border bg-surface/98 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="grid grid-cols-5 h-16">
        {bottomNavItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            onClick={() => setMobileMenuOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-1 min-h-[44px] text-[11px] font-medium transition-colors",
                isActive
                  ? "text-accent"
                  : "text-text-secondary hover:text-text-primary"
              )
            }
          >
            {({ isActive }) => (
              <>
                <div
                  className={cn(
                    "px-3 py-1 rounded-full transition-colors",
                    isActive ? "bg-accent/15" : "bg-transparent"
                  )}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function MobileDrawer() {
  const mobileMenuOpen = useAppStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useAppStore((s) => s.setMobileMenuOpen);
  const instances = useAppStore((s) => s.instances);
  const activeInstanceId = useAppStore((s) => s.activeInstanceId);
  const setActiveInstance = useAppStore((s) => s.setActiveInstance);
  const setAddTorrentModalOpen = useAppStore((s) => s.setAddTorrentModalOpen);
  const { data: health } = useHealth();

  return (
    <AnimatePresence>
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Slide-out Drawer */}
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 280 }}
            className="relative w-[82%] max-w-xs h-full bg-surface-overlay border-r border-glass-border flex flex-col z-10 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-16 border-b border-glass-border">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center">
                  <Download className="w-5 h-5 text-accent" />
                </div>
                <span className="text-lg font-bold text-gradient">qBit UI</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-glass-hover text-text-secondary"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Add Button */}
            <div className="p-4 border-b border-glass-border">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setAddTorrentModalOpen(true);
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-sm shadow-lg shadow-accent/20 transition-colors"
              >
                <Plus className="w-5 h-5" />
                Add Torrent
              </button>
            </div>

            {/* Multi-Instance Switcher */}
            <div className="px-4 py-3 border-b border-glass-border">
              <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-2">
                qBittorrent Instances
              </p>
              <div className="space-y-1.5">
                {instances.map((inst) => (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => {
                      setActiveInstance(inst.id);
                      setMobileMenuOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-3 w-full rounded-xl px-3 min-h-[44px] text-sm transition-all",
                      inst.id === activeInstanceId
                        ? "bg-accent/15 text-accent border border-accent/25 font-medium"
                        : "text-text-secondary hover:bg-glass-hover border border-transparent"
                    )}
                  >
                    <Server className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate flex-1 text-left">{inst.name}</span>
                    <Circle
                      className={cn(
                        "w-2.5 h-2.5 flex-shrink-0",
                        health?.qbittorrent_connected && inst.id === activeInstanceId
                          ? "fill-success text-success"
                          : "fill-text-muted text-text-muted"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* All Features Navigation */}
            <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
              <p className="text-[11px] uppercase tracking-wider text-text-muted font-semibold mb-2 px-1">
                Features & Tools
              </p>
              {drawerNavItems.map(({ path, icon: Icon, label }) => (
                <NavLink
                  key={path}
                  to={path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-xl px-3 min-h-[44px] text-sm font-medium transition-all",
                      isActive
                        ? "bg-accent/15 text-accent border border-accent/20"
                        : "text-text-secondary hover:bg-glass-hover hover:text-text-primary"
                    )
                  }
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

