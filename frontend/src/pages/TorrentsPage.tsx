import {
  useTorrents,
  useActiveInstance,
  useBulkPauseTorrents,
  useBulkResumeTorrents,
} from "@/hooks/useTorrents";
import { useDriveAuthStatus } from "@/hooks/useDrive";
import { useAppStore } from "@/stores/appStore";
import { TorrentTable, TorrentToolbar, ActiveDriveUploads } from "@/components/torrents";
import type { TorrentSortKey } from "@/components/torrents/TorrentTable";
import type { SortDirection } from "@/types";
import { DriveAuthModal, BatchUploadToDriveModal } from "@/components/drive";
import { Button, Skeleton, TorrentsSkeleton } from "@/components/ui";
import { formatBytes, formatSpeed, filterTorrents, isTorrentComplete, cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Download,
  Upload,
  HardDrive,
  Server,
  Play,
  Pause,
  Trash2,
  X,
  UploadCloud,
  CheckSquare,
  ArrowUpDown,
  Check,
} from "lucide-react";

interface SortOption {
  key: TorrentSortKey;
  dir: SortDirection;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { key: "added_on", dir: "desc", label: "Date Added (Newest)" },
  { key: "added_on", dir: "asc", label: "Date Added (Oldest)" },
  { key: "total_size", dir: "desc", label: "Size (Largest)" },
  { key: "total_size", dir: "asc", label: "Size (Smallest)" },
  { key: "num_seeds", dir: "desc", label: "Most Seeds" },
  { key: "num_leechs", dir: "desc", label: "Most Leechers / Peers" },
  { key: "name", dir: "asc", label: "Name (A → Z)" },
  { key: "name", dir: "desc", label: "Name (Z → A)" },
  { key: "progress", dir: "desc", label: "Progress (Highest)" },
  { key: "download_speed", dir: "desc", label: "Download Speed" },
  { key: "upload_speed", dir: "desc", label: "Upload Speed" },
  { key: "ratio", dir: "desc", label: "Share Ratio" },
];

export function TorrentsPage() {
  const instance = useActiveInstance();
  const torrentFilter = useAppStore((s) => s.torrentFilter);
  const selectedTorrents = useAppStore((s) => s.selectedTorrents);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const setDeleteConfirmHashes = useAppStore((s) => s.setDeleteConfirmHashes);
  const { data: torrents, isLoading, error } = useTorrents();

  const bulkPause = useBulkPauseTorrents();
  const bulkResume = useBulkResumeTorrents();

  const { data: driveAuth } = useDriveAuthStatus();
  const [driveAuthModalOpen, setDriveAuthModalOpen] = useState(false);
  const [batchUploadModalOpen, setBatchUploadModalOpen] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [sortKey, setSortKey] = useState<TorrentSortKey>("added_on");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [showSortMenu, setShowSortMenu] = useState(false);

  const currentSortOption = SORT_OPTIONS.find(
    (o) => o.key === sortKey && o.dir === sortDir
  );
  const currentSortLabel = currentSortOption
    ? currentSortOption.label
    : `${String(sortKey)} (${sortDir === "asc" ? "↑" : "↓"})`;

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

  const selectedArray = Array.from(selectedTorrents);
  const inSelectionMode = isSelectMode || selectedArray.length > 0;

  const selectedItems = useMemo(() => {
    if (!torrents || selectedArray.length === 0) return [];
    return torrents.filter((t) => selectedTorrents.has(t.hash));
  }, [torrents, selectedTorrents, selectedArray]);

  const completedSelected = useMemo(
    () => selectedItems.filter(isTorrentComplete),
    [selectedItems]
  );

  const handleBatchDriveUpload = () => {
    if (!driveAuth?.authenticated) {
      toast("Please connect Google Drive first", { icon: "🔐" });
      setDriveAuthModalOpen(true);
      return;
    }

    if (completedSelected.length === 0) {
      toast.error(
        "Only completed torrents can be uploaded to Google Drive."
      );
      return;
    }

    setBatchUploadModalOpen(true);
  };

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

  return (
    <div className="space-y-4">
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

      {/* Mode Controls: Normal [Pilih] Button vs Active Select Mode Bar */}
      {inSelectionMode ? (
        /* In-Flow Sticky Batch Action Bar */
        <div className="sticky top-[68px] z-30 bg-surface-elevated border border-accent/40 rounded-2xl p-2.5 sm:px-4 shadow-xl flex flex-wrap items-center justify-between gap-2 animate-fadeIn">
          <label className="flex items-center gap-2 pl-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={
                filtered.length > 0 &&
                filtered.every((t) => selectedTorrents.has(t.hash))
              }
              onChange={() => {
                const allSelected =
                  filtered.length > 0 &&
                  filtered.every((t) => selectedTorrents.has(t.hash));
                if (allSelected) {
                  clearSelection();
                } else {
                  useAppStore
                    .getState()
                    .selectAllTorrents(filtered.map((t) => t.hash));
                }
              }}
              className="w-4 h-4 rounded accent-accent cursor-pointer"
            />
            <span className="text-xs sm:text-sm font-medium text-text-primary">
              {selectedArray.length > 0
                ? `${selectedArray.length} selected`
                : `All (${filtered.length})`}
            </span>
          </label>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {selectedArray.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-[38px] px-2.5 sm:px-3 text-xs"
                  icon={<Play className="w-4 h-4 text-success" />}
                  loading={bulkResume.isPending}
                  onClick={() =>
                    bulkResume.mutate(selectedArray, {
                      onSuccess: () => clearSelection(),
                    })
                  }
                >
                  <span className="hidden xs:inline">Resume</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-[38px] px-2.5 sm:px-3 text-xs"
                  icon={<Pause className="w-4 h-4 text-warning" />}
                  loading={bulkPause.isPending}
                  onClick={() =>
                    bulkPause.mutate(selectedArray, {
                      onSuccess: () => clearSelection(),
                    })
                  }
                >
                  <span className="hidden xs:inline">Pause</span>
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="min-h-[38px] px-2.5 sm:px-3 text-xs"
                  icon={<Trash2 className="w-4 h-4" />}
                  onClick={() => setDeleteConfirmHashes(selectedArray)}
                >
                  <span className="hidden xs:inline">Delete</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-[38px] px-2.5 sm:px-3 text-xs text-accent hover:text-accent-hover hover:border-accent/40"
                  icon={<UploadCloud className="w-4 h-4 text-accent" />}
                  onClick={handleBatchDriveUpload}
                  title={`Upload ${completedSelected.length} completed torrents to Google Drive`}
                >
                  <span className="hidden xs:inline">Upload to Drive</span>
                </Button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                clearSelection();
                setIsSelectMode(false);
              }}
              className="px-3 min-h-[38px] rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-xs font-medium text-text-primary transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        /* Normal Mode: Clean Bar with [Select] button on Left and [Sort] on Right */
        <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <button
            type="button"
            onClick={() => setIsSelectMode(true)}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover transition-colors text-text-secondary hover:text-text-primary text-[11px] sm:text-xs font-medium"
            title="Select torrents"
          >
            <CheckSquare className="w-3.5 h-3.5 text-accent" />
            <span>Select</span>
          </button>

          {/* Sort Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover transition-colors text-text-secondary hover:text-text-primary text-[11px] sm:text-xs font-medium"
              title="Sort torrent list"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-accent" />
              <span className="truncate max-w-[140px] sm:max-w-none">
                {currentSortLabel}
              </span>
            </button>

            {showSortMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowSortMenu(false)}
                />
                <div className="absolute right-0 top-9 z-50 min-w-[210px] max-h-[300px] overflow-y-auto bg-surface-overlay border border-glass-border rounded-xl shadow-2xl py-1 text-xs">
                  {SORT_OPTIONS.map((opt) => {
                    const isSelected =
                      sortKey === opt.key && sortDir === opt.dir;
                    return (
                      <button
                        key={`${opt.key}-${opt.dir}`}
                        type="button"
                        onClick={() => {
                          setSortKey(opt.key);
                          setSortDir(opt.dir);
                          setShowSortMenu(false);
                        }}
                        className={cn(
                          "w-full px-3 py-2 text-left hover:bg-glass-hover transition-colors flex items-center justify-between",
                          isSelected
                            ? "text-accent font-semibold bg-accent/10"
                            : "text-text-secondary"
                        )}
                      >
                        <span>{opt.label}</span>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-accent stroke-[2.5]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
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
        <TorrentTable
          torrents={filtered}
          filterKey={torrentFilter}
          isSelectMode={inSelectionMode}
          onEnterSelectMode={() => setIsSelectMode(true)}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={(k, d) => {
            setSortKey(k);
            setSortDir(d);
          }}
        />
      )}

      <DriveAuthModal
        open={driveAuthModalOpen}
        onClose={() => setDriveAuthModalOpen(false)}
      />

      <BatchUploadToDriveModal
        open={batchUploadModalOpen}
        onClose={() => setBatchUploadModalOpen(false)}
        torrents={completedSelected}
        allSelectedCount={selectedArray.length}
        onSuccess={() => {
          clearSelection();
        }}
      />
    </div>
  );
}
