import { useState, useMemo, useEffect } from "react";
import {
  useTorrents,
  useLocalFiles,
  useDeleteLocalFile,
  useRenameLocalFile,
  useApi,
  useActiveInstance,
} from "@/hooks/useTorrents";
import { useQueryClient } from "@tanstack/react-query";
import { formatBytes } from "@/lib/utils";
import {
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  Search,
  HardDrive,
  Copy,
  Trash2,
  MoreVertical,
  RefreshCw,
  X,
  UploadCloud,
  HardDriveDownload,
  Radio,
  Pencil,
  ArrowUpCircle,
  ArrowDownCircle,
  CloudDownload,
  Loader2,
  CheckSquare,
  AlertTriangle,
} from "lucide-react";
import { ListSkeleton, Skeleton, Modal, Input } from "@/components/ui";
import { useAppStore } from "@/stores/appStore";
import { useDriveAuthStatus, useDriveDownloads } from "@/hooks/useDrive";
import {
  DriveAuthModal,
  UploadToDriveModal,
  BatchUploadToDriveModal,
  ActiveDriveDownloads,
} from "@/components/drive";
import toast from "react-hot-toast";
import type { TorrentItem, DriveDownloadProgress, LocalFileItem } from "@/types";

export interface LocalFileEntry {
  name: string;
  path: string;
  size: number;
  modified?: number;
  torrentHash?: string;
  torrent?: TorrentItem;
  isDriveCompleted?: boolean;
}

export interface FolderNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children: FolderNode[];
  torrents: TorrentItem[];
  localFiles: LocalFileEntry[];
  activeDownloads?: DriveDownloadProgress[];
}

export type StatusFilter = "all" | "seeding" | "unseeded";
export type SortOption = "name" | "size" | "date";

function buildFileTree(
  torrents: TorrentItem[],
  localFiles: LocalFileItem[],
  driveDownloads: DriveDownloadProgress[]
): FolderNode {
  const root: FolderNode = {
    name: "/",
    path: "/",
    isDirectory: true,
    size: 0,
    children: [],
    torrents: [],
    localFiles: [],
    activeDownloads: [],
  };

  const getOrCreatePathNode = (rawPath: string) => {
    const normalized = rawPath.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    let current = root;
    let currentPath = "";

    for (const part of parts) {
      currentPath += "/" + part;
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          isDirectory: true,
          size: 0,
          children: [],
          torrents: [],
          localFiles: [],
          activeDownloads: [],
        };
        current.children.push(child);
      }
      current = child;
    }
    return current;
  };

  const addFolderSize = (rawPath: string, sizeToAdd: number) => {
    if (!sizeToAdd) return;
    const parts = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
    let current = root;
    root.size += sizeToAdd;
    for (const part of parts) {
      const child = current.children.find((c) => c.name === part);
      if (child) {
        child.size += sizeToAdd;
        current = child;
      }
    }
  };

  // 1. Files from server local disk (including completed Drive downloads on disk)
  for (const f of localFiles) {
    if (f.is_directory) {
      getOrCreatePathNode(f.path);
    } else {
      const targetFolder = getOrCreatePathNode(f.parent_path);
      const matchingTorrent = torrents.find(
        (t) =>
          (f.torrent_hash && t.hash === f.torrent_hash) ||
          t.name.toLowerCase() === f.name.toLowerCase() ||
          (t.content_path && t.content_path.toLowerCase() === f.path.toLowerCase())
      );
      targetFolder.localFiles.push({
        name: f.name,
        path: f.path,
        size: f.size,
        modified: f.modified,
        torrentHash: f.torrent_hash || matchingTorrent?.hash,
        torrent: matchingTorrent,
      });
      addFolderSize(f.parent_path, f.size);
    }
  }

  // 2. Torrents from qBittorrent (merge with local files or add if standalone)
  for (const t of torrents) {
    const targetNode = getOrCreatePathNode(t.save_path);
    const existing = targetNode.localFiles.find(
      (f) =>
        f.name.toLowerCase() === t.name.toLowerCase() ||
        f.torrentHash === t.hash ||
        (f.torrent && f.torrent.hash === t.hash)
    );
    if (existing) {
      existing.torrent = t;
      existing.torrentHash = t.hash;
    } else {
      targetNode.localFiles.push({
        name: t.name,
        path: t.content_path || `${t.save_path.replace(/[/\\]+$/, "")}/${t.name}`,
        size: t.total_size,
        torrentHash: t.hash,
        torrent: t,
      });
      addFolderSize(t.save_path, t.total_size);
    }
  }

  // 3. Google Drive downloads (active & completed)
  for (const d of driveDownloads) {
    const dest = d.destination_path || "/downloads";
    const targetFolder = getOrCreatePathNode(dest);

    if (d.status === "downloading" || d.status === "pending") {
      if (!targetFolder.activeDownloads) targetFolder.activeDownloads = [];
      targetFolder.activeDownloads.push(d);
    } else if (d.status === "completed") {
      const existing = targetFolder.localFiles.find(
        (f) => f.name.toLowerCase() === d.filename.toLowerCase()
      );
      if (existing) {
        existing.isDriveCompleted = true;
      } else {
        const fullPath = `${dest.replace(/[/\\]+$/, "")}/${d.filename}`;
        targetFolder.localFiles.push({
          name: d.filename,
          path: fullPath,
          size: d.total_bytes || 0,
          isDriveCompleted: true,
        });
        addFolderSize(dest, d.total_bytes || 0);
      }
    }
  }

  return root;
}

function filterAndSortTree(
  node: FolderNode,
  status: StatusFilter,
  sortBy: SortOption
): FolderNode | null {
  // 1. Filter local files
  let filteredLocalFiles = node.localFiles.filter((file) => {
    const isSeeding = file.torrent && file.torrent.progress >= 100;
    if (status === "seeding") {
      return isSeeding;
    }
    if (status === "unseeded") {
      return !isSeeding;
    }
    return true;
  });

  // 2. Sort local files
  filteredLocalFiles.sort((a, b) => {
    if (sortBy === "size") {
      return b.size - a.size;
    }
    if (sortBy === "date") {
      return (b.modified || 0) - (a.modified || 0);
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  // 3. Filter and sort children folders recursively
  const filteredChildren: FolderNode[] = [];
  for (const child of node.children) {
    const filteredChild = filterAndSortTree(child, status, sortBy);
    if (filteredChild) {
      filteredChildren.push(filteredChild);
    }
  }

  // Sort children folders
  filteredChildren.sort((a, b) => {
    if (sortBy === "size") {
      return b.size - a.size;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  // Active downloads (only show if status is "all" or "unseeded")
  const filteredDownloads = status === "seeding" ? [] : node.activeDownloads || [];

  const hasContent =
    filteredChildren.length > 0 ||
    filteredLocalFiles.length > 0 ||
    filteredDownloads.length > 0;

  // Root "/" always kept, subfolders kept only if they have matching items
  if (!hasContent && node.path !== "/") {
    return null;
  }

  const totalSize =
    filteredLocalFiles.reduce((acc, f) => acc + (f.size || 0), 0) +
    filteredChildren.reduce((acc, c) => acc + (c.size || 0), 0) +
    filteredDownloads.reduce((acc, d) => acc + (d.total_bytes || 0), 0);

  return {
    ...node,
    size: totalSize,
    children: filteredChildren,
    localFiles: filteredLocalFiles,
    activeDownloads: filteredDownloads,
  };
}

function collectAllFiles(node: FolderNode | null): LocalFileEntry[] {
  if (!node) return [];
  const list: LocalFileEntry[] = [...node.localFiles];
  for (const child of node.children) {
    list.push(...collectAllFiles(child));
  }
  return list;
}

interface ActionTarget {
  type: "folder" | "torrent" | "file";
  title: string;
  savePath: string;
  torrentHash?: string;
}

interface RenameFileModalProps {
  open: boolean;
  onClose: () => void;
  target: { path: string; name: string } | null;
}

function RenameFileModal({ open, onClose, target }: RenameFileModalProps) {
  const [newName, setNewName] = useState("");
  const renameMutation = useRenameLocalFile();

  useEffect(() => {
    if (target) {
      setNewName(target.name);
    }
  }, [target]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !newName.trim() || newName.trim() === target.name) {
      onClose();
      return;
    }
    renameMutation.mutate(
      { path: target.path, newName: newName.trim() },
      {
        onSuccess: () => {
          onClose();
        },
      }
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Rename File / Folder" size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wider text-text-muted font-semibold block mb-1.5">
            New Name
          </label>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Enter new name..."
            autoFocus
          />
          <p className="text-xs text-text-muted font-mono mt-1.5 truncate" title={target?.path}>
            Location: {target?.path}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={renameMutation.isPending || !newName.trim() || newName.trim() === target?.name}
            className="min-h-[42px] px-5 flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-all shadow-md shadow-accent/25"
          >
            {renameMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Pencil className="w-4 h-4" />
                Save Name
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FolderItem({
  node,
  depth = 0,
  onOpenActionMenu,
  selectMode = false,
  selectedPaths,
  onToggleSelect,
}: {
  node: FolderNode;
  depth?: number;
  onOpenActionMenu: (target: ActionTarget) => void;
  selectMode?: boolean;
  selectedPaths?: Set<string>;
  onToggleSelect?: (file: LocalFileEntry) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  const hasItems =
    node.children.length > 0 ||
    node.localFiles.length > 0 ||
    (node.activeDownloads && node.activeDownloads.length > 0);

  return (
    <div>
      <div
        className="flex items-center gap-1 pr-1 hover:bg-glass-hover/30 rounded-xl transition-colors"
        style={{ paddingLeft: `${Math.min(depth, 4) * 14 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 min-h-[44px] py-2 text-left"
        >
          {hasItems ? (
            expanded ? (
              <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
            )
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}
          <FolderOpen className="w-4 h-4 text-warning flex-shrink-0" />
          <span className="text-sm font-medium text-text-primary truncate flex-1">
            {node.name}
          </span>
          <span className="text-xs text-text-muted font-mono flex-shrink-0">
            {formatBytes(node.size)}
          </span>
        </button>

        {hasItems && (
          <button
            type="button"
            onClick={() =>
              onOpenActionMenu({
                type: "folder",
                title: node.name,
                savePath: node.path,
              })
            }
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-text-secondary hover:text-text-primary hover:bg-glass-hover flex-shrink-0"
            aria-label={`Actions for folder ${node.name}`}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        )}
      </div>

      {expanded && (
        <div>
          {node.children.map((child) => (
            <FolderItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenActionMenu={onOpenActionMenu}
              selectMode={selectMode}
              selectedPaths={selectedPaths}
              onToggleSelect={onToggleSelect}
            />
          ))}

          {/* Active downloads placeholder pulling from Drive to VPS */}
          {node.activeDownloads?.map((d) => (
            <div
              key={d.task_id}
              className="flex items-start gap-2.5 sm:gap-3 pr-1 min-h-[48px] py-2.5 bg-sky-500/[0.04] hover:bg-sky-500/[0.08] border-l-2 border-l-sky-400 rounded-xl transition-colors my-0.5"
              style={{ paddingLeft: `${Math.min(depth + 1, 4) * 14 + 8}px` }}
            >
              <span className="w-4 flex-shrink-0" />
              <span className="mt-0.5 flex-shrink-0 flex items-center justify-center">
                <HardDriveDownload className="w-4 h-4 text-sky-400 animate-bounce" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate font-medium">
                  {d.filename}
                </p>
                <p className="text-xs text-text-muted font-mono mt-0.5 truncate">
                  {d.total_bytes > 0 ? formatBytes(d.total_bytes) : "Unknown size"} ·{" "}
                  <span className="text-sky-400 font-semibold">
                    {d.progress_percent.toFixed(1)}%
                  </span>
                  <span className="text-[11px] text-text-muted ml-1.5">
                    (Downloading from Drive{d.speed_bytes_sec > 0 ? ` • ${formatBytes(d.speed_bytes_sec)}/s` : ""})
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0 pr-1 mt-0.5">
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/20 animate-pulse">
                  {d.progress_percent >= 100 ? "100.0%" : `${d.progress_percent.toFixed(1)}%`}
                </span>
              </div>
            </div>
          ))}

          {/* Files (Unified: Seeding Torrents, Unseeded Local Files, Drive Copies) */}
          {node.localFiles?.map((file) => {
            const isSeeding = file.torrent && file.torrent.progress >= 100;
            const isDownloading = file.torrent && file.torrent.progress < 100;
            const isSelected = selectedPaths?.has(file.path);

            return (
              <div
                key={file.path}
                onClick={() => {
                  if (selectMode && onToggleSelect) {
                    onToggleSelect(file);
                  }
                }}
                className={`flex items-start gap-2.5 sm:gap-3 pr-1 py-2.5 hover:bg-glass-hover/30 rounded-xl transition-colors min-h-[48px] group ${
                  selectMode ? "cursor-pointer" : ""
                } ${isSelected ? "bg-accent/10 border border-accent/25" : ""}`}
                style={{ paddingLeft: `${Math.min(depth + 1, 4) * 14 + 8}px` }}
              >
                {/* Select Mode Checkbox */}
                {selectMode ? (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggleSelect?.(file);
                    }}
                    className="mt-0.5 w-4 h-4 rounded accent-accent cursor-pointer flex-shrink-0"
                  />
                ) : (
                  <span className="w-4 flex-shrink-0" />
                )}

                {/* File Icon (Aligned with first row title) */}
                <span className="mt-0.5 flex-shrink-0 flex items-center justify-center">
                  {isSeeding ? (
                    <ArrowUpCircle className="w-4 h-4 text-emerald-400" />
                  ) : isDownloading ? (
                    <ArrowDownCircle className="w-4 h-4 text-sky-400" />
                  ) : file.isDriveCompleted ? (
                    <CloudDownload className="w-4 h-4 text-purple-400" />
                  ) : (
                    <File className="w-4 h-4 text-text-secondary" />
                  )}
                </span>

                {/* File Information and Badges */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <p className="text-sm text-text-primary truncate font-medium" title={file.name}>
                      {file.name}
                    </p>

                    {/* Concise 1-2 word Status Badges */}
                    {isSeeding ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <Radio className="w-2.5 h-2.5 animate-pulse" />
                        Seeding
                      </span>
                    ) : isDownloading ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                        Downloading
                      </span>
                    ) : file.isDriveCompleted ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                        From Drive
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/15 text-zinc-300 border border-zinc-500/30">
                        Unseeded
                      </span>
                    )}
                  </div>

                  {/* Compact single-line core metadata */}
                  <p className="text-xs text-text-muted font-mono mt-0.5 truncate">
                    {formatBytes(file.size)}
                    {isSeeding ? (
                      <>
                        {" "}• Ratio {(file.torrent?.ratio ?? 0).toFixed(2)}
                        {file.torrent?.upload_speed && file.torrent.upload_speed > 0 ? (
                          <> • ↑ {formatBytes(file.torrent.upload_speed)}/s</>
                        ) : null}
                      </>
                    ) : isDownloading ? (
                      <>
                        {" "}• {file.torrent!.progress.toFixed(1)}%
                        {file.torrent?.download_speed && file.torrent.download_speed > 0 ? (
                          <> • ↓ {formatBytes(file.torrent.download_speed)}/s</>
                        ) : null}
                      </>
                    ) : (
                      <> • Local Storage</>
                    )}
                  </p>
                </div>

                {/* Actions Button */}
                {!selectMode && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenActionMenu({
                        type: "file",
                        title: file.name,
                        savePath: file.path,
                        torrentHash: file.torrentHash || file.torrent?.hash,
                      });
                    }}
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl text-text-secondary hover:text-text-primary hover:bg-glass-hover flex-shrink-0 mt-0.5"
                    aria-label={`Actions for ${file.name}`}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FileBrowserPage() {
  const { data: torrents, isLoading: torrentsLoading } = useTorrents();
  const { data: localFilesData, isLoading: localFilesLoading } = useLocalFiles();
  const { data: driveDownloads } = useDriveDownloads();
  const deleteLocalFileMutation = useDeleteLocalFile();
  const api = useApi();
  const instance = useActiveInstance();
  const qc = useQueryClient();

  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const openAddTorrentWithPrefill = useAppStore(
    (s) => s.openAddTorrentWithPrefill
  );
  const setDeleteConfirmHash = useAppStore((s) => s.setDeleteConfirmHash);

  // Filter & Sort State
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("name");

  // Multi-select State
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [batchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // Action Target & Modals
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [renameModalTarget, setRenameModalTarget] = useState<{ path: string; name: string } | null>(null);
  const { data: driveAuth } = useDriveAuthStatus();
  const [driveAuthModalOpen, setDriveAuthModalOpen] = useState(false);
  const [uploadDrivePath, setUploadDrivePath] = useState<string | null>(null);
  const [uploadTorrentHash, setUploadTorrentHash] = useState<string | null>(null);
  const [batchUploadModalOpen, setBatchUploadModalOpen] = useState(false);
  const [batchUploadItems, setBatchUploadItems] = useState<Array<{ filePath: string; name: string; size?: number; torrentHash?: string }>>([]);

  const handleUploadToDrive = (target: ActionTarget) => {
    setActionTarget(null);
    if (!driveAuth?.authenticated) {
      toast("Please connect Google Drive first", { icon: "🔐" });
      setDriveAuthModalOpen(true);
    } else {
      setUploadDrivePath(target.savePath);
      setUploadTorrentHash(target.torrentHash || null);
    }
  };

  const rawTree = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filteredTorrents = (torrents || []).filter(
      (t) =>
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.save_path.toLowerCase().includes(q)
    );
    const filteredFiles = (localFilesData?.files || []).filter(
      (f) =>
        !q ||
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q)
    );
    const filteredDownloads = (driveDownloads || []).filter(
      (d) =>
        !q ||
        d.filename.toLowerCase().includes(q) ||
        d.destination_path.toLowerCase().includes(q)
    );

    if (
      filteredTorrents.length === 0 &&
      filteredFiles.length === 0 &&
      filteredDownloads.length === 0
    ) {
      return null;
    }

    return buildFileTree(filteredTorrents, filteredFiles, filteredDownloads);
  }, [searchQuery, torrents, localFilesData, driveDownloads]);

  // Apply quick filter pills and sort order
  const filteredTree = useMemo(() => {
    if (!rawTree) return null;
    return filterAndSortTree(rawTree, filterStatus, sortBy);
  }, [rawTree, filterStatus, sortBy]);

  // Collect all selectable files in the currently visible filtered tree
  const allSelectableFiles = useMemo(() => {
    return collectAllFiles(filteredTree);
  }, [filteredTree]);

  const allVisibleSelected =
    allSelectableFiles.length > 0 &&
    allSelectableFiles.every((f) => selectedPaths.has(f.path));

  const toggleSelect = (file: LocalFileEntry) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(file.path)) {
        next.delete(file.path);
      } else {
        next.add(file.path);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(allSelectableFiles.map((f) => f.path)));
    }
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedPaths(new Set());
  };

  const handleBatchUploadToDrive = () => {
    if (!driveAuth?.authenticated) {
      toast("Please connect Google Drive first", { icon: "🔐" });
      setDriveAuthModalOpen(true);
      return;
    }

    const itemsToUpload = allSelectableFiles
      .filter((f) => selectedPaths.has(f.path))
      .map((f) => ({
        filePath: f.path,
        name: f.name,
        size: f.size,
        torrentHash: f.torrentHash || f.torrent?.hash,
      }));

    if (itemsToUpload.length === 0) return;
    setBatchUploadItems(itemsToUpload);
    setBatchUploadModalOpen(true);
  };

  const executeBatchDelete = async () => {
    if (!api || selectedPaths.size === 0) return;
    setIsBatchDeleting(true);

    const selectedFileEntries = allSelectableFiles.filter((f) =>
      selectedPaths.has(f.path)
    );

    const torrentHashes = Array.from(
      new Set(
        selectedFileEntries
          .map((f) => f.torrentHash || f.torrent?.hash)
          .filter(Boolean) as string[]
      )
    );
    const nonTorrentPaths = selectedFileEntries
      .filter((f) => !f.torrentHash && !f.torrent?.hash)
      .map((f) => f.path);

    let successCount = 0;
    let failCount = 0;

    // Delete torrents atomically with deleteFiles=true to stop seeding and remove files
    if (torrentHashes.length > 0) {
      try {
        await api.bulkDeleteTorrents(torrentHashes, true);
        successCount += torrentHashes.length;
      } catch {
        failCount += torrentHashes.length;
      }
    }

    // Delete standalone local files
    for (const path of nonTorrentPaths) {
      try {
        await api.deleteLocalFile(path);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setIsBatchDeleting(false);
    setBatchDeleteModalOpen(false);

    if (successCount > 0) {
      toast.success(`${successCount} file(s) deleted`);
      qc.invalidateQueries({ queryKey: ["local-files", instance?.id] });
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    }
    if (failCount > 0) {
      toast.error(`Failed to delete ${failCount} file(s)`);
    }

    exitSelectMode();
  };

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    toast.success("Path copied");
  };

  const isLoading = torrentsLoading && localFilesLoading;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">File Browser</h1>
        <p className="text-sm text-text-secondary mt-1">
          Manage downloads, differentiate active seeding torrents from local storage, and trigger re-seed directly from server paths.
        </p>
      </div>

      {/* Active Background Downloads to VPS Card */}
      <ActiveDriveDownloads />

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Filter files & folders..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary rounded-lg transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Stats Summary */}
      {isLoading ? (
        <Skeleton className="h-4 w-44" />
      ) : (
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-4 h-4" />
            {formatBytes(filteredTree?.size || 0)} total
          </span>
          <span>
            {allSelectableFiles.length} file{allSelectableFiles.length !== 1 ? "s" : ""} listed
          </span>
        </div>
      )}

      {/* Top Control Bar: Select & Quick Filter Pills */}
      {isSelectMode ? (
        /* Active Selection Bar */
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/25 text-xs w-full animate-fadeIn">
          <label className="flex items-center gap-2 cursor-pointer select-none font-medium text-text-primary">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded accent-accent cursor-pointer"
            />
            <span>
              {selectedPaths.size > 0
                ? `${selectedPaths.size} selected`
                : `Select All (${allSelectableFiles.length})`}
            </span>
          </label>

          <div className="flex items-center gap-2 ml-auto">
            {selectedPaths.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleBatchUploadToDrive}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium shadow-sm transition-colors"
                  title="Upload selected files to Google Drive"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Upload to Drive ({selectedPaths.size})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBatchDeleteModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger text-white text-xs font-medium shadow-sm hover:bg-danger/90 transition-colors"
                  title="Delete selected files from server"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete ({selectedPaths.size})</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={exitSelectMode}
              className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover text-xs font-medium text-text-primary transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        /* Normal Mode Toolbar: Select Mode Button, Quick Filter Pills, Sort Options */
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-text-muted w-full">
          {/* Left: Select toggle button & Status Filter Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setIsSelectMode(true)}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover transition-colors text-text-secondary hover:text-text-primary font-medium"
              title="Select multiple files for batch actions"
            >
              <CheckSquare className="w-3.5 h-3.5 text-accent" />
              <span>Select</span>
            </button>

            <div className="h-4 w-[1px] bg-glass-border mx-0.5" />

            {/* Filter Pills */}
            <div className="inline-flex items-center p-0.5 rounded-lg bg-surface-elevated border border-glass-border">
              <button
                type="button"
                onClick={() => setFilterStatus("all")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  filterStatus === "all"
                    ? "bg-accent text-white shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus("seeding")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  filterStatus === "seeding"
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "text-text-secondary hover:text-emerald-400"
                }`}
              >
                Seeding
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus("unseeded")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  filterStatus === "unseeded"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-text-secondary hover:text-amber-400"
                }`}
              >
                Unseeded
              </button>
            </div>
          </div>

          {/* Right: Sort Options */}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[11px] text-text-muted mr-1 hidden sm:inline">Sort:</span>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-surface-elevated border border-glass-border">
              <button
                type="button"
                onClick={() => setSortBy("name")}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                  sortBy === "name"
                    ? "bg-surface-overlay text-text-primary shadow-sm font-semibold"
                    : "text-text-secondary hover:text-text-primary"
                }`}
                title="Sort alphabetically"
              >
                Name
              </button>
              <button
                type="button"
                onClick={() => setSortBy("size")}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                  sortBy === "size"
                    ? "bg-surface-overlay text-text-primary shadow-sm font-semibold"
                    : "text-text-secondary hover:text-text-primary"
                }`}
                title="Sort by size (largest first)"
              >
                Size
              </button>
              <button
                type="button"
                onClick={() => setSortBy("date")}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                  sortBy === "date"
                    ? "bg-surface-overlay text-text-primary shadow-sm font-semibold"
                    : "text-text-secondary hover:text-text-primary"
                }`}
                title="Sort by date modified (newest first)"
              >
                Date
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Tree */}
      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : filteredTree ? (
        <div className="glass rounded-xl p-2">
          {filteredTree.children.length > 0 ||
          filteredTree.localFiles.length > 0 ||
          (filteredTree.activeDownloads && filteredTree.activeDownloads.length > 0) ? (
            filteredTree.children.map((child) => (
              <FolderItem
                key={child.path}
                node={child}
                onOpenActionMenu={setActionTarget}
                selectMode={isSelectMode}
                selectedPaths={selectedPaths}
                onToggleSelect={toggleSelect}
              />
            ))
          ) : (
            <div className="p-12 text-center">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-30" />
              <p className="text-text-secondary">No files found matching criteria</p>
            </div>
          )}
        </div>
      ) : (
        <div className="glass rounded-xl p-12 text-center">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-30" />
          <p className="text-text-secondary">No files found on server</p>
        </div>
      )}

      {/* File/Folder Action Sheet */}
      {actionTarget && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setActionTarget(null)}
          />
          <div
            className="relative w-full md:max-w-md bg-surface-overlay border border-glass-border rounded-t-3xl md:rounded-2xl p-4 space-y-2 z-10 shadow-2xl"
            style={{
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
            }}
          >
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-glass-border">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">
                  {actionTarget.title}
                </p>
                <p className="text-xs text-text-muted font-mono truncate">
                  {actionTarget.savePath}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionTarget(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-text-secondary hover:bg-glass-hover"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Rename File / Folder */}
            <button
              type="button"
              onClick={() => {
                const target = actionTarget;
                setActionTarget(null);
                setRenameModalTarget({
                  path: target.savePath,
                  name: target.title,
                });
              }}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <Pencil className="w-5 h-5 text-accent" />
              Rename
            </button>

            {/* Seed with Torrent / Magnet */}
            <button
              type="button"
              onClick={() => {
                const target = actionTarget;
                setActionTarget(null);
                openAddTorrentWithPrefill({
                  savePath: target.savePath,
                  reseedMode: true,
                  skipChecking: true,
                  title: target.title,
                });
              }}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
              Seed with Torrent / Magnet
            </button>

            {/* Upload to Google Drive */}
            <button
              type="button"
              onClick={() => handleUploadToDrive(actionTarget)}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <UploadCloud className="w-5 h-5 text-accent" />
              Upload to Google Drive
            </button>

            {/* Copy Server Path */}
            <button
              type="button"
              onClick={() => {
                copyPath(actionTarget.savePath);
                setActionTarget(null);
              }}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <Copy className="w-5 h-5 text-text-secondary" />
              Copy Server Path
            </button>

            {/* Delete Option */}
            {actionTarget.torrentHash ? (
              <div className="pt-2 border-t border-glass-border">
                <button
                  type="button"
                  onClick={() => {
                    const hash = actionTarget.torrentHash!;
                    setActionTarget(null);
                    setDeleteConfirmHash(hash);
                  }}
                  className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-danger hover:bg-danger/10 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                  Delete Torrent
                </button>
              </div>
            ) : actionTarget.type === "file" ? (
              <div className="pt-2 border-t border-glass-border">
                <button
                  type="button"
                  onClick={() => {
                    const path = actionTarget.savePath;
                    setActionTarget(null);
                    if (window.confirm(`Delete local file "${actionTarget.title}" from server?`)) {
                      deleteLocalFileMutation.mutate(path);
                    }
                  }}
                  className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-danger hover:bg-danger/10 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                  Delete Local File
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      {batchDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !isBatchDeleting && setBatchDeleteModalOpen(false)}
          />
          <div className="relative w-full max-w-sm glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center gap-3 text-danger">
              <div className="w-9 h-9 rounded-xl bg-danger/15 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-danger" />
              </div>
              <h3 className="text-base font-semibold text-text-primary">
                Delete {selectedPaths.size} File(s)
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              Are you sure you want to delete {selectedPaths.size} selected file(s) from local server storage? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={isBatchDeleting}
                onClick={() => setBatchDeleteModalOpen(false)}
                className="min-h-[38px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeBatchDelete}
                disabled={isBatchDeleting}
                className="min-h-[38px] px-4 rounded-xl text-sm font-medium bg-danger hover:bg-danger/80 text-white disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {isBatchDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete ({selectedPaths.size})</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename File / Folder Modal */}
      <RenameFileModal
        open={!!renameModalTarget}
        onClose={() => setRenameModalTarget(null)}
        target={renameModalTarget}
      />

      {/* Google Drive Auth Modal */}
      <DriveAuthModal
        open={driveAuthModalOpen}
        onClose={() => setDriveAuthModalOpen(false)}
      />

      {/* Single Upload to Drive Modal */}
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

      {/* Batch Upload to Drive Modal */}
      {batchUploadModalOpen && (
        <BatchUploadToDriveModal
          open={batchUploadModalOpen}
          onClose={() => {
            setBatchUploadModalOpen(false);
            setBatchUploadItems([]);
          }}
          items={batchUploadItems}
          onSuccess={() => {
            exitSelectMode();
          }}
        />
      )}
    </div>
  );
}
