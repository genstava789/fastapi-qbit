import { useEffect } from "react";
import {
  useDriveDownloads,
  useClearCompletedDownloads,
  useCancelDownloadToServer,
} from "@/hooks/useDrive";
import { useAppStore } from "@/stores/appStore";
import { formatBytes } from "@/lib/utils";
import { ProgressBar, Badge } from "@/components/ui";
import { HardDriveDownload, X, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

export function ActiveDriveDownloads() {
  const { data: downloads } = useDriveDownloads();
  const clearCompleted = useClearCompletedDownloads();
  const cancelTask = useCancelDownloadToServer();
  const openAddTorrentWithPrefill = useAppStore(
    (s) => s.openAddTorrentWithPrefill
  );

  // Auto-clear completed or failed tasks so they don't pile up in the UI
  useEffect(() => {
    if (!downloads || downloads.length === 0) return;

    let hasCompleted = false;
    for (const d of downloads) {
      if (d.status === "completed") {
        hasCompleted = true;
        // If auto_attach_reseed was enabled, prompt / toast user to seed
        if (d.auto_attach_reseed) {
          toast(
            (t) => (
              <div className="flex items-center justify-between gap-3 text-xs">
                <span>
                  <b>{d.filename}</b> downloaded to VPS. Ready for Re-seed!
                </span>
                <button
                  type="button"
                  onClick={() => {
                    toast.dismiss(t.id);
                    openAddTorrentWithPrefill({
                      savePath: d.destination_path,
                      reseedMode: true,
                      skipChecking: false,
                      title: d.filename,
                    });
                  }}
                  className="px-2 py-1 rounded bg-accent text-white font-medium hover:bg-accent-hover transition-colors"
                >
                  Seed Now
                </button>
              </div>
            ),
            { duration: 8000, icon: "🌱" }
          );
        }
      } else if (d.status === "failed") {
        hasCompleted = true;
      }
    }

    if (hasCompleted) {
      // Delay slightly (1.2s) so 100% progress state is briefly visible before clearing
      const timer = setTimeout(() => {
        clearCompleted.mutate();
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [downloads, clearCompleted, openAddTorrentWithPrefill]);

  // Only show tasks currently in progress (downloading or pending)
  const activeTasks =
    downloads?.filter(
      (d) => d.status === "downloading" || d.status === "pending"
    ) || [];

  if (activeTasks.length === 0) {
    return null;
  }

  return (
    <div className="glass rounded-2xl p-4 border border-sky-500/30 bg-sky-500/[0.03] space-y-3 shadow-lg shadow-sky-500/5 transition-all animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-sky-500/15 flex items-center justify-center text-sky-400">
            <HardDriveDownload className="w-4 h-4 animate-bounce" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              Pulling to Local Server
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            </h2>
            <p className="text-xs text-text-muted">
              {activeTasks.length} active download task{activeTasks.length > 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <Badge variant="accent" className="font-mono text-xs bg-sky-500/20 text-sky-300 border-sky-500/30">
          {activeTasks.length} In Progress
        </Badge>
      </div>

      <div className="space-y-2.5">
        {activeTasks.map((d) => (
          <div
            key={d.task_id}
            className="p-3 rounded-xl bg-surface-elevated/90 border border-glass-border space-y-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-sky-400 font-medium">
                  Copying to Local Server ({d.destination_path})
                </p>
                <p className="text-sm font-medium text-text-primary truncate mt-0.5" title={d.filename}>
                  {d.filename}
                </p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-text-muted font-mono">
                  <span>
                    {formatBytes(d.bytes_downloaded)} / {d.total_bytes > 0 ? formatBytes(d.total_bytes) : "Unknown size"}
                  </span>
                  <span>({d.progress_percent.toFixed(1)}%)</span>
                  {d.speed_bytes_sec > 0 && (
                    <span>• {formatBytes(d.speed_bytes_sec)}/s</span>
                  )}
                  {d.auto_attach_reseed && (
                    <span className="text-emerald-400 inline-flex items-center gap-0.5 ml-1">
                      <RefreshCw className="w-3 h-3" /> Re-seed
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="accent" className="gap-1 animate-pulse bg-sky-500/20 text-sky-300 border-sky-500/30">
                  <HardDriveDownload className="w-3.5 h-3.5 animate-bounce" />
                  <span>Pulling</span>
                </Badge>
                <button
                  type="button"
                  onClick={() => cancelTask.mutate(d.task_id)}
                  className="p-1 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                  title="Cancel download"
                  aria-label="Cancel download"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <ProgressBar
              value={d.progress_percent}
              size="sm"
              showLabel
              variant="accent"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
