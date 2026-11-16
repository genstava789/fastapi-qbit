import { useState, useMemo } from "react";
import { useTorrents, useLocalFiles, useDeleteLocalFile } from "@/hooks/useTorrents";
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
  CheckCircle2,
} from "lucide-react";
import { ListSkeleton, Skeleton } from "@/components/ui";
import { useAppStore } from "@/stores/appStore";
import { useDriveAuthStatus, useDriveDownloads } from "@/hooks/useDrive";
import { DriveAuthModal, UploadToDriveModal, ActiveDriveDownloads } from "@/components/drive";
import toast from "react-hot-toast";
import type { TorrentItem, DriveDownloadProgress, LocalFileItem } from "@/types";

interface LocalFileEntry {
  name: string;
  path: string;
  size: number;
  modified?: number;
  torrentHash?: string;
  isDriveCompleted?: boolean;
}

interface FolderNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children: FolderNode[];
  torrents: TorrentItem[];
  localFiles: LocalFileEntry[];
  activeDownloads?: DriveDownloadProgress[];
}

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
      targetFolder.localFiles.push({
        name: f.name,
        path: f.path,
        size: f.size,
        modified: f.modified,
        torrentHash: f.torrent_hash || undefined,
      });
      addFolderSize(f.parent_path, f.size);
    }
  }

  // 2. Torrents from qBittorrent
  for (const t of torrents) {
    const targetNode = getOrCreatePathNode(t.save_path);
    const existing = targetNode.localFiles.find(
      (f) => f.name.toLowerCase() === t.name.toLowerCase()
    );
    if (existing) {
      existing.torrentHash = t.hash;
    } else {
      targetNode.torrents.push(t);
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

interface ActionTarget {
  type: "folder" | "torrent" | "file";
  title: string;
  savePath: string;
  torrentHash?: string;
}

function FolderItem({
  node,
  depth = 0,
  onOpenActionMenu,
}: {
  node: FolderNode;
  depth?: number;
  onOpenActionMenu: (target: ActionTarget) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const openAddTorrentWithPrefill = useAppStore(
    (s) => s.openAddTorrentWithPrefill
  );
  const setDeleteConfirmHash = useAppStore((s) => s.setDeleteConfirmHash);

  const hasItems =
    node.children.length > 0 ||
    node.torrents.length > 0 ||
    node.localFiles.length > 0 ||
    (node.activeDownloads && node.activeDownloads.length > 0);

  const hasCompleted =
    node.torrents.some((t) => t.progress >= 100) ||
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

        {hasCompleted && (
          <button
            type="button"
            onClick={() =>
              onOpenActionMenu({
                type: "folder",
                title: node.name,
                savePath: node.path,
              })
            }
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-text-secondary hover:text-text-primary hover:bg-glass-hover flex-shrink-0"
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
            />
          ))}

          {/* Active downloads placeholder pulling from Drive to VPS */}
          {node.activeDownloads?.map((d) => (
            <div
              key={d.task_id}
              className="flex items-center gap-2 pr-1 min-h-[48px] py-2 bg-sky-500/[0.04] hover:bg-sky-500/[0.08] border-l-2 border-l-sky-400 rounded-xl transition-colors my-0.5"
              style={{ paddingLeft: `${Math.min(depth + 1, 4) * 14 + 8}px` }}
            >
              <span className="w-4 flex-shrink-0" />
              <HardDriveDownload className="w-4 h-4 text-sky-400 flex-shrink-0 animate-bounce" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate font-medium">
                  {d.filename}
                </p>
                <p className="text-xs text-text-muted font-mono">
                  {d.total_bytes > 0 ? formatBytes(d.total_bytes) : "Unknown size"} ·{" "}
                  <span className="text-sky-400 font-semibold">
                    {d.progress_percent.toFixed(1)}%
                  </span>
                  <span className="text-[11px] text-text-muted ml-1.5">
                    (Pulling from Drive{d.speed_bytes_sec > 0 ? ` • ${formatBytes(d.speed_bytes_sec)}/s` : ""})
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0 pr-1">
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/20 animate-pulse">
                  {d.progress_percent >= 100 ? "100.0%" : `${d.progress_percent.toFixed(1)}%`}
                </span>
              </div>
            </div>
          ))}

          {/* Local files on disk (including completed Drive downloads) */}
          {node.localFiles?.map((file) => (
            <div
              key={file.path}
              className="flex items-center gap-2 pr-1 min-h-[48px] py-2 hover:bg-glass-hover/30 rounded-xl transition-colors"
              style={{ paddingLeft: `${Math.min(depth + 1, 4) * 14 + 8}px` }}
            >
              <span className="w-4 flex-shrink-0" />
              {file.isDriveCompleted ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <File className="w-4 h-4 text-sky-400 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm text-text-primary truncate font-medium">{file.name}</p>
                  {file.isDriveCompleted && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                      From Drive
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted font-mono">
                  {formatBytes(file.size)} ·{" "}
                  <span className={file.isDriveCompleted ? "text-emerald-400 font-medium" : "text-text-muted"}>
                    {file.isDriveCompleted ? "Copied to Server" : "Local File"}
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  onOpenActionMenu({
                    type: "file",
                    title: file.name,
                    savePath: file.path,
                    torrentHash: file.torrentHash,
                  })
                }
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-text-secondary hover:text-text-primary hover:bg-glass-hover flex-shrink-0"
                aria-label={`Actions for ${file.name}`}
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>
          ))}

          {/* Standalone torrents */}
          {node.torrents.map((t) => (
            <div
              key={t.hash}
              className="flex items-center gap-2 pr-1 min-h-[48px] py-2 hover:bg-glass-hover/30 rounded-xl transition-colors"
              style={{ paddingLeft: `${Math.min(depth + 1, 4) * 14 + 8}px` }}
            >
              <span className="w-4 flex-shrink-0" />
              <File className="w-4 h-4 text-accent flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate">{t.name}</p>
                <p className="text-xs text-text-muted font-mono">
                  {formatBytes(t.total_size)} ·{" "}
                  <span
                    className={
                      t.progress >= 100 ? "text-success" : "text-accent"
                    }
                  >
                    {t.progress.toFixed(1)}%
                  </span>
                </p>
              </div>

              {t.progress >= 100 ? (
                <button
                  type="button"
                  onClick={() =>
                    onOpenActionMenu({
                      type: "torrent",
                      title: t.name,
                      savePath: t.content_path || (
                        t.save_path.endsWith("/")
                          ? `${t.save_path}${t.name}`
                          : `${t.save_path}/${t.name}`
                      ),
                      torrentHash: t.hash,
                    })
                  }
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-text-secondary hover:text-text-primary hover:bg-glass-hover flex-shrink-0"
                  aria-label={`Actions for ${t.name}`}
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              ) : (
                <div className="flex items-center flex-shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      openAddTorrentWithPrefill({
                        savePath: t.save_path,
                        reseedMode: true,
                        skipChecking: false,
                        title: t.name,
                      })
                    }
                    className="hidden sm:flex min-w-[44px] min-h-[44px] items-center justify-center rounded-xl text-text-muted hover:text-accent hover:bg-accent/10"
                    title="Re-check & Seed"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmHash(t.hash)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-text-muted hover:text-danger hover:bg-danger/10"
                    title="Delete torrent & files"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
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

  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const openAddTorrentWithPrefill = useAppStore(
    (s) => s.openAddTorrentWithPrefill
  );
  const setDeleteConfirmHash = useAppStore((s) => s.setDeleteConfirmHash);
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const { data: driveAuth } = useDriveAuthStatus();
  const [driveAuthModalOpen, setDriveAuthModalOpen] = useState(false);
  const [uploadDrivePath, setUploadDrivePath] = useState<string | null>(null);
  const [uploadTorrentHash, setUploadTorrentHash] = useState<string | null>(null);

  const handleUploadToDrive = (target: ActionTarget) => {
    setActionTarget(null);
    if (!driveAuth?.authenticated) {
      toast("Silakan hubungkan Google Drive terlebih dahulu", { icon: "🔐" });
      setDriveAuthModalOpen(true);
    } else {
      setUploadDrivePath(target.savePath);
      setUploadTorrentHash(target.torrentHash || null);
    }
  };

  const filteredTree = useMemo(() => {
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

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    toast.success("Path copied");
  };

  const isLoading = torrentsLoading && localFilesLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">File Browser</h1>
        <p className="text-sm text-text-secondary mt-1">
          Browse downloaded files and trigger Re-Seed directly from VPS paths
        </p>
      </div>

      {/* Active Background Downloads to VPS Card */}
      <ActiveDriveDownloads />

      {/* Search (Synced with Header contextual search) */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Filter files and folders..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>

      {/* Stats */}
      {isLoading ? (
        <Skeleton className="h-4 w-44" />
      ) : (
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-4 h-4" />
            {formatBytes(filteredTree?.size || 0)} total
          </span>
          <span>
            {(localFilesData?.files?.filter((f) => !f.is_directory).length || 0) +
              (torrents?.length || 0)}{" "}
            files on server
          </span>
        </div>
      )}

      {/* File Tree */}
      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : filteredTree ? (
        <div className="glass rounded-xl p-2">
          {filteredTree.children.length > 0 ||
          filteredTree.torrents.length > 0 ||
          filteredTree.localFiles.length > 0 ||
          (filteredTree.activeDownloads && filteredTree.activeDownloads.length > 0) ? (
            filteredTree.children.map((child) => (
              <FolderItem
                key={child.path}
                node={child}
                onOpenActionMenu={setActionTarget}
              />
            ))
          ) : (
            <div className="p-12 text-center">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-30" />
              <p className="text-text-secondary">No files found</p>
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

            <button
              type="button"
              onClick={() => handleUploadToDrive(actionTarget)}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <UploadCloud className="w-5 h-5 text-accent" />
              Upload to Google Drive
            </button>

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
                    if (window.confirm(`Delete local file "${actionTarget.title}"?`)) {
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
    </div>
  );
}
