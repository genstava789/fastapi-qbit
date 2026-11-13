import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  getTorrentStateLabel,
  getTorrentStateTooltip,
  isTorrentComplete,
  paginateItems,
  calculateTorrentRatio,
  isTorrentDownloading,
  getTorrentDownloadPriorityTier,
} from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { usePauseTorrent, useResumeTorrent, useApi } from "@/hooks/useTorrents";
import { ProgressBar, Badge } from "@/components/ui";
import {
  Pause,
  Play,
  Trash2,
  Download,
  Upload,
  FileDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Info,
  MoreVertical,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  UploadCloud,
  Users,
} from "lucide-react";
import type { TorrentItem, SortDirection, DriveUploadProgress } from "@/types";
import { TorrentDetailModal } from "./TorrentDetailModal";
import { useDriveAuthStatus, useDriveUploads } from "@/hooks/useDrive";
import { DriveAuthModal, UploadToDriveModal } from "@/components/drive";
import toast from "react-hot-toast";

const PAGE_SIZE = 10;

export type TorrentSortKey =
  | keyof TorrentItem
  | "ratio";

export interface TorrentTableProps {
  torrents: TorrentItem[];
  filterKey?: string;
  isSelectMode?: boolean;
  onEnterSelectMode?: () => void;
  sortKey?: TorrentSortKey;
  sortDir?: SortDirection;
  onSortChange?: (key: TorrentSortKey, dir: SortDirection) => void;
}

type SortKey = TorrentSortKey;

function SortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDirection;
}) {
  if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
  return sortDir === "asc" ? (
    <ArrowUp className="w-3 h-3 text-accent" />
  ) : (
    <ArrowDown className="w-3 h-3 text-accent" />
  );
}

function getBadgeVariant(state: string) {
  if (state.includes("paused")) return "default" as const;
  if (state.includes("UP") || state === "uploading") return "success" as const;
  if (state === "downloading" || state === "forcedDL") return "accent" as const;
  if (state === "error" || state === "missingFiles") return "danger" as const;
  if (state.includes("stalled")) return "warning" as const;
  return "info" as const;
}

interface MobileTorrentCardProps {
  torrent: TorrentItem;
  ratio: string;
  activeDriveUpload?: DriveUploadProgress;
  completedDriveUpload?: { filename: string; drive_file_id?: string; completed_at?: number };
  isSelected: boolean;
  isSelectMode: boolean;
  onEnterSelectMode?: () => void;
  onToggleSelect: () => void;
  onOpenDetail: () => void;
  onPause: () => void;
  onResume: () => void;
  onOpenMenu: () => void;
}

function MobileTorrentCard({
  torrent,
  ratio,
  activeDriveUpload,
  completedDriveUpload,
  isSelected,
  isSelectMode,
  onEnterSelectMode,
  onToggleSelect,
  onOpenDetail,
  onPause,
  onResume,
  onOpenMenu,
}: MobileTorrentCardProps) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  const handleTouchStart = () => {
    longPressedRef.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressedRef.current = true;
      if (!isSelectMode) {
        onEnterSelectMode?.();
      }
      onToggleSelect();
    }, 450);
  };

  const handleTouchEndOrMove = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleCardClick = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    if (isSelectMode) {
      onToggleSelect();
    } else {
      onOpenDetail();
    }
  };

  const isPaused = torrent.state.includes("paused");
  const isDownloading = isTorrentDownloading(torrent);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEndOrMove}
      onTouchMove={handleTouchEndOrMove}
      className={cn(
        "glass rounded-2xl p-4 transition-all select-none cursor-pointer",
        isDownloading && "border-l-4 border-l-accent bg-accent/[0.03]",
        isSelected
          ? "border-accent bg-accent/10 ring-1 ring-accent/40"
          : "border-glass-border"
      )}
    >
      {/* Top Row: Checkbox (shown only in isSelectMode) + Title + More Button */}
      <div className="flex items-start gap-2">
        {isSelectMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            aria-label={`Select ${torrent.name}`}
            className="min-w-[40px] min-h-[40px] -ml-1 -mt-1 flex items-center justify-center rounded-xl active:bg-glass-hover flex-shrink-0"
          >
            <span
              className={cn(
                "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                isSelected
                  ? "bg-accent border-accent text-white"
                  : "border-text-muted/50 bg-surface-elevated"
              )}
            >
              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
            </span>
          </button>
        )}

        <div
          onClick={handleCardClick}
          className="flex-1 min-w-0 pt-0.5 cursor-pointer"
        >
          <h3 className="text-[14px] sm:text-[15px] font-semibold text-text-primary leading-snug line-clamp-3 break-words">
            {torrent.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge
              variant={getBadgeVariant(torrent.state)}
              title={getTorrentStateTooltip(torrent.state, torrent.progress, torrent.upload_speed)}
            >
              {getTorrentStateLabel(torrent.state, torrent.progress, torrent.upload_speed)}
            </Badge>
            <span className="text-xs font-mono font-semibold text-text-primary">
              {torrent.progress.toFixed(1)}%
            </span>

            {/* Conditional Transfer Speed per Torrent When Active */}
            {(torrent.download_speed > 0 || torrent.upload_speed > 0) && (
              <span className="text-text-muted text-xs">•</span>
            )}
            {torrent.download_speed > 0 && (
              <span
                className="inline-flex items-center gap-0.5 text-xs font-mono font-semibold text-accent"
                title={`Download: ${formatSpeed(torrent.download_speed)}`}
              >
                <Download className="w-3 h-3 stroke-[2.5]" />
                <span>{formatSpeed(torrent.download_speed)}</span>
              </span>
            )}
            {torrent.upload_speed > 0 && (
              <span
                className="inline-flex items-center gap-0.5 text-xs font-mono font-semibold text-success"
                title={`Upload: ${formatSpeed(torrent.upload_speed)}`}
              >
                <Upload className="w-3 h-3 stroke-[2.5]" />
                <span>{formatSpeed(torrent.upload_speed)}</span>
              </span>
            )}

            {/* Active Google Drive upload badge */}
            {activeDriveUpload && (
              <Badge
                variant="accent"
                className="gap-1 animate-pulse font-mono text-[11px] bg-accent/20 border-accent/40 text-accent"
              >
                <UploadCloud className="w-3.5 h-3.5 animate-spin" />
                <span>Drive {Math.round(activeDriveUpload.progress_percent)}%</span>
              </Badge>
            )}

            {/* In Drive badge if already uploaded */}
            {!activeDriveUpload && completedDriveUpload && (
              <a
                href={
                  completedDriveUpload.drive_file_id
                    ? `https://drive.google.com/open?id=${completedDriveUpload.drive_file_id}`
                    : `https://drive.google.com/drive/search?q=${encodeURIComponent(torrent.name)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Uploaded to Google Drive - Click to open"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-success/15 text-success border border-success/30 hover:bg-success/25 transition-colors"
              >
                <Check className="w-3 h-3 stroke-[3]" />
                <span>In Drive</span>
              </a>
            )}
          </div>
        </div>

        {/* Quick Top Actions: Play/Pause and More */}
        <div className="flex items-center gap-1.5 -mr-1 -mt-0.5 flex-shrink-0">
          {isPaused ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onResume();
              }}
              aria-label={`Resume ${torrent.name}`}
              title="Resume"
              className="w-8 h-8 rounded-lg bg-success/15 text-success border border-success/30 flex items-center justify-center active:scale-95 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPause();
              }}
              aria-label={`Pause ${torrent.name}`}
              title="Pause"
              className="w-8 h-8 rounded-lg bg-warning/15 text-warning border border-warning/30 flex items-center justify-center active:scale-95 transition-all"
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu();
            }}
            aria-label={`More actions for ${torrent.name}`}
            className="w-8 h-8 p-1.5 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary active:bg-glass-hover active:scale-95 transition-all"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div onClick={handleCardClick} className="mt-3 cursor-pointer">
        <ProgressBar value={torrent.progress} size="md" />
      </div>

      {/* Readable Meta Grid */}
      <div
        onClick={handleCardClick}
        className="mt-3 grid grid-cols-4 gap-2 sm:gap-3 p-3 rounded-xl bg-surface-elevated/80 border border-glass-border cursor-pointer text-left"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            Size
          </p>
          <p className="text-sm font-mono font-semibold text-text-primary mt-0.5 truncate">
            {formatBytes(torrent.total_size)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            Ratio
          </p>
          <p className="text-sm font-mono font-semibold text-text-primary mt-0.5">
            {ratio}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            Peers
          </p>
          <p className="text-sm font-mono font-semibold text-text-primary mt-0.5 whitespace-nowrap">
            <span
              className="text-success font-semibold"
              title={`Seeds: ${Math.max(torrent.num_seeds ?? 0, torrent.num_complete ?? 0)}`}
            >
              {Math.max(torrent.num_seeds ?? 0, torrent.num_complete ?? 0)}
            </span>
            <span className="text-text-muted font-normal mx-0.5">/</span>
            <span
              className="text-danger font-semibold"
              title={`Leechers: ${Math.max(torrent.num_leechs ?? 0, torrent.num_incomplete ?? 0)}`}
            >
              {Math.max(torrent.num_leechs ?? 0, torrent.num_incomplete ?? 0)}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            {isTorrentComplete(torrent) ? "Uploaded" : "ETA"}
          </p>
          <p className="text-sm font-mono font-semibold text-text-primary mt-0.5 truncate">
            {isTorrentComplete(torrent)
              ? formatBytes(torrent.uploaded)
              : torrent.eta > 0 && torrent.eta < 8640000
                ? formatEta(torrent.eta)
                : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function TorrentTable({
  torrents,
  filterKey = "all",
  isSelectMode = false,
  onEnterSelectMode,
  sortKey: controlledSortKey,
  sortDir: controlledSortDir,
  onSortChange,
}: TorrentTableProps) {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const selectedTorrents = useAppStore((s) => s.selectedTorrents);
  const toggleSelection = useAppStore((s) => s.toggleTorrentSelection);
  const selectAll = useAppStore((s) => s.selectAllTorrents);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const setDeleteConfirmHash = useAppStore((s) => s.setDeleteConfirmHash);
  const saveTorrentRatio = useAppStore((s) => s.saveTorrentRatio);
  const getTorrentRatio = useAppStore((s) => s.getTorrentRatio);
  const pauseMutation = usePauseTorrent();
  const resumeMutation = useResumeTorrent();
  const api = useApi();

  const getRatio = useCallback(
    (t: TorrentItem): string => {
      const cached = getTorrentRatio(t.hash, t.name);
      return calculateTorrentRatio(t, cached);
    },
    [getTorrentRatio]
  );

  useEffect(() => {
    if (!torrents || torrents.length === 0) return;
    for (const t of torrents) {
      const r =
        typeof t.ratio === "number" && !isNaN(t.ratio)
          ? t.ratio
          : parseFloat(getRatio(t));
      if (!isNaN(r) && r > 0) {
        saveTorrentRatio(t.hash, t.name, r);
      }
    }
  }, [torrents, saveTorrentRatio, getRatio]);

  const [internalSortKey, setInternalSortKey] = useState<SortKey>("added_on");
  const [internalSortDir, setInternalSortDir] = useState<SortDirection>("desc");

  const sortKey = controlledSortKey ?? internalSortKey;
  const sortDir = controlledSortDir ?? internalSortDir;

  const [page, setPage] = useState(1);
  const currentFilterSig = `${filterKey}::${searchQuery}`;
  const [prevFilterSig, setPrevFilterSig] = useState(currentFilterSig);
  if (prevFilterSig !== currentFilterSig) {
    setPrevFilterSig(currentFilterSig);
    setPage(1);
  }
  const [detailHash, setDetailHash] = useState<string | null>(null);
  const [mobileSheetTorrent, setMobileSheetTorrent] =
    useState<TorrentItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    hash: string;
  } | null>(null);

  const { data: driveAuth } = useDriveAuthStatus();
  const { data: driveUploads } = useDriveUploads();
  const completedDriveUploads = useAppStore((s) => s.completedDriveUploads);
  const markDriveUploadCompleted = useAppStore((s) => s.markDriveUploadCompleted);

  // Sync any completed uploads to store so badges persist
  useEffect(() => {
    if (!driveUploads || driveUploads.length === 0) return;
    for (const up of driveUploads) {
      if (up.status === "completed") {
        markDriveUploadCompleted({
          filename: up.filename,
          torrent_hash: up.torrent_hash,
          drive_file_id: up.drive_file_id,
        });
      }
    }
  }, [driveUploads, markDriveUploadCompleted]);

  const getDriveInfo = useCallback(
    (t: TorrentItem) => {
      const active = driveUploads?.find(
        (up) =>
          (up.status === "uploading" || up.status === "pending") &&
          (up.torrent_hash === t.hash ||
            up.filename === t.name ||
            (up.file_path &&
              (up.file_path.includes(t.hash) || up.file_path.endsWith(t.name))))
      );

      const completed =
        (t.hash && completedDriveUploads[t.hash]) ||
        (t.name && completedDriveUploads[t.name]) ||
        driveUploads?.find(
          (up) =>
            up.status === "completed" &&
            (up.torrent_hash === t.hash || up.filename === t.name)
        );

      return { active, completed };
    },
    [driveUploads, completedDriveUploads]
  );

  const [driveAuthModalOpen, setDriveAuthModalOpen] = useState(false);
  const [uploadDrivePath, setUploadDrivePath] = useState<string | null>(null);
  const [uploadTorrentHash, setUploadTorrentHash] = useState<string | null>(null);

  const handleUploadToDrive = (t: TorrentItem) => {
    if (!driveAuth?.authenticated) {
      toast("Silakan hubungkan Google Drive terlebih dahulu", { icon: "🔐" });
      setDriveAuthModalOpen(true);
      return;
    }
    const fullPath = t.content_path || (
      t.save_path.endsWith("/")
        ? `${t.save_path}${t.name}`
        : `${t.save_path}/${t.name}`
    );
    setUploadDrivePath(fullPath);
    setUploadTorrentHash(t.hash);
  };

  const filtered = useMemo(() => {
    let list = [...torrents];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) || t.hash.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      // 1. Download Priority: Torrents currently being downloaded are prioritized at the very top ONLY for default name sort
      if (sortKey === "name" && sortDir === "asc") {
        const tierA = getTorrentDownloadPriorityTier(a);
        const tierB = getTorrentDownloadPriorityTier(b);
        if (tierA !== tierB) {
          return tierA - tierB;
        }

        // Within active downloads (Tier 0), default to sorting by download speed descending
        if (tierA === 0 && b.download_speed !== a.download_speed) {
          return b.download_speed - a.download_speed;
        }
      }

      // 2. User-chosen sort column and direction
      if (sortKey === "added_on") {
        const aVal = a.added_on ?? 0;
        const bVal = b.added_on ?? 0;
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      if (sortKey === "download_speed") {
        return sortDir === "asc"
          ? a.download_speed - b.download_speed
          : b.download_speed - a.download_speed;
      }
      if (sortKey === "upload_speed") {
        return sortDir === "asc"
          ? a.upload_speed - b.upload_speed
          : b.upload_speed - a.upload_speed;
      }
      if (sortKey === "ratio") {
        const aRatio = parseFloat(getRatio(a)) || 0;
        const bRatio = parseFloat(getRatio(b)) || 0;
        return sortDir === "asc" ? aRatio - bRatio : bRatio - aRatio;
      }
      if (sortKey === "num_seeds") {
        const aSeeds = Math.max(a.num_seeds ?? 0, a.num_complete ?? 0);
        const bSeeds = Math.max(b.num_seeds ?? 0, b.num_complete ?? 0);
        return sortDir === "asc" ? aSeeds - bSeeds : bSeeds - aSeeds;
      }
      if (sortKey === "num_leechs") {
        const aLeechs = Math.max(a.num_leechs ?? 0, a.num_incomplete ?? 0);
        const bLeechs = Math.max(b.num_leechs ?? 0, b.num_incomplete ?? 0);
        return sortDir === "asc" ? aLeechs - bLeechs : bLeechs - aLeechs;
      }
      const aVal = a[sortKey as keyof TorrentItem];
      const bVal = b[sortKey as keyof TorrentItem];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === "asc"
        ? ((aVal as number) ?? 0) - ((bVal as number) ?? 0)
        : ((bVal as number) ?? 0) - ((aVal as number) ?? 0);
    });
    return list;
  }, [torrents, searchQuery, sortKey, sortDir, getRatio]);

  const pagination = useMemo(
    () => paginateItems(filtered, page, PAGE_SIZE),
    [filtered, page]
  );

  const visibleTorrents = pagination.items;
  const showPagination = filtered.length > PAGE_SIZE;

  const toggleSort = (key: SortKey) => {
    setPage(1);
    const nextDir =
      sortKey === key
        ? sortDir === "asc"
          ? "desc"
          : "asc"
        : key === "name"
          ? "asc"
          : "desc";

    if (onSortChange) {
      onSortChange(key, nextDir);
    } else {
      setInternalSortKey(key);
      setInternalSortDir(nextDir);
    }
  };

  const allVisibleSelected =
    visibleTorrents.length > 0 &&
    visibleTorrents.every((t) => selectedTorrents.has(t.hash));

  const selectionMode = selectedTorrents.size > 0;

  return (
    <>
      {/* MOBILE VIEW: Thumb-Friendly Card Layout */}
      <div className="md:hidden space-y-3">
        {visibleTorrents.map((t) => {
          const driveInfo = getDriveInfo(t);
          return (
            <MobileTorrentCard
              key={t.hash}
              torrent={t}
              ratio={getRatio(t)}
              activeDriveUpload={driveInfo.active}
              completedDriveUpload={driveInfo.completed}
              isSelected={selectedTorrents.has(t.hash)}
              isSelectMode={isSelectMode}
              onEnterSelectMode={onEnterSelectMode}
              onToggleSelect={() => toggleSelection(t.hash)}
              onOpenDetail={() => setDetailHash(t.hash)}
              onPause={() => pauseMutation.mutate(t.hash)}
              onResume={() => resumeMutation.mutate(t.hash)}
              onOpenMenu={() => setMobileSheetTorrent(t)}
            />
          );
        })}

        {filtered.length === 0 && (
          <div className="glass rounded-2xl p-10 text-center">
            <Download className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-30" />
            <p className="text-base font-medium text-text-secondary">
              No torrents found
            </p>
            <p className="text-sm text-text-muted mt-1">
              Add a torrent to get started
            </p>
          </div>
        )}
      </div>

      {/* DESKTOP VIEW: Data Table */}
      <div className="hidden md:block glass rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-glass-border text-text-muted text-xs uppercase tracking-wider">
                {isSelectMode && (
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() =>
                        allVisibleSelected
                          ? clearSelection()
                          : selectAll(visibleTorrents.map((t) => t.hash))
                      }
                      className="rounded border-glass-border bg-surface-elevated accent-accent cursor-pointer"
                    />
                  </th>
                )}
                <th
                  className="px-4 py-3 text-left cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => toggleSort("name")}
                >
                  <div className="flex items-center gap-1">
                    Name{" "}
                    <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                  </div>
                </th>
                <th className="px-4 py-3 text-left w-28">Status</th>
                <th
                  className="px-4 py-3 text-left w-44 cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => toggleSort("progress")}
                >
                  <div className="flex items-center gap-1">
                    Progress{" "}
                    <SortIcon
                      col="progress"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right w-24 cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => toggleSort("total_size")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Size{" "}
                    <SortIcon
                      col="total_size"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right w-20 cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => toggleSort("ratio")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Ratio{" "}
                    <SortIcon
                      col="ratio"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right w-24 cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => toggleSort("num_seeds")}
                >
                  <div className="flex items-center justify-end gap-1">
                    <Users className="w-3 h-3" /> Peers{" "}
                    <SortIcon
                      col="num_seeds"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right w-28 cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => toggleSort("download_speed")}
                >
                  <div className="flex items-center justify-end gap-1">
                    <Download className="w-3 h-3" /> Speed{" "}
                    <SortIcon
                      col="download_speed"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </div>
                </th>
                <th
                  className="px-4 py-3 text-right w-28 cursor-pointer hover:text-text-primary transition-colors"
                  onClick={() => toggleSort("upload_speed")}
                >
                  <div className="flex items-center justify-end gap-1">
                    <Upload className="w-3 h-3" /> Speed{" "}
                    <SortIcon
                      col="upload_speed"
                      sortKey={sortKey}
                      sortDir={sortDir}
                    />
                  </div>
                </th>
                <th className="px-4 py-3 text-right w-20">ETA</th>
                <th className="px-4 py-3 w-28 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTorrents.map((t) => {
                const driveInfo = getDriveInfo(t);
                const isDownloading = isTorrentDownloading(t);
                return (
                  <tr
                    key={t.hash}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, hash: t.hash });
                    }}
                    className={cn(
                      "border-b border-glass-border/50 transition-colors",
                      isDownloading && "bg-accent/[0.04]",
                      selectedTorrents.has(t.hash)
                        ? "bg-accent/5"
                        : "hover:bg-glass-hover/30"
                    )}
                  >
                    {isSelectMode && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedTorrents.has(t.hash)}
                          onChange={() => toggleSelection(t.hash)}
                          className="rounded border-glass-border bg-surface-elevated accent-accent cursor-pointer"
                        />
                      </td>
                    )}
                    <td
                      className="px-4 py-3 cursor-pointer"
                      onClick={() => {
                        if (isSelectMode) {
                          toggleSelection(t.hash);
                        } else {
                          setDetailHash(t.hash);
                        }
                      }}
                    >
                      <div className="max-w-xs">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-text-primary truncate hover:text-accent transition-colors">
                            {t.name}
                          </p>
                          {driveInfo.active && (
                            <Badge
                              variant="accent"
                              className="gap-1 animate-pulse font-mono text-[10px] py-0 px-1.5 flex-shrink-0"
                            >
                              <UploadCloud className="w-3 h-3 animate-spin" />
                              <span>Drive {Math.round(driveInfo.active.progress_percent)}%</span>
                            </Badge>
                          )}
                          {!driveInfo.active && driveInfo.completed && (
                            <a
                              href={
                                driveInfo.completed.drive_file_id
                                  ? `https://drive.google.com/open?id=${driveInfo.completed.drive_file_id}`
                                  : `https://drive.google.com/drive/search?q=${encodeURIComponent(t.name)}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Uploaded to Google Drive - Click to open"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-success/15 text-success border border-success/30 hover:bg-success/25 transition-colors flex-shrink-0"
                            >
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                              <span>In Drive</span>
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-text-muted font-mono truncate mt-0.5">
                          {t.hash.substring(0, 12)}...
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={getBadgeVariant(t.state)}
                        title={getTorrentStateTooltip(t.state, t.progress, t.upload_speed)}
                      >
                        {getTorrentStateLabel(t.state, t.progress, t.upload_speed)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <ProgressBar value={t.progress} showLabel size="sm" />
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary font-mono text-xs">
                      {formatBytes(t.total_size)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      <span
                        className={cn(
                          "font-semibold",
                          parseFloat(getRatio(t)) >= 1.0
                            ? "text-success"
                            : "text-text-secondary"
                        )}
                      >
                        {getRatio(t)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                      <span
                        className="text-success font-semibold"
                        title={`Seeds: ${Math.max(t.num_seeds ?? 0, t.num_complete ?? 0)}`}
                      >
                        {Math.max(t.num_seeds ?? 0, t.num_complete ?? 0)}
                        <span className="text-[10px] text-text-muted ml-0.5 font-normal">S</span>
                      </span>
                      <span className="text-text-muted mx-1.5 font-normal">·</span>
                      <span
                        className="text-danger font-semibold"
                        title={`Leechers: ${Math.max(t.num_leechs ?? 0, t.num_incomplete ?? 0)}`}
                      >
                        {Math.max(t.num_leechs ?? 0, t.num_incomplete ?? 0)}
                        <span className="text-[10px] text-text-muted ml-0.5 font-normal">L</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-accent font-mono text-xs">
                        {t.download_speed > 0
                          ? formatSpeed(t.download_speed)
                          : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-success font-mono text-xs">
                        {t.upload_speed > 0 ? formatSpeed(t.upload_speed) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary font-mono text-xs">
                      {isTorrentComplete(t)
                        ? "—"
                        : t.eta > 0 && t.eta < 8640000
                          ? formatEta(t.eta)
                          : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailHash(t.hash)}
                          className="p-1.5 rounded-lg hover:bg-info/10 text-text-muted hover:text-info transition-colors"
                          title="Details"
                        >
                          <Info className="w-4 h-4" />
                        </button>
                        {t.state.includes("paused") ? (
                          <button
                            type="button"
                            onClick={() => resumeMutation.mutate(t.hash)}
                            className="p-1.5 rounded-lg hover:bg-success/10 text-text-muted hover:text-success transition-colors"
                            title="Resume"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => pauseMutation.mutate(t.hash)}
                            className="p-1.5 rounded-lg hover:bg-warning/10 text-text-muted hover:text-warning transition-colors"
                            title="Pause"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmHash(t.hash)}
                          className="p-1.5 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {api && (
                          <a
                            href={api.getExportUrl(t.hash)}
                            download
                            className="p-1.5 rounded-lg hover:bg-accent/10 text-text-muted hover:text-accent transition-colors"
                            title="Download .torrent"
                          >
                            <FileDown className="w-4 h-4" />
                          </a>
                        )}
                        {driveInfo.active ? (
                          <button
                            type="button"
                            disabled
                            className="p-1.5 rounded-lg text-accent transition-colors cursor-not-allowed opacity-80"
                            title={`Uploading to Drive (${Math.round(driveInfo.active.progress_percent)}%)`}
                          >
                            <UploadCloud className="w-4 h-4 animate-spin" />
                          </button>
                        ) : driveInfo.completed ? (
                          <a
                            href={
                              driveInfo.completed.drive_file_id
                                ? `https://drive.google.com/open?id=${driveInfo.completed.drive_file_id}`
                                : `https://drive.google.com/drive/search?q=${encodeURIComponent(t.name)}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg hover:bg-success/10 text-success transition-colors"
                            title="Already uploaded to Google Drive - Click to open"
                          >
                            <Check className="w-4 h-4 stroke-[2.5]" />
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleUploadToDrive(t)}
                            className="p-1.5 rounded-lg hover:bg-accent/10 text-text-muted hover:text-accent transition-colors"
                            title="Upload to Google Drive"
                          >
                            <UploadCloud className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isSelectMode ? 10 : 9} className="px-4 py-12 text-center">
                    <div className="text-text-muted">
                      <Download className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="text-base font-medium">No torrents found</p>
                      <p className="text-sm mt-1">
                        Add a torrent to get started
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Desktop Context menu */}
        {contextMenu && (
          <>
            <div
              className="fixed inset-0 z-50"
              onClick={() => setContextMenu(null)}
            />
            <div
              className="fixed z-50 glass rounded-xl shadow-2xl border border-glass-border py-1 min-w-[180px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                type="button"
                onClick={() => {
                  setDetailHash(contextMenu.hash);
                  setContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors"
              >
                <Info className="w-4 h-4" /> Details
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!isSelectMode) {
                    onEnterSelectMode?.();
                  }
                  toggleSelection(contextMenu.hash);
                  setContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors"
              >
                <Check className="w-4 h-4 text-accent" />
                {selectedTorrents.has(contextMenu.hash) ? "Deselect" : "Select"}
              </button>
              <button
                type="button"
                onClick={() => {
                  resumeMutation.mutate(contextMenu.hash);
                  setContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors"
              >
                <Play className="w-4 h-4" /> Resume
              </button>
              <button
                type="button"
                onClick={() => {
                  pauseMutation.mutate(contextMenu.hash);
                  setContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors"
              >
                <Pause className="w-4 h-4" /> Pause
              </button>
              {(() => {
                const target = torrents.find((t) => t.hash === contextMenu.hash);
                const driveInfo = target ? getDriveInfo(target) : null;
                if (driveInfo?.active) {
                  return (
                    <button
                      type="button"
                      disabled
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-muted cursor-not-allowed opacity-80"
                    >
                      <UploadCloud className="w-4 h-4 text-accent animate-spin" />
                      Uploading ({Math.round(driveInfo.active.progress_percent)}%)
                    </button>
                  );
                }
                if (driveInfo?.completed) {
                  return (
                    <>
                      <a
                        href={
                          driveInfo.completed.drive_file_id
                            ? `https://drive.google.com/open?id=${driveInfo.completed.drive_file_id}`
                            : `https://drive.google.com/drive/search?q=${encodeURIComponent(target!.name)}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setContextMenu(null)}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-success hover:bg-success/10 transition-colors"
                      >
                        <Check className="w-4 h-4 text-success stroke-[2.5]" /> Open in Drive
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setContextMenu(null);
                          if (target) handleUploadToDrive(target);
                        }}
                        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors"
                      >
                        <UploadCloud className="w-4 h-4 text-accent" /> Re-upload to Drive
                      </button>
                    </>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setContextMenu(null);
                      if (target) handleUploadToDrive(target);
                    }}
                    className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors"
                  >
                    <UploadCloud className="w-4 h-4 text-accent" /> Upload to Drive
                  </button>
                );
              })()}
              <hr className="border-glass-border my-1" />
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmHash(contextMenu.hash);
                  setContextMenu(null);
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-danger hover:bg-danger/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </>
        )}
      </div>

      {/* Pagination Bar (Shown automatically when torrents > 10) */}
      {showPagination && (
        <div className="glass rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-xs sm:text-sm text-text-secondary font-mono">
            {pagination.startIndex}–{pagination.endIndex} of {filtered.length}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(pagination.currentPage - 1)}
              disabled={pagination.currentPage <= 1}
              aria-label="Previous page"
              className="min-w-[44px] min-h-[44px] md:min-w-[36px] md:min-h-[36px] px-2.5 rounded-xl bg-surface-elevated border border-glass-border text-text-primary flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-glass-hover transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline text-xs font-medium">Prev</span>
            </button>

            <span className="text-xs sm:text-sm font-mono font-semibold text-text-primary px-2">
              {pagination.currentPage} / {pagination.totalPages}
            </span>

            <button
              type="button"
              onClick={() => setPage(pagination.currentPage + 1)}
              disabled={pagination.currentPage >= pagination.totalPages}
              aria-label="Next page"
              className="min-w-[44px] min-h-[44px] md:min-w-[36px] md:min-h-[36px] px-2.5 rounded-xl bg-surface-elevated border border-glass-border text-text-primary flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-glass-hover transition-colors"
            >
              <span className="hidden sm:inline text-xs font-medium">Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Mobile Bottom Action Sheet (Safe Thumb-Friendly Secondary Actions) */}
      {mobileSheetTorrent && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileSheetTorrent(null)}
          />
          <div
            className="relative w-full bg-surface-overlay border-t border-glass-border rounded-t-3xl p-4 space-y-2 z-10 shadow-2xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
          >
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-glass-border">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">
                  {mobileSheetTorrent.name}
                </p>
                <p className="text-xs text-text-muted font-mono">
                  {mobileSheetTorrent.hash.substring(0, 16)}...
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileSheetTorrent(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-text-secondary hover:bg-glass-hover"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setDetailHash(mobileSheetTorrent.hash);
                setMobileSheetTorrent(null);
              }}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover"
            >
              <Info className="w-5 h-5 text-info" />
              View Torrent Details
            </button>

            {mobileSheetTorrent.state.includes("paused") ? (
              <button
                type="button"
                onClick={() => {
                  resumeMutation.mutate(mobileSheetTorrent.hash);
                  setMobileSheetTorrent(null);
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-success hover:bg-success/10"
              >
                <Play className="w-5 h-5 fill-current" />
                Resume Torrent
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  pauseMutation.mutate(mobileSheetTorrent.hash);
                  setMobileSheetTorrent(null);
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-warning hover:bg-warning/10"
              >
                <Pause className="w-5 h-5 fill-current" />
                Pause Torrent
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (!isSelectMode) {
                  onEnterSelectMode?.();
                }
                toggleSelection(mobileSheetTorrent.hash);
                setMobileSheetTorrent(null);
              }}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover"
            >
              <Check className="w-5 h-5 text-accent" />
              {selectedTorrents.has(mobileSheetTorrent.hash)
                ? "Remove from Batch Selection"
                : "Select for Batch Operation"}
            </button>

            {api && (
              <a
                href={api.getExportUrl(mobileSheetTorrent.hash)}
                download
                onClick={() => setMobileSheetTorrent(null)}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover"
              >
                <FileDown className="w-5 h-5 text-accent" />
                Download .torrent File
              </a>
            )}

            {(() => {
              const driveInfo = getDriveInfo(mobileSheetTorrent);
              if (driveInfo.active) {
                return (
                  <button
                    type="button"
                    disabled
                    className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-muted cursor-not-allowed opacity-80"
                  >
                    <UploadCloud className="w-5 h-5 text-accent animate-spin" />
                    Uploading to Drive ({Math.round(driveInfo.active.progress_percent)}%)
                  </button>
                );
              }
              if (driveInfo.completed) {
                return (
                  <>
                    <a
                      href={
                        driveInfo.completed.drive_file_id
                          ? `https://drive.google.com/open?id=${driveInfo.completed.drive_file_id}`
                          : `https://drive.google.com/drive/search?q=${encodeURIComponent(mobileSheetTorrent.name)}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMobileSheetTorrent(null)}
                      className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-success hover:bg-success/10"
                    >
                      <Check className="w-5 h-5 text-success stroke-[2.5]" />
                      Open in Google Drive
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        const t = mobileSheetTorrent;
                        setMobileSheetTorrent(null);
                        handleUploadToDrive(t);
                      }}
                      className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover"
                    >
                      <UploadCloud className="w-5 h-5 text-accent" />
                      Re-upload to Google Drive
                    </button>
                  </>
                );
              }
              return (
                <button
                  type="button"
                  onClick={() => {
                    const t = mobileSheetTorrent;
                    setMobileSheetTorrent(null);
                    handleUploadToDrive(t);
                  }}
                  className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover"
                >
                  <UploadCloud className="w-5 h-5 text-accent" />
                  Upload to Google Drive
                </button>
              );
            })()}

            <div className="pt-2 border-t border-glass-border">
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmHash(mobileSheetTorrent.hash);
                  setMobileSheetTorrent(null);
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-danger bg-danger/10 hover:bg-danger/20"
              >
                <Trash2 className="w-5 h-5" />
                Delete Torrent
              </button>
            </div>
          </div>
        </div>
      )}

      <TorrentDetailModal
        hash={detailHash}
        onClose={() => setDetailHash(null)}
      />

      <DriveAuthModal
        open={driveAuthModalOpen}
        onClose={() => setDriveAuthModalOpen(false)}
      />

      {uploadDrivePath && (
        <UploadToDriveModal
          open={!!uploadDrivePath}
          onClose={() => {
            setUploadDrivePath(null);
            setUploadTorrentHash(null);
          }}
          filePath={uploadDrivePath}
          torrentHash={uploadTorrentHash || undefined}
        />
      )}
    </>
  );
}
