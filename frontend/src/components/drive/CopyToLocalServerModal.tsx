import { useState, useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Input } from "@/components/ui/Input";
import { useSystemStats, useServerPaths } from "@/hooks/useTorrents";
import { useDownloadToServer } from "@/hooks/useDrive";
import { useAppStore } from "@/stores/appStore";
import { formatBytes } from "@/lib/utils";
import type { DriveFileItem } from "@/types";
import {
  HardDriveDownload,
  HardDrive,
  FolderOpen,
  AlertTriangle,
  Loader2,
  CornerLeftUp,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";

interface CopyToLocalServerModalProps {
  open: boolean;
  onClose: () => void;
  items: DriveFileItem[];
  onSuccess?: () => void;
}

export function CopyToLocalServerModal({
  open,
  onClose,
  items,
  onSuccess,
}: CopyToLocalServerModalProps) {
  const driveDefaultLocalPath = useAppStore((s) => s.driveDefaultLocalPath);
  const setDriveDefaultLocalPath = useAppStore((s) => s.setDriveDefaultLocalPath);

  const { data: stats, isLoading: statsLoading } = useSystemStats();
  const defaultBasePath = driveDefaultLocalPath || stats?.disk_path || "/downloads";

  const [targetPath, setTargetPath] = useState<string>(defaultBasePath);
  const [browsingPaths, setBrowsingPaths] = useState(false);
  const [browseTarget, setBrowseTarget] = useState<string | undefined>(undefined);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [autoAttachReseed, setAutoAttachReseed] = useState(false);

  const {
    data: serverPaths,
    isLoading: pathsLoading,
    isError: pathsError,
  } = useServerPaths(browseTarget, open && browsingPaths);

  const downloadMutation = useDownloadToServer();

  const totalBytes = useMemo(() => {
    return items.reduce((acc, item) => acc + (item.size || 0), 0);
  }, [items]);

  const diskFreeBytes = stats?.disk_free_bytes ?? 0;
  const diskTotalBytes = stats?.disk_total_bytes ?? 0;
  const isDiskSpaceInsufficient = totalBytes > 0 && diskFreeBytes > 0 && totalBytes > diskFreeBytes;

  const diskFreePercent =
    diskTotalBytes > 0
      ? Math.max(0, Math.min(100, Math.round((diskFreeBytes / diskTotalBytes) * 100)))
      : null;

  const handleStartCopy = () => {
    if (items.length === 0) return;

    if (setAsDefault && targetPath.trim()) {
      setDriveDefaultLocalPath(targetPath.trim());
    }

    const payloadItems = items.map((item) => ({
      file_id: item.id,
      name: item.name,
      size: item.size || undefined,
      mime_type: item.mimeType || undefined,
    }));

    downloadMutation.mutate(
      {
        items: payloadItems,
        destinationPath: targetPath.trim() || undefined,
        autoAttachReseed,
      },
      {
        onSuccess: () => {
          onSuccess?.();
          onClose();
        },
      }
    );
  };

  const isSingle = items.length === 1;
  const singleItem = items[0];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isSingle ? "Copy to Local Server" : "Batch Copy to Server"}
      size="lg"
    >
      <div className="space-y-4">
        {/* File Info & VPS Disk Space Check */}
        <div className="p-3.5 rounded-xl bg-surface-elevated/90 border border-glass-border space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-sky-500/15 flex items-center justify-center text-sky-400 flex-shrink-0">
                <HardDriveDownload className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
                  Source from Drive ({items.length} {items.length > 1 ? "items" : "item"})
                </p>
                {isSingle ? (
                  <p className="text-sm font-semibold text-text-primary truncate" title={singleItem.name}>
                    {singleItem.name}
                  </p>
                ) : (
                  <p className="text-sm font-semibold text-text-primary">
                    {items.length} items selected
                  </p>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="text-xs font-mono font-medium text-text-primary">
                {totalBytes > 0 ? formatBytes(totalBytes) : singleItem?.mimeType?.includes("folder") ? "Folder" : "0 B"}
              </span>
            </div>
          </div>

          {/* Multiple items list preview */}
          {!isSingle && (
            <div className="max-h-36 overflow-y-auto space-y-1 pr-1 border-t border-glass-border/60 pt-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface/50 text-xs"
                >
                  <span className="truncate text-text-secondary" title={item.name}>
                    {item.name}
                  </span>
                  <span className="font-mono text-text-muted text-[11px] flex-shrink-0">
                    {item.size ? formatBytes(item.size) : item.mimeType?.includes("folder") ? "Folder" : "0 B"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* VPS Storage Capacity Indicator */}
          <div className="pt-2 border-t border-glass-border/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-text-secondary">
                <HardDrive className="w-3.5 h-3.5 text-sky-400" />
                <span>Available VPS Space:</span>
                <span className="font-semibold text-text-primary font-mono">
                  {statsLoading ? "Checking..." : formatBytes(diskFreeBytes)}
                </span>
                {diskFreePercent !== null && (
                  <span className="text-text-muted">({diskFreePercent}% free)</span>
                )}
              </div>
              <span className="text-text-muted font-mono text-[11px] truncate max-w-[140px]">
                {stats?.disk_path || "/downloads"}
              </span>
            </div>

            {/* Disk capacity bar */}
            {stats && stats.disk_total_bytes > 0 && (
              <ProgressBar
                value={Math.round(
                  ((stats.disk_total_bytes - stats.disk_free_bytes) / stats.disk_total_bytes) * 100
                )}
                size="sm"
                variant={isDiskSpaceInsufficient ? "danger" : "accent"}
              />
            )}

            {/* Insufficient Disk Alert */}
            {isDiskSpaceInsufficient && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-xs text-danger">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  Peringatan: Ukuran file ({formatBytes(totalBytes)}) melebihi sisa ruang disk VPS ({formatBytes(diskFreeBytes)})!
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Target Directory di VPS */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold">
              Target Directory di VPS
            </label>
            <button
              type="button"
              onClick={() => setBrowsingPaths(!browsingPaths)}
              className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {browsingPaths ? "Hide Folder Browser" : "Browse VPS Folders"}
            </button>
          </div>

          <Input
            placeholder="/downloads"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            icon={<FolderOpen className="w-4 h-4 text-warning" />}
          />

          {/* VPS Folder Picker / Browser */}
          {browsingPaths && (
            <div className="rounded-xl bg-surface-elevated border border-glass-border p-3 space-y-2 animate-fadeIn">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-glass-border">
                <p className="text-xs font-mono text-text-secondary truncate">
                  {serverPaths?.current_path || "Known VPS Paths"}
                </p>
                {serverPaths?.current_path && (
                  <button
                    type="button"
                    onClick={() => {
                      setTargetPath(serverPaths.current_path);
                      setBrowsingPaths(false);
                    }}
                    className="text-xs font-medium text-emerald-400 hover:underline flex items-center gap-1 flex-shrink-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Use this folder
                  </button>
                )}
              </div>

              {pathsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 text-accent animate-spin" />
                </div>
              ) : !pathsError && serverPaths ? (
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                  {serverPaths.parent_path && (
                    <button
                      type="button"
                      onClick={() => setBrowseTarget(serverPaths.parent_path!)}
                      className="w-full flex items-center gap-2 px-2.5 min-h-[36px] rounded-lg text-xs text-text-secondary hover:bg-glass-hover text-left"
                    >
                      <CornerLeftUp className="w-4 h-4" /> .. (Up one level)
                    </button>
                  )}
                  {serverPaths.directories.map((dir) => (
                    <div
                      key={dir.path}
                      className="flex items-center justify-between gap-2 px-2.5 min-h-[36px] rounded-lg hover:bg-glass-hover"
                    >
                      <button
                        type="button"
                        onClick={() => setBrowseTarget(dir.path)}
                        className="flex items-center gap-2 text-xs text-text-primary truncate flex-1 text-left"
                      >
                        <FolderOpen className="w-4 h-4 text-warning flex-shrink-0" />
                        <span className="truncate">{dir.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTargetPath(dir.path);
                          setBrowsingPaths(false);
                        }}
                        className="text-[11px] px-2 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors flex-shrink-0"
                      >
                        Select
                      </button>
                    </div>
                  ))}
                  {serverPaths.directories.length === 0 && !serverPaths.parent_path && (
                    <p className="text-xs text-text-muted py-2 text-center">
                      No subdirectories found.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-text-muted py-2 text-center">
                  Could not load server directories.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Set as default local path checkbox */}
        <label className="flex items-center gap-2.5 min-h-[36px] px-1 cursor-pointer">
          <input
            type="checkbox"
            checked={setAsDefault}
            onChange={(e) => setSetAsDefault(e.target.checked)}
            className="w-4 h-4 rounded accent-accent cursor-pointer"
          />
          <span className="text-xs sm:text-sm text-text-secondary">
            Set as default local path
          </span>
        </label>

        {/* Opsi Lanjutan: Auto-attach for Re-seed */}
        <div className="p-3 rounded-xl bg-surface-elevated/70 border border-glass-border space-y-1.5">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoAttachReseed}
              onChange={(e) => setAutoAttachReseed(e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded accent-accent cursor-pointer flex-shrink-0"
            />
            <div>
              <span className="text-xs sm:text-sm font-medium text-text-primary flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-accent" />
                Auto-attach for Re-seed
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                Automatically mark or prepare this file for seeding via torrent / magnet link after the download to VPS completes.
              </p>
            </div>
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStartCopy}
            disabled={downloadMutation.isPending || !targetPath.trim()}
            className="flex-1 sm:flex-initial min-h-[42px] px-6 flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm shadow-md shadow-accent/25 transition-all"
          >
            {downloadMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting Pull...
              </>
            ) : (
              <>
                <HardDriveDownload className="w-4 h-4" />
                {isSingle ? "Copy to Local Server" : `Copy to Server (${items.length})`}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
