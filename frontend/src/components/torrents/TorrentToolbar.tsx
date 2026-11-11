import { useAppStore } from "@/stores/appStore";
import { cn } from "@/lib/utils";
import type { TorrentFilter } from "@/types";
import {
  Download,
  Upload,
  Pause,
  Activity,
  AlertTriangle,
  List,
  Zap,
  Clock,
} from "lucide-react";

const filters: { key: TorrentFilter; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "All", icon: List },
  { key: "downloading", label: "Downloading", icon: Download },
  { key: "completed", label: "Completed", icon: Upload },
  { key: "active", label: "Active", icon: Zap },
  { key: "paused", label: "Paused", icon: Pause },
  { key: "inactive", label: "Inactive", icon: Clock },
  { key: "stalled", label: "Stalled", icon: Activity },
  { key: "error", label: "Error", icon: AlertTriangle },
];

export function TorrentToolbar() {
  const activeFilter = useAppStore((s) => s.torrentFilter);
  const setFilter = useAppStore((s) => s.setTorrentFilter);

  return (
    <div className="flex items-center gap-1 p-1 rounded-xl glass overflow-x-auto no-scrollbar">
      {filters.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => setFilter(key)}
          className={cn(
            "flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0",
            activeFilter === key
              ? "bg-accent text-white shadow-md shadow-accent/25"
              : "text-text-secondary hover:text-text-primary hover:bg-glass-hover"
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
