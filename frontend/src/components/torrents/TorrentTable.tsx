import { useState, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  getTorrentStateLabel,
  paginateItems,
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
} from "lucide-react";
import type { TorrentItem, SortDirection } from "@/types";
import { TorrentDetailModal } from "./TorrentDetailModal";
import { useDriveAuthStatus } from "@/hooks/useDrive";
import { DriveAuthModal, UploadToDriveModal } from "@/components/drive";
import toast from "react-hot-toast";

const PAGE_SIZE = 10;

interface TorrentTableProps {
  torrents: TorrentItem[];
  filterKey?: string;
}

type SortKey = keyof TorrentItem;

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
  if (state.includes("UP") || state === "uploading") return "success" as const;
  if (state === "downloading" || state === "forcedDL") return "accent" as const;
  if (state.includes("paused")) return "default" as const;
  if (state === "error" || state === "missingFiles") return "danger" as const;
  if (state.includes("stalled")) return "warning" as const;
  return "info" as const;
}

function calculateRatio(t: TorrentItem): string {
  if (t.downloaded <= 0) return t.uploaded > 0 ? "∞" : "0.00";
  return (t.uploaded / t.downloaded).toFixed(2);
}

interface MobileTorrentCardProps {
  torrent: TorrentItem;
  isSelected: boolean;
  selectionMode: boolean;
  onToggleSelect: () => void;
  onOpenDetail: () => void;
  onPause: () => void;
  onResume: () => void;
  onOpenMenu: () => void;
}

function MobileTorrentCard({
  torrent,
  isSelected,
  selectionMode,
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
    if (selectionMode) {
      onToggleSelect();
    } else {
      onOpenDetail();
    }
  };

  const isPaused = torrent.state.includes("paused");

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEndOrMove}
      onTouchMove={handleTouchEndOrMove}
      className={cn(
        "glass rounded-2xl p-4 transition-all select-none",
        isSelected
          ? "border-accent bg-accent/10 ring-1 ring-accent/40"
          : "border-glass-border"
      )}
    >
      {/* Top Row: Large 44x44 Checkbox + Title + More Button (44x44) */}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-label={`Select ${torrent.name}`}
          className="min-w-[44px] min-h-[44px] -ml-2 -mt-1 flex items-center justify-center rounded-xl active:bg-glass-hover flex-shrink-0"
        >
          <span
            className={cn(
              "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors",
              isSelected
                ? "bg-accent border-accent text-white"
                : "border-text-muted/50 bg-surface-elevated"
            )}
          >
            {isSelected && <Check className="w-4 h-4 stroke-[3]" />}
          </span>
        </button>

        <div
          onClick={handleCardClick}
          className="flex-1 min-w-0 pt-0.5 cursor-pointer"
        >
          <h3 className="text-[15px] font-semibold text-text-primary leading-snug line-clamp-2 break-words">
            {torrent.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant={getBadgeVariant(torrent.state)}>
              {getTorrentStateLabel(torrent.state)}
            </Badge>
            <span className="text-xs font-mono font-semibold text-text-primary">
              {torrent.progress.toFixed(1)}%
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu();
          }}
          aria-label={`More actions for ${torrent.name}`}
          className="min-w-[44px] min-h-[44px] -mr-2 -mt-1 flex items-center justify-center rounded-xl text-text-secondary hover:text-text-primary active:bg-glass-hover flex-shrink-0"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
      </div>

      {/* Progress Bar */}
      <div onClick={handleCardClick} className="mt-3 cursor-pointer">
        <ProgressBar value={torrent.progress} size="md" />
      </div>

      {/* Readable Meta Grid */}
      <div
        onClick={handleCardClick}
        className="mt-3 grid grid-cols-3 gap-3 p-3 rounded-xl bg-surface-elevated/80 border border-glass-border cursor-pointer"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            Size
          </p>
          <p className="text-sm font-mono font-semibold text-text-primary mt-0.5">
            {formatBytes(torrent.total_size)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            Ratio
          </p>
          <p className="text-sm font-mono font-semibold text-text-primary mt-0.5">
            {calculateRatio(torrent)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            ETA
          </p>
          <p className="text-sm font-mono font-semibold text-text-primary mt-0.5">
            {torrent.eta > 0 && torrent.eta < 8640000
              ? formatEta(torrent.eta)
              : "∞"}
          </p>
        </div>
      </div>

      {/* Bottom Speed & Compact Icon-Only 44x44 Play/Pause Button */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-mono min-w-0">
          <span className="flex items-center gap-1 text-accent font-semibold whitespace-nowrap">
            <Download className="w-4 h-4 flex-shrink-0" />
            {torrent.download_speed > 0
              ? formatSpeed(torrent.download_speed)
              : "0 B/s"}
          </span>
          <span className="flex items-center gap-1 text-success font-semibold whitespace-nowrap">
            <Upload className="w-4 h-4 flex-shrink-0" />
            {torrent.upload_speed > 0
              ? formatSpeed(torrent.upload_speed)
              : "0 B/s"}
          </span>
        </div>

        <div className="flex-shrink-0">
          {isPaused ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onResume();
              }}
              aria-label={`Resume ${torrent.name}`}
              title="Resume"
              className="w-11 h-11 rounded-xl bg-success/15 text-success border border-success/30 flex items-center justify-center active:scale-95 transition-transform"
            >
              <Play className="w-5 h-5" />
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
              className="w-11 h-11 rounded-xl bg-warning/15 text-warning border border-warning/30 flex items-center justify-center active:scale-95 transition-transform"
            >
              <Pause className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TorrentTable({ torrents, filterKey = "all" }: TorrentTableProps) {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const selectedTorrents = useAppStore((s) => s.selectedTorrents);
  const toggleSelection = useAppStore((s) => s.toggleTorrentSelection);
  const selectAll = useAppStore((s) => s.selectAllTorrents);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const setDeleteConfirmHash = useAppStore((s) => s.setDeleteConfirmHash);
  const pauseMutation = usePauseTorrent();
  const resumeMutation = useResumeTorrent();
  const api = useApi();

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
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
  const [driveAuthModalOpen, setDriveAuthModalOpen] = useState(false);
  const [uploadDrivePath, setUploadDrivePath] = useState<string | null>(null);

  const handleUploadToDrive = (t: TorrentItem) => {
    if (!driveAuth?.authenticated) {
      toast("Silakan hubungkan Google Drive terlebih dahulu", { icon: "🔐" });
      setDriveAuthModalOpen(true);
      return;
    }
    const fullPath = t.save_path.endsWith("/")
      ? `${t.save_path}${t.name}`
      : `${t.save_path}/${t.name}`;
    setUploadDrivePath(fullPath);
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
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    return list;
  }, [torrents, searchQuery, sortKey, sortDir]);

  const pagination = useMemo(
    () => paginateItems(filtered, page, PAGE_SIZE),
    [filtered, page]
  );

  const visibleTorrents = pagination.items;
  const showPagination = filtered.length > PAGE_SIZE;

  const toggleSort = (key: SortKey) => {
    setPage(1);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
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
        {visibleTorrents.length > 0 && (
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() =>
                allVisibleSelected
                  ? clearSelection()
                  : selectAll(visibleTorrents.map((t) => t.hash))
              }
              className="h-10 px-3 rounded-xl glass text-xs font-medium text-text-secondary flex items-center gap-2 active:bg-glass-hover"
            >
              <span
                className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center",
                  allVisibleSelected
                    ? "bg-accent border-accent text-white"
                    : "border-text-muted/60"
                )}
              >
                {allVisibleSelected && <Check className="w-3 h-3 stroke-[3]" />}
              </span>
              {allVisibleSelected
                ? "Deselect All"
                : `Select Page (${visibleTorrents.length})`}
            </button>
            <span className="text-xs text-text-muted">
              Long-press to multi-select
            </span>
          </div>
        )}

        {visibleTorrents.map((t) => (
          <MobileTorrentCard
            key={t.hash}
            torrent={t}
            isSelected={selectedTorrents.has(t.hash)}
            selectionMode={selectionMode}
            onToggleSelect={() => toggleSelection(t.hash)}
            onOpenDetail={() => setDetailHash(t.hash)}
            onPause={() => pauseMutation.mutate(t.hash)}
            onResume={() => resumeMutation.mutate(t.hash)}
            onOpenMenu={() => setMobileSheetTorrent(t)}
          />
        ))}

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
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() =>
                      allVisibleSelected
                        ? clearSelection()
                        : selectAll(visibleTorrents.map((t) => t.hash))
                    }
                    className="rounded border-glass-border bg-surface-elevated accent-accent"
                  />
                </th>
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
                <th className="px-4 py-3 text-right w-28">
                  <div className="flex items-center justify-end gap-1">
                    <Download className="w-3 h-3" /> Speed
                  </div>
                </th>
                <th className="px-4 py-3 text-right w-28">
                  <div className="flex items-center justify-end gap-1">
                    <Upload className="w-3 h-3" /> Speed
                  </div>
                </th>
                <th className="px-4 py-3 text-right w-20">ETA</th>
                <th className="px-4 py-3 w-28 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTorrents.map((t) => (
                <tr
                  key={t.hash}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, hash: t.hash });
                  }}
                  className={cn(
                    "border-b border-glass-border/50 transition-colors",
                    selectedTorrents.has(t.hash)
                      ? "bg-accent/5"
                      : "hover:bg-glass-hover/30"
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedTorrents.has(t.hash)}
                      onChange={() => toggleSelection(t.hash)}
                      className="rounded border-glass-border bg-surface-elevated accent-accent"
                    />
                  </td>
                  <td
                    className="px-4 py-3 cursor-pointer"
                    onClick={() => setDetailHash(t.hash)}
                  >
                    <div className="max-w-xs">
                      <p className="font-medium text-text-primary truncate hover:text-accent transition-colors">
                        {t.name}
                      </p>
                      <p className="text-xs text-text-muted font-mono truncate mt-0.5">
                        {t.hash.substring(0, 12)}...
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={getBadgeVariant(t.state)}>
                      {getTorrentStateLabel(t.state)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <ProgressBar value={t.progress} showLabel size="sm" />
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary font-mono text-xs">
                    {formatBytes(t.total_size)}
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
                    {t.eta > 0 && t.eta < 8640000 ? formatEta(t.eta) : "—"}
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
                      <button
                        type="button"
                        onClick={() => handleUploadToDrive(t)}
                        className="p-1.5 rounded-lg hover:bg-accent/10 text-text-muted hover:text-accent transition-colors"
                        title="Upload to Google Drive"
                      >
                        <UploadCloud className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
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
              <button
                type="button"
                onClick={() => {
                  const target = torrents.find((t) => t.hash === contextMenu.hash);
                  setContextMenu(null);
                  if (target) handleUploadToDrive(target);
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary transition-colors"
              >
                <UploadCloud className="w-4 h-4 text-accent" /> Upload to Drive
              </button>
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

            <button
              type="button"
              onClick={() => {
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
          onClose={() => setUploadDrivePath(null)}
          filePath={uploadDrivePath}
        />
      )}
    </>
  );
}
