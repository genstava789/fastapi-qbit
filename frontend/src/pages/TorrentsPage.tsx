import {
  useTorrents,
  useActiveInstance,
  useBulkPauseTorrents,
  useBulkResumeTorrents,
} from "@/hooks/useTorrents";
import { useAppStore } from "@/stores/appStore";
import { TorrentTable, TorrentToolbar, ActiveDriveUploads } from "@/components/torrents";
import { Button, Skeleton, TorrentsSkeleton } from "@/components/ui";
import { formatBytes, formatSpeed, filterTorrents } from "@/lib/utils";
import { useMemo } from "react";
import {
  Download,
  Upload,
  HardDrive,
  Server,
  Play,
  Pause,
  Trash2,
  X,
} from "lucide-react";

export function TorrentsPage() {
  const instance = useActiveInstance();
  const torrentFilter = useAppStore((s) => s.torrentFilter);
  const selectedTorrents = useAppStore((s) => s.selectedTorrents);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const setDeleteConfirmHashes = useAppStore((s) => s.setDeleteConfirmHashes);
  const { data: torrents, isLoading, error } = useTorrents();

  const bulkPause = useBulkPauseTorrents();
  const bulkResume = useBulkResumeTorrents();

  const filtered = useMemo(
    () => filterTorrents(torrents || [], torrentFilter),
    [torrents, torrentFilter]
  );

  const stats = useMemo(() => {
    if (!torrents) return null;
    return {
      totalDl: torrents.reduce((s, t) => s + t.download_speed, 0),
      totalUl: torrents.reduce((s, t) => s + t.upload_speed, 0),
      totalSize: torrents.reduce((s, t) => s + t.total_size, 0),
    };
  }, [torrents]);

  if (!instance) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Server className="w-16 h-16 text-text-muted mb-4" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          No Instance Selected
        </h2>
        <p className="text-text-secondary text-center">
          Configure an instance in Settings to view torrents.
        </p>
      </div>
    );
  }

  const selectedArray = Array.from(selectedTorrents);

  return (
    <div className="space-y-4 pb-6">
      {/* Header Stats Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Torrents</h1>
          {isLoading ? (
            <Skeleton className="h-4 w-32 mt-1.5" />
          ) : (
            <p className="text-sm text-text-secondary mt-0.5">
              {torrents?.length || 0} total · {filtered.length} shown
            </p>
          )}
        </div>
        {isLoading ? (
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ) : (
          stats && (
            <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm font-mono">
              <span className="flex items-center gap-1.5 text-accent font-semibold">
                <Download className="w-4 h-4" />
                {formatSpeed(stats.totalDl)}
              </span>
              <span className="flex items-center gap-1.5 text-success font-semibold">
                <Upload className="w-4 h-4" />
                {formatSpeed(stats.totalUl)}
              </span>
              <span className="flex items-center gap-1.5 text-text-secondary">
                <HardDrive className="w-4 h-4" />
                {formatBytes(stats.totalSize)}
              </span>
            </div>
          )
        )}
      </div>

      {/* Compact Filter Toolbar */}
      <TorrentToolbar />

      {/* In-Flow Sticky Batch Action Bar (Never covers torrent cards) */}
      {selectedArray.length > 0 && (
        <div className="sticky top-[68px] z-30 bg-surface-elevated border border-accent/40 rounded-2xl p-2.5 sm:px-4 shadow-xl flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 pl-1">
            <span className="inline-flex items-center justify-center min-w-[26px] h-6 px-2 rounded-lg bg-accent text-white text-xs font-bold">
              {selectedArray.length}
            </span>
            <span className="text-sm font-medium text-text-primary">
              selected
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="min-h-[40px] px-2.5 sm:px-3"
              icon={<Play className="w-4 h-4 text-success" />}
              loading={bulkResume.isPending}
              onClick={() =>
                bulkResume.mutate(selectedArray, {
                  onSuccess: () => clearSelection(),
                })
              }
            >
              <span className="hidden xs:inline sm:inline">Resume</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="min-h-[40px] px-2.5 sm:px-3"
              icon={<Pause className="w-4 h-4 text-warning" />}
              loading={bulkPause.isPending}
              onClick={() =>
                bulkPause.mutate(selectedArray, {
                  onSuccess: () => clearSelection(),
                })
              }
            >
              <span className="hidden xs:inline sm:inline">Pause</span>
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="min-h-[40px] px-2.5 sm:px-3"
              icon={<Trash2 className="w-4 h-4" />}
              onClick={() => setDeleteConfirmHashes(selectedArray)}
            >
              <span className="hidden xs:inline sm:inline">Delete</span>
            </Button>
            <button
              type="button"
              onClick={clearSelection}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-glass-hover text-text-muted hover:text-text-primary"
              aria-label="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Active Drive Background Upload Tasks */}
      <ActiveDriveUploads />

      {/* Torrent List / Table or Skeleton */}
      {isLoading ? (
        <TorrentsSkeleton count={4} />
      ) : error ? (
        <div className="glass rounded-xl p-8 text-center">
          <p className="text-danger">Failed to load torrents</p>
          <p className="text-xs text-text-muted mt-1">{String(error)}</p>
        </div>
      ) : (
        <TorrentTable torrents={filtered} filterKey={torrentFilter} />
      )}
    </div>
  );
}
