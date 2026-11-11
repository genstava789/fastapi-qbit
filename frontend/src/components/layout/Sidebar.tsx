import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import {
  LayoutDashboard,
  Download,
  Search,
  GitFork,
  Wifi,
  FolderOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  Server,
  Circle,
} from "lucide-react";
import { useHealth } from "@/hooks/useTorrents";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
  { path: "/", icon: LayoutDashboard, label: "Dashboard" },
  { path: "/torrents", icon: Download, label: "Torrents" },
  { path: "/prowlarr", icon: Search, label: "Prowlarr Search" },
  { path: "/crossseed", icon: GitFork, label: "Cross-Seed" },
  { path: "/network", icon: Wifi, label: "Network Agent" },
  { path: "/files", icon: FolderOpen, label: "File Browser" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const instances = useAppStore((s) => s.instances);
  const activeInstanceId = useAppStore((s) => s.activeInstanceId);
  const setActiveInstance = useAppStore((s) => s.setActiveInstance);
  const { data: health } = useHealth();

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarOpen ? 256 : 72 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 glass flex-col border-r border-glass-border"
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-glass-border">
        <div className="w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5 text-accent" />
        </div>
        <AnimatePresence>
          {sidebarOpen && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-lg font-bold text-gradient whitespace-nowrap"
            >
              qBit UI
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Instances Selector */}
      <div className="px-3 py-3 border-b border-glass-border">
        {sidebarOpen && (
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-2 px-1">
            Instances
          </p>
        )}
        <div className="space-y-1">
          {instances.map((inst) => (
            <button
              key={inst.id}
              onClick={() => setActiveInstance(inst.id)}
              className={cn(
                "flex items-center gap-2 w-full rounded-lg px-2 py-2 text-sm transition-all",
                inst.id === activeInstanceId
                  ? "bg-accent/10 text-accent border border-accent/20"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary border border-transparent"
              )}
            >
              <Server className="w-4 h-4 flex-shrink-0" />
              {sidebarOpen && (
                <>
                  <span className="truncate flex-1 text-left">{inst.name}</span>
                  <Circle
                    className={cn(
                      "w-2 h-2 flex-shrink-0",
                      health?.qbittorrent_connected && inst.id === activeInstanceId
                        ? "fill-success text-success"
                        : "fill-text-muted text-text-muted"
                    )}
                  />
                </>
              )}
            </button>
          ))}
          {instances.length === 0 && sidebarOpen && (
            <p className="text-xs text-text-muted px-2 py-1">
              No instances configured
            </p>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {sidebarOpen && (
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-2 px-1">
            Navigation
          </p>
        )}
        {navItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-accent/10 text-accent glow-accent"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary"
              )
            }
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <AnimatePresence>
              {sidebarOpen && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="whitespace-nowrap"
                >
                  {label}
                </motion.span>
              )}
            </AnimatePresence>
          </NavLink>
        ))}
      </nav>

      {/* Toggle Button */}
      <div className="px-3 py-3 border-t border-glass-border">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="flex items-center justify-center w-full py-2 rounded-lg hover:bg-glass-hover text-text-muted hover:text-text-primary transition-colors"
        >
          {sidebarOpen ? (
            <ChevronLeft className="w-5 h-5" />
          ) : (
            <ChevronRight className="w-5 h-5" />
          )}
        </button>
      </div>
    </motion.aside>
  );
}

