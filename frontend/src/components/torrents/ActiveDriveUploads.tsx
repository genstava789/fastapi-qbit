import { useEffect } from "react";
import { useDriveUploads, useClearCompletedUploads } from "@/hooks/useDrive";
import { useAppStore } from "@/stores/appStore";
import { formatBytes } from "@/lib/utils";
import { ProgressBar, Badge } from "@/components/ui";
import { UploadCloud } from "lucide-react";

export function ActiveDriveUploads() {
  const { data: uploads } = useDriveUploads();
  const clearCompleted = useClearCompletedUploads();
  const markDriveUploadCompleted = useAppStore((s) => s.markDriveUploadCompleted);

  // Sync completed uploads to store so torrent indicators persist, then auto-purge
  useEffect(() => {
    if (!uploads || uploads.length === 0) return;

    let hasCompleted = false;
    for (const up of uploads) {
      if (up.status === "completed") {
        hasCompleted = true;
        markDriveUploadCompleted({
          filename: up.filename,
          torrent_hash: up.torrent_hash,
          drive_file_id: up.drive_file_id,
        });
      } else if (up.status === "failed") {
        hasCompleted = true;
      }
    }

    // Immediately clear completed/failed tasks from backend so they don't pile up
    if (hasCompleted) {
      clearCompleted.mutate();
    }
  }, [uploads, markDriveUploadCompleted, clearCompleted]);

  // Only show uploads that are currently in progress
  const activeTasks =
    uploads?.filter(
      (up) => up.status === "uploading" || up.status === "pending"
    ) || [];

  if (activeTasks.length === 0) {
    return null;
  }

  return (
    <div className="glass rounded-2xl p-4 border border-accent/30 bg-accent/[0.03] space-y-3 shadow-lg shadow-accent/5 transition-all animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center text-accent">
            <UploadCloud className="w-4 h-4 animate-spin" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              Uploading to Google Drive
              <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
            </h2>
            <p className="text-xs text-text-muted">
              {activeTasks.length} active upload task{activeTasks.length > 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <Badge variant="accent" className="font-mono text-xs">
          {activeTasks.length} Active
        </Badge>
      </div>

      <div className="space-y-2.5">
        {activeTasks.map((up) => (
          <div
            key={up.upload_id}
            className="p-3 rounded-xl bg-surface-elevated/90 border border-glass-border space-y-2"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary truncate" title={up.filename}>
                  {up.filename}
                </p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-text-muted font-mono">
                  <span>
                    {formatBytes(up.bytes_uploaded)} / {formatBytes(up.total_bytes)}
                  </span>
                  {up.total_bytes > 0 && (
                    <span>· {Math.round(up.progress_percent)}%</span>
                  )}
                </div>
              </div>
              <Badge variant="accent" className="gap-1 animate-pulse flex-shrink-0">
                <UploadCloud className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading</span>
              </Badge>
            </div>
            <ProgressBar
              value={up.progress_percent}
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

