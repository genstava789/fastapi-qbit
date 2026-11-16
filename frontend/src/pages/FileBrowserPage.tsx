import { useState, useMemo, useEffect, useRef } from "react";
import {
  useTorrents,
  useLocalFiles,
  useDeleteLocalFile,
  useRenameLocalFile,
  useApi,
  useActiveInstance,
} from "@/hooks/useTorrents";
import { useQueryClient } from "@tanstack/react-query";
import { formatBytes, cn } from "@/lib/utils";
import {
  FolderOpen,
  File,
  ChevronRight,
  ArrowLeft,
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
  Search,
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

function findNodeByPath(root: FolderNode | null, targetPath: string): FolderNode | null {
  if (!root) return null;
  const normTarget = targetPath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const normRoot = root.path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  if (normRoot.toLowerCase() === normTarget.toLowerCase()) return root;

  for (const child of root.children) {
    const found = findNodeByPath(child, targetPath);
    if (found) return found;
  }
  return null;
}

function getBreadcrumbs(path: string): Array<{ name: string; path: string }> {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized || normalized === "/") {
    return [{ name: "Server", path: "/" }];
  }
  const parts = normalized.split("/").filter(Boolean);
  const crumbs: Array<{ name: string; path: string }> = [{ name: "Server", path: "/" }];
  let accumulated = "";
  for (const part of parts) {
    accumulated += "/" + part;
    crumbs.push({ name: part, path: accumulated });
  }
  return crumbs;
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

  // Directory Navigation State (default to /downloads if present, like /drive)
  const [currentPath, setCurrentPath] = useState<string>("/downloads");
  const breadcrumbScrollRef = useRef<HTMLDivElement>(null);

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

  // Resolve directory node based on currentPath (or fallback to /downloads or root)
  const currentNode = useMemo(() => {
    if (!filteredTree) return null;
    return (
      findNodeByPath(filteredTree, currentPath) ||
      findNodeByPath(filteredTree, "/downloads") ||
      filteredTree
    );
  }, [filteredTree, currentPath]);

  const effectivePath = currentNode?.path || "/";
  const breadcrumbs = useMemo(() => getBreadcrumbs(effectivePath), [effectivePath]);

  useEffect(() => {
    if (breadcrumbScrollRef.current) {
      breadcrumbScrollRef.current.scrollLeft = breadcrumbScrollRef.current.scrollWidth;
    }
  }, [effectivePath]);

  const isSearching = !!searchQuery.trim();

  // All files across the entire filtered tree (used when searching or for total stats)
  const allFilteredFiles = useMemo(() => {
    return collectAllFiles(filteredTree);
  }, [filteredTree]);

  // Files currently visible to the user in this view
  const visibleFiles = useMemo(() => {
    if (isSearching) {
      return allFilteredFiles;
    }
    return currentNode?.localFiles || [];
  }, [isSearching, allFilteredFiles, currentNode]);

  const allVisibleSelected =
    visibleFiles.length > 0 &&
    visibleFiles.every((f) => selectedPaths.has(f.path));

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
      setSelectedPaths(new Set(visibleFiles.map((f) => f.path)));
    }
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedPaths(new Set());
  };

  const handleGoUp = () => {
    if (effectivePath === "/") return;
    const parentPath = effectivePath.substring(0, effectivePath.lastIndexOf("/")) || "/";
    setCurrentPath(parentPath);
  };

  const handleBatchUploadToDrive = () => {
    if (!driveAuth?.authenticated) {
      toast("Please connect Google Drive first", { icon: "🔐" });
      setDriveAuthModalOpen(true);
      return;
    }

    const itemsToUpload = allFilteredFiles
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

    const selectedFileEntries = allFilteredFiles.filter((f) =>
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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">File Browser</h1>
        <p className="text-sm text-text-secondary mt-1">
          Manage downloads, differentiate active seeding torrents from local storage, and trigger re-seed directly from server paths.
        </p>
      </div>

      {/* Active Background Downloads to VPS Card */}
      <ActiveDriveDownloads />

      {/* Stats Summary */}
      {isLoading ? (
        <Skeleton className="h-4 w-44" />
      ) : (
        <div className="flex items-center gap-4 text-xs sm:text-sm text-text-secondary">
          <span className="flex items-center gap-1.5 font-medium">
            <HardDrive className="w-4 h-4 text-accent" />
            {formatBytes(filteredTree?.size || 0)} total
          </span>
          <span className="text-text-muted">
            {allFilteredFiles.length} file{allFilteredFiles.length !== 1 ? "s" : ""} listed
          </span>
        </div>
      )}

      {/* ── UNIFIED TOOLBAR: Select Button, Filter Pills & Sort Options All In ONE Contiguous Row ── */}
      {isSelectMode ? (
        /* Active Selection Bar: Sleek, compact & responsive */
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/25 text-xs w-full animate-fadeIn overflow-x-auto no-scrollbar">
          <label className="flex items-center gap-2 cursor-pointer select-none font-medium text-text-primary flex-shrink-0">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded accent-accent cursor-pointer flex-shrink-0"
            />
            <span className="text-xs">
              {selectedPaths.size > 0
                ? `${selectedPaths.size} selected`
                : `Select All (${visibleFiles.length})`}
            </span>
          </label>

          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto flex-shrink-0">
            {selectedPaths.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleBatchUploadToDrive}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium shadow-sm transition-colors flex-shrink-0"
                  title="Upload selected files to Google Drive"
                >
                  <UploadCloud className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="hidden sm:inline">Upload to Drive</span>
                  <span className="sm:hidden">Drive</span>
                  <span>({selectedPaths.size})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBatchDeleteModalOpen(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium shadow-sm transition-colors flex-shrink-0"
                  title="Delete selected files from server"
                >
                  <Trash2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Delete ({selectedPaths.size})</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={exitSelectMode}
              className="h-8 px-2.5 sm:px-3 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover text-xs font-medium text-text-primary transition-colors flex-shrink-0"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        /* Normal Mode: Select, Status Filters, and Sort Options sitting together side-by-side */
        <div className="flex items-center gap-2 text-xs text-text-muted w-full overflow-x-auto no-scrollbar flex-nowrap py-1">
          {/* Select Button */}
          <button
            type="button"
            onClick={() => setIsSelectMode(true)}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover transition-colors text-text-secondary hover:text-text-primary font-medium flex-shrink-0"
            title="Select multiple files for batch actions"
          >
            <CheckSquare className="w-3.5 h-3.5 text-accent" />
            <span>Select</span>
          </button>

          <div className="h-4 w-[1px] bg-glass-border flex-shrink-0" />

          {/* Status Filter Pills: All | Seeding | Unseeded */}
          <div className="inline-flex items-center p-0.5 rounded-lg bg-surface-elevated border border-glass-border flex-shrink-0">
            <button
              type="button"
              onClick={() => setFilterStatus("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                filterStatus === "all"
                  ? "bg-accent text-white shadow-sm font-semibold"
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
                  ? "bg-emerald-500 text-white shadow-sm font-semibold"
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
                  ? "bg-amber-500 text-white shadow-sm font-semibold"
                  : "text-text-secondary hover:text-amber-400"
              }`}
            >
              Unseeded
            </button>
          </div>

          <div className="h-4 w-[1px] bg-glass-border flex-shrink-0" />

          {/* Sort Options: Name | Size | Date (unified next to filters) */}
          <div className="inline-flex items-center p-0.5 rounded-lg bg-surface-elevated border border-glass-border flex-shrink-0">
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
      )}

      {/* ── BREADCRUMB DIRECTORY NAVIGATION (Like /drive) ── */}
      {!isSearching && (
        <div className="flex items-center gap-1.5 min-w-0 py-1">
          {effectivePath !== "/" && (
            <button
              type="button"
              onClick={handleGoUp}
              className="flex items-center gap-1 min-h-[30px] px-2 rounded-lg bg-surface-elevated border border-glass-border text-text-secondary hover:text-text-primary hover:bg-glass-hover transition-colors flex-shrink-0 text-xs font-medium"
              title="Go up one folder"
              aria-label="Go up one folder"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Up</span>
            </button>
          )}

          <div
            ref={breadcrumbScrollRef}
            className="flex items-center gap-1 overflow-x-auto no-scrollbar scroll-smooth py-0.5 text-xs flex-1 min-w-0"
          >
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <div key={crumb.path} className="flex items-center gap-1 flex-shrink-0">
                  {idx > 0 && (
                    <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0 opacity-60" />
                  )}
                  <button
                    type="button"
                    onClick={() => setCurrentPath(crumb.path)}
                    className={cn(
                      "flex items-center gap-1.5 min-h-[30px] px-2.5 rounded-lg font-medium transition-colors flex-shrink-0 whitespace-nowrap max-w-[200px] sm:max-w-[300px] truncate",
                      isLast
                        ? "bg-accent/15 text-accent border border-accent/25"
                        : "text-text-secondary hover:text-text-primary hover:bg-glass-hover"
                    )}
                    title={crumb.name}
                  >
                    {idx === 0 && <HardDrive className="w-3.5 h-3.5 flex-shrink-0" />}
                    <span className="truncate">{crumb.name}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search Filter Active Notice */}
      {isSearching && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-accent/10 border border-accent/25 text-xs">
          <div className="flex items-center gap-2 truncate">
            <Search className="w-3.5 h-3.5 text-accent flex-shrink-0" />
            <span className="text-text-secondary">
              Searching for: <strong className="text-text-primary font-semibold">"{searchQuery}"</strong> ({visibleFiles.length} result{visibleFiles.length !== 1 ? "s" : ""})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-accent/20 text-accent font-medium transition-colors flex-shrink-0"
          >
            <X className="w-3 h-3" />
            <span>Clear search</span>
          </button>
        </div>
      )}

      {/* ── RESPONSIVE DRIVE-STYLE DIRECTORY LIST (Flush Left, No Void, Divided Rows) ── */}
      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : !filteredTree ? (
        <div className="glass rounded-2xl border border-glass-border py-14 text-center space-y-3">
          <FolderOpen className="w-10 h-10 mx-auto text-text-muted opacity-30" />
          <p className="text-text-secondary text-sm">No files found on server</p>
        </div>
      ) : isSearching ? (
        /* Search results view */
        <div className="glass rounded-2xl border border-glass-border overflow-hidden divide-y divide-glass-border/40">
          {visibleFiles.length === 0 ? (
            <div className="py-14 text-center space-y-3">
              <Search className="w-10 h-10 mx-auto text-text-muted opacity-30" />
              <p className="text-text-secondary text-sm">No files match "{searchQuery}"</p>
            </div>
          ) : (
            visibleFiles.map((file) => {
              const isSeeding = file.torrent && file.torrent.progress >= 100;
              const isDownloading = file.torrent && file.torrent.progress < 100;
              const isSelected = selectedPaths.has(file.path);

              return (
                <div
                  key={file.path}
                  onClick={() => {
                    if (isSelectMode) toggleSelect(file);
                  }}
                  className={cn(
                    "flex items-start justify-between gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 min-h-[48px] transition-colors group",
                    isSelectMode ? "cursor-pointer" : "",
                    isSelected
                      ? "bg-accent/15 border-l-2 border-l-accent"
                      : "hover:bg-glass-hover/40 border-l-2 border-l-transparent"
                  )}
                >
                  <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
                    {isSelectMode && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelect(file);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 w-4 h-4 rounded accent-accent cursor-pointer flex-shrink-0"
                      />
                    )}

                    <span className="mt-0.5 flex-shrink-0 flex items-center justify-center">
                      {isSeeding ? (
                        <ArrowUpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
                      ) : isDownloading ? (
                        <ArrowDownCircle className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400" />
                      ) : file.isDriveCompleted ? (
                        <CloudDownload className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
                      ) : (
                        <File className="w-4 h-4 sm:w-5 sm:h-5 text-text-secondary" />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                        <p
                          className="text-xs sm:text-sm font-medium text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2 leading-snug group-hover:text-accent transition-colors"
                          title={file.name}
                        >
                          {file.name}
                        </p>

                        {isSeeding ? (
                          <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex-shrink-0">
                            <Radio className="w-2.5 h-2.5 animate-pulse" />
                            Seeding
                          </span>
                        ) : isDownloading ? (
                          <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30 flex-shrink-0">
                            Downloading
                          </span>
                        ) : file.isDriveCompleted ? (
                          <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30 flex-shrink-0">
                            From Drive
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/15 text-zinc-300 border border-zinc-500/30 flex-shrink-0">
                            Unseeded
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] sm:text-xs text-text-muted font-mono leading-tight mt-0.5 truncate">
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
                        <span className="text-text-muted/80 ml-1.5">
                          in {file.path.substring(0, file.path.lastIndexOf("/")) || "/"}
                        </span>
                      </p>
                    </div>
                  </div>

                  {!isSelectMode && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionTarget({
                          type: "file",
                          title: file.name,
                          savePath: file.path,
                          torrentHash: file.torrentHash || file.torrent?.hash,
                        });
                      }}
                      className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors flex-shrink-0 mt-0.5"
                      aria-label={`Actions for ${file.name}`}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Directory view: Subfolders first, then files */
        <div className="glass rounded-2xl border border-glass-border overflow-hidden divide-y divide-glass-border/40">
          {/* Active downloads placeholder in current directory */}
          {currentNode?.activeDownloads?.map((d) => (
            <div
              key={d.task_id}
              className="flex items-start justify-between gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 min-h-[48px] bg-sky-500/[0.04] hover:bg-sky-500/[0.08] border-l-2 border-l-sky-400 transition-colors"
            >
              <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
                <span className="mt-0.5 flex-shrink-0 flex items-center justify-center">
                  <HardDriveDownload className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400 animate-bounce" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2 leading-snug">
                    {d.filename}
                  </p>
                  <p className="text-[11px] sm:text-xs text-text-muted font-mono leading-tight mt-0.5 truncate">
                    {d.total_bytes > 0 ? formatBytes(d.total_bytes) : "Unknown size"} ·{" "}
                    <span className="text-sky-400 font-semibold">
                      {d.progress_percent.toFixed(1)}%
                    </span>
                    <span className="text-text-muted ml-1.5">
                      (Downloading from Drive{d.speed_bytes_sec > 0 ? ` • ${formatBytes(d.speed_bytes_sec)}/s` : ""})
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/20 animate-pulse">
                  {d.progress_percent >= 100 ? "100.0%" : `${d.progress_percent.toFixed(1)}%`}
                </span>
              </div>
            </div>
          ))}

          {/* Subfolders in current directory */}
          {currentNode?.children?.map((folder) => (
            <div
              key={folder.path}
              onClick={() => {
                setCurrentPath(folder.path);
              }}
              className="flex items-center justify-between gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 min-h-[48px] transition-colors group cursor-pointer hover:bg-glass-hover/60 border-l-2 border-l-transparent"
            >
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <FolderOpen className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2 leading-snug group-hover:text-accent transition-colors">
                    {folder.name}
                  </p>
                  <p className="text-[11px] text-text-muted leading-tight mt-0.5">
                    Folder · {formatBytes(folder.size)} · {folder.children.length + folder.localFiles.length} item{folder.children.length + folder.localFiles.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActionTarget({
                      type: "folder",
                      title: folder.name,
                      savePath: folder.path,
                    });
                  }}
                  className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors flex-shrink-0"
                  aria-label={`Actions for folder ${folder.name}`}
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors" />
              </div>
            </div>
          ))}

          {/* Files in current directory */}
          {currentNode?.localFiles?.map((file) => {
            const isSeeding = file.torrent && file.torrent.progress >= 100;
            const isDownloading = file.torrent && file.torrent.progress < 100;
            const isSelected = selectedPaths.has(file.path);

            return (
              <div
                key={file.path}
                onClick={() => {
                  if (isSelectMode) toggleSelect(file);
                }}
                className={cn(
                  "flex items-start justify-between gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 min-h-[48px] transition-colors group",
                  isSelectMode ? "cursor-pointer" : "",
                  isSelected
                    ? "bg-accent/15 border-l-2 border-l-accent"
                    : "hover:bg-glass-hover/40 border-l-2 border-l-transparent"
                )}
              >
                <div className="flex items-start gap-2.5 sm:gap-3 min-w-0 flex-1">
                  {isSelectMode && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleSelect(file);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 w-4 h-4 rounded accent-accent cursor-pointer flex-shrink-0"
                    />
                  )}

                  <span className="mt-0.5 flex-shrink-0 flex items-center justify-center">
                    {isSeeding ? (
                      <ArrowUpCircle className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
                    ) : isDownloading ? (
                      <ArrowDownCircle className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400" />
                    ) : file.isDriveCompleted ? (
                      <CloudDownload className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
                    ) : (
                      <File className="w-4 h-4 sm:w-5 sm:h-5 text-text-secondary" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
                      <p
                        className="text-xs sm:text-sm font-medium text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2 leading-snug group-hover:text-accent transition-colors"
                        title={file.name}
                      >
                        {file.name}
                      </p>

                      {isSeeding ? (
                        <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex-shrink-0">
                          <Radio className="w-2.5 h-2.5 animate-pulse" />
                          Seeding
                        </span>
                      ) : isDownloading ? (
                        <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30 flex-shrink-0">
                          Downloading
                        </span>
                      ) : file.isDriveCompleted ? (
                        <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30 flex-shrink-0">
                          From Drive
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-500/15 text-zinc-300 border border-zinc-500/30 flex-shrink-0">
                          Unseeded
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] sm:text-xs text-text-muted font-mono leading-tight mt-0.5 truncate">
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
                </div>

                {!isSelectMode && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionTarget({
                        type: "file",
                        title: file.name,
                        savePath: file.path,
                        torrentHash: file.torrentHash || file.torrent?.hash,
                      });
                    }}
                    className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors flex-shrink-0 mt-0.5"
                    aria-label={`Actions for ${file.name}`}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Empty Folder State */}
          {(!currentNode?.children || currentNode.children.length === 0) &&
            (!currentNode?.localFiles || currentNode.localFiles.length === 0) &&
            (!currentNode?.activeDownloads || currentNode.activeDownloads.length === 0) && (
              <div className="py-14 text-center space-y-3">
                <FolderOpen className="w-10 h-10 mx-auto text-text-muted opacity-30" />
                <p className="text-text-secondary text-sm">This folder is empty</p>
                {effectivePath !== "/" && (
                  <button
                    type="button"
                    onClick={handleGoUp}
                    className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-medium"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Go back to parent folder</span>
                  </button>
                )}
              </div>
            )}
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
