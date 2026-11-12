import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  useDriveApi,
  useDriveAuthStatus,
  useDriveFiles,
  useDriveBreadcrumb,
  useCreateDriveFolder,
  useDeleteDriveFile,
  useRenameDriveFile,
  useBatchDeleteDriveFiles,
} from "@/hooks/useDrive";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveInstance } from "@/hooks/useTorrents";
import { formatBytes, cn } from "@/lib/utils";
import { ListSkeleton, Skeleton } from "@/components/ui";
import { DriveAuthModal, UploadToDriveModal } from "@/components/drive";
import {
  HardDrive,
  FolderOpen,
  File,
  Download,
  ExternalLink,
  Plus,
  Settings,
  ChevronRight,
  Home,
  Loader2,
  Search,
  X,
  UploadCloud,
  FileText,
  Film,
  Music,
  Image as ImageIcon,
  Archive,
  MoreVertical,
  Trash2,
  Edit2,
  Check,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import toast from "react-hot-toast";
import type { DriveFileItem } from "@/types";

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("video/"))
    return <Film className="w-5 h-5 text-purple-400 flex-shrink-0" />;
  if (mimeType.startsWith("audio/"))
    return <Music className="w-5 h-5 text-emerald-400 flex-shrink-0" />;
  if (mimeType.startsWith("image/"))
    return <ImageIcon className="w-5 h-5 text-pink-400 flex-shrink-0" />;
  if (
    mimeType.includes("zip") ||
    mimeType.includes("tar") ||
    mimeType.includes("compressed") ||
    mimeType.includes("rar")
  ) {
    return <Archive className="w-5 h-5 text-amber-400 flex-shrink-0" />;
  }
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("text")
  ) {
    return <FileText className="w-5 h-5 text-blue-400 flex-shrink-0" />;
  }
  return <File className="w-5 h-5 text-accent flex-shrink-0" />;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function DrivePage() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read current folder directly from URL query param to enable native browser / phone back navigation!
  const currentFolderId = searchParams.get("folder") || undefined;

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [manualLocalPath, setManualLocalPath] = useState("");

  // Action Sheet & Dialogs state
  const [actionSheetItem, setActionSheetItem] = useState<DriveFileItem | null>(null);
  const [itemToRename, setItemToRename] = useState<DriveFileItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [itemToDelete, setItemToDelete] = useState<DriveFileItem | null>(null);
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: authStatus, isLoading: authLoading } = useDriveAuthStatus();
  const isAuthenticated = !!authStatus?.authenticated;

  // Auto-exchange OAuth code if redirected with ?code=...
  useEffect(() => {
    const code = searchParams.get("code");
    if (code && api) {
      const redirectUri = `${window.location.origin}/drive`;
      toast.loading("Connecting Google Drive account...", { id: "gdrive-oauth" });
      api
        .exchangeAuthCode(code, redirectUri)
        .then((res) => {
          if (res.success) {
            toast.success("Google Drive connected successfully!", { id: "gdrive-oauth" });
            qc.invalidateQueries({ queryKey: ["drive-auth-status", instance?.id] });
          } else {
            toast.error(res.message || "Failed to connect Google Drive", { id: "gdrive-oauth" });
          }
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : "Authorization failed", { id: "gdrive-oauth" });
        })
        .finally(() => {
          navigate("/drive", { replace: true });
        });
    }
  }, [searchParams, api, qc, instance?.id, navigate]);

  const {
    data: filesData,
    isLoading: filesLoading,
    isFetching: filesFetching,
  } = useDriveFiles(currentFolderId, isAuthenticated);

  const { data: breadcrumb } = useDriveBreadcrumb(
    isAuthenticated ? currentFolderId : undefined
  );

  const createFolder = useCreateDriveFolder();
  const deleteMutation = useDeleteDriveFile();
  const renameMutation = useRenameDriveFile();
  const batchDeleteMutation = useBatchDeleteDriveFiles();

  // Reset multi-select and search when folder changes
  const [prevFolderId, setPrevFolderId] = useState(currentFolderId);
  if (prevFolderId !== currentFolderId) {
    setPrevFolderId(currentFolderId);
    setSelectedIds(new Set());
    setSearchQuery("");
  }

  const navigateToFolder = (folderId?: string) => {
    if (folderId) {
      setSearchParams({ folder: folderId });
    } else {
      setSearchParams({});
    }
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolder.mutate(
      { name: newFolderName.trim(), parentId: currentFolderId },
      {
        onSuccess: () => {
          setNewFolderName("");
          setShowNewFolderModal(false);
        },
      }
    );
  };

  const handleDownload = async (file: DriveFileItem) => {
    if (!api) return;
    try {
      const res = await api.getDownloadUrl(file.id);
      if (res.url) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error("Download link not available for this file");
      }
    } catch {
      toast.error("Failed to get download URL");
    }
  };

  const handlePreview = (file: DriveFileItem) => {
    const previewUrl = `https://drive.google.com/file/d/${file.id}/view`;
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  };

  const handleStartRename = (file: DriveFileItem) => {
    setItemToRename(file);
    setRenameValue(file.name);
    setActionSheetItem(null);
  };

  const handleConfirmRename = () => {
    if (!itemToRename || !renameValue.trim()) return;
    renameMutation.mutate(
      { fileId: itemToRename.id, newName: renameValue.trim() },
      {
        onSuccess: () => {
          setItemToRename(null);
          setRenameValue("");
        },
      }
    );
  };

  const handleStartDelete = (file: DriveFileItem) => {
    setItemToDelete(file);
    setActionSheetItem(null);
  };

  const handleConfirmDelete = () => {
    if (!itemToDelete) return;
    deleteMutation.mutate(itemToDelete.id, {
      onSuccess: () => {
        setItemToDelete(null);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(itemToDelete.id);
          return next;
        });
      },
    });
  };

  const handleConfirmBatchDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    batchDeleteMutation.mutate(ids, {
      onSuccess: () => {
        setSelectedIds(new Set());
        setBatchDeleteConfirmOpen(false);
      },
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Filter files & folders
  const filteredItems = useMemo(() => {
    if (!filesData?.files) return { folders: [], files: [], all: [] };
    const q = searchQuery.toLowerCase().trim();
    const all = q
      ? filesData.files.filter((f) => f.name.toLowerCase().includes(q))
      : filesData.files;

    const folders = all.filter(
      (f) => f.mimeType === "application/vnd.google-apps.folder"
    );
    const files = all.filter(
      (f) => f.mimeType !== "application/vnd.google-apps.folder"
    );

    return { folders, files, all };
  }, [filesData, searchQuery]);

  const allVisibleSelected =
    filteredItems.all.length > 0 &&
    filteredItems.all.every((item) => selectedIds.has(item.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.all.map((item) => item.id)));
    }
  };

  // Up to parent folder logic
  const parentFolderCrumb = useMemo(() => {
    if (!breadcrumb || breadcrumb.length <= 1) return null;
    return breadcrumb[breadcrumb.length - 2];
  }, [breadcrumb]);

  const handleGoUp = () => {
    if (parentFolderCrumb) {
      navigateToFolder(parentFolderCrumb.id);
    } else {
      navigateToFolder(undefined);
    }
  };

  if (authLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <ListSkeleton rows={6} />
      </div>
    );
  }

  // Not authenticated state
  if (!isAuthenticated) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto py-12 px-4">
        <div className="glass rounded-3xl p-8 sm:p-12 text-center space-y-6 border border-glass-border shadow-2xl">
          <div className="w-20 h-20 rounded-3xl bg-accent/15 flex items-center justify-center mx-auto text-accent">
            <HardDrive className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-text-primary">
              Google Drive Integration
            </h1>
            <p className="text-text-secondary text-sm max-w-md mx-auto leading-relaxed">
              Connect your Google Drive account to directly upload downloaded torrent files from the server without using local bandwidth, and explore your cloud files seamlessly.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-6 min-h-[48px] rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-sm shadow-lg shadow-accent/25 transition-all"
          >
            <HardDrive className="w-5 h-5" />
            Connect Google Drive
          </button>
        </div>
        <DriveAuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Top Header: Title with Connected Badge + Settings Icon, and Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-text-primary">Google Drive</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Connected
            </span>
            <button
              type="button"
              onClick={() => navigate("/drive-setting")}
              className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors"
              title="Google Drive Settings"
              aria-label="Google Drive Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary mt-0.5">
            Browse, manage cloud files & upload completed server torrents
          </p>
        </div>

        {/* Action Buttons: [+ Folder], [Upload File], [Settings] (No duplicate refresh, disconnect in /drive-setting) */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowNewFolderModal(true)}
            className="min-h-[40px] px-3 flex items-center justify-center gap-1.5 rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-primary text-xs sm:text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4 text-accent" />
            <span>Folder</span>
          </button>

          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="min-h-[40px] px-3 flex items-center justify-center gap-1.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs sm:text-sm font-medium transition-colors shadow-md shadow-accent/20"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload File</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/drive-setting")}
            className="min-h-[40px] px-3 flex items-center justify-center gap-1.5 rounded-xl bg-surface-elevated border border-glass-border text-text-secondary hover:text-text-primary hover:bg-glass-hover text-xs sm:text-sm font-medium transition-colors"
            title="Drive Settings & Storage"
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Sticky Breadcrumb & Search Bar */}
      <div className="sticky top-16 z-25 bg-surface/95 backdrop-blur-xl border-b border-glass-border py-2.5 space-y-2.5 -mx-3 px-3 sm:-mx-6 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Breadcrumb Path with Up Navigation */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 text-xs sm:text-sm">
            {currentFolderId && (
              <button
                type="button"
                onClick={handleGoUp}
                className="flex items-center gap-1 min-h-[34px] px-2 rounded-xl bg-surface-elevated border border-glass-border text-text-secondary hover:text-text-primary hover:bg-glass-hover transition-colors flex-shrink-0 mr-1"
                title="Go to parent folder"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">Up</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => navigateToFolder(undefined)}
              className={cn(
                "flex items-center gap-1.5 min-h-[34px] px-2.5 rounded-xl font-medium transition-colors flex-shrink-0",
                !currentFolderId
                  ? "bg-accent/15 text-accent border border-accent/25"
                  : "text-text-secondary hover:text-text-primary hover:bg-glass-hover"
              )}
            >
              <Home className="w-4 h-4" />
              <span>My Drive</span>
            </button>

            {breadcrumb?.map((crumb) => (
              <div key={crumb.id} className="flex items-center gap-1 flex-shrink-0">
                <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                <button
                  type="button"
                  onClick={() => navigateToFolder(crumb.id)}
                  className={cn(
                    "min-h-[34px] px-2.5 rounded-xl font-medium transition-colors truncate max-w-[150px] sm:max-w-[200px]",
                    currentFolderId === crumb.id
                      ? "bg-accent/15 text-accent border border-accent/25"
                      : "text-text-secondary hover:text-text-primary hover:bg-glass-hover"
                  )}
                  title={crumb.name}
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64 flex-shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search files & folders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full min-h-[38px] pl-9 pr-8 py-1.5 rounded-xl text-xs sm:text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-1"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Multi-Select Toolbar (When files exist) */}
        {filteredItems.all.length > 0 && (
          <div className="flex items-center justify-between text-xs text-text-muted pt-1 border-t border-glass-border/40">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded accent-accent cursor-pointer"
              />
              <span>
                {selectedIds.size > 0
                  ? `${selectedIds.size} of ${filteredItems.all.length} selected`
                  : `Select all (${filteredItems.all.length})`}
              </span>
            </label>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBatchDeleteConfirmOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 border border-danger/20 text-xs font-medium transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Selected ({selectedIds.size})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="p-1 hover:text-text-primary"
                  title="Clear selection"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Files & Folders Content List (Subtle opacity fade during refresh) */}
      {filesLoading ? (
        <ListSkeleton rows={6} />
      ) : (
        <div
          className={cn(
            "glass rounded-2xl border border-glass-border overflow-hidden transition-opacity duration-200",
            filesFetching && "opacity-50 pointer-events-none"
          )}
        >
          {filteredItems.folders.length === 0 && filteredItems.files.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <FolderOpen className="w-12 h-12 mx-auto text-text-muted opacity-30" />
              <p className="text-text-secondary text-sm">
                {searchQuery ? "No matching files or folders found" : "This folder is empty"}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create new folder
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-glass-border/50">
              {/* Folders List */}
              {filteredItems.folders.map((folder) => {
                const isSelected = selectedIds.has(folder.id);

                return (
                  <div
                    key={folder.id}
                    className={cn(
                      "flex items-center justify-between gap-3 px-3 sm:px-4 py-3 min-h-[56px] transition-colors group",
                      isSelected ? "bg-accent/5" : "hover:bg-glass-hover/60"
                    )}
                  >
                    <div
                      onClick={() => navigateToFolder(folder.id)}
                      className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelect(folder.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded accent-accent flex-shrink-0 cursor-pointer"
                      />

                      <FolderOpen className="w-5 h-5 text-amber-400 flex-shrink-0" />

                      {/* Folder Name & Date */}
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-sm font-medium text-text-primary break-words line-clamp-2 group-hover:text-accent transition-colors"
                          title={folder.name}
                        >
                          {folder.name}
                        </p>
                        <p className="text-xs text-text-muted font-mono mt-0.5">
                          Folder{folder.modifiedTime ? ` • ${formatDate(folder.modifiedTime)}` : ""}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setActionSheetItem(folder)}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors"
                        title="Folder options"
                        aria-label="Folder options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Files List */}
              {filteredItems.files.map((file) => {
                const isSelected = selectedIds.has(file.id);

                return (
                  <div
                    key={file.id}
                    className={cn(
                      "flex items-center justify-between gap-3 px-3 sm:px-4 py-3 min-h-[56px] transition-colors group",
                      isSelected ? "bg-accent/5" : "hover:bg-glass-hover/40"
                    )}
                  >
                    <div
                      className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                      onClick={() => handlePreview(file)}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelect(file.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 rounded accent-accent flex-shrink-0 cursor-pointer"
                      />

                      {getFileIcon(file.mimeType)}

                      {/* File Name & Extended Metadata (Size + Date) */}
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-sm font-medium text-text-primary break-words line-clamp-2 group-hover:text-accent transition-colors"
                          title={file.name}
                        >
                          {file.name}
                        </p>
                        <p className="text-xs text-text-muted font-mono mt-0.5">
                          {file.size !== null ? formatBytes(file.size) : "0 B"}
                          {file.modifiedTime ? ` • ${formatDate(file.modifiedTime)}` : ""}
                        </p>
                      </div>
                    </div>

                    {/* Simplified Action Buttons: Quick actions on desktop, single 3-dot touch action on mobile */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePreview(file)}
                        className="hidden sm:flex min-w-[36px] min-h-[36px] items-center justify-center rounded-xl text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors"
                        title="Preview in Google Drive"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDownload(file)}
                        className="hidden sm:flex min-w-[36px] min-h-[36px] items-center justify-center rounded-xl text-accent hover:bg-accent/15 transition-colors"
                        title="Download file"
                      >
                        <Download className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setActionSheetItem(file)}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors"
                        title="More options"
                        aria-label="More options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Thumb-Friendly Mobile Bottom Action Sheet */}
      {actionSheetItem && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setActionSheetItem(null)}
          />
          <div
            className="relative w-full bg-surface-overlay border-t border-glass-border rounded-t-3xl p-4 space-y-2 z-10 shadow-2xl animate-fadeIn"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
          >
            {/* Header info */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-glass-border">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary break-words line-clamp-2">
                  {actionSheetItem.name}
                </p>
                <p className="text-xs text-text-muted font-mono mt-0.5">
                  {actionSheetItem.mimeType === "application/vnd.google-apps.folder"
                    ? "Folder"
                    : `${formatBytes(actionSheetItem.size || 0)} • ${formatDate(actionSheetItem.modifiedTime)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionSheetItem(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-text-secondary hover:bg-glass-hover"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* If file: Download Action */}
            {actionSheetItem.mimeType !== "application/vnd.google-apps.folder" && (
              <button
                type="button"
                onClick={() => {
                  const f = actionSheetItem;
                  setActionSheetItem(null);
                  handleDownload(f);
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
              >
                <Download className="w-5 h-5 text-accent" />
                <span>Download File</span>
              </button>
            )}

            {/* Preview / Open in Drive */}
            <button
              type="button"
              onClick={() => {
                const f = actionSheetItem;
                setActionSheetItem(null);
                handlePreview(f);
              }}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <ExternalLink className="w-5 h-5 text-text-secondary" />
              <span>Open in Google Drive</span>
            </button>

            {/* Rename */}
            <button
              type="button"
              onClick={() => handleStartRename(actionSheetItem)}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <Edit2 className="w-5 h-5 text-amber-400" />
              <span>Rename</span>
            </button>

            {/* Select / Deselect */}
            <button
              type="button"
              onClick={() => {
                toggleSelect(actionSheetItem.id);
                setActionSheetItem(null);
              }}
              className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <Check className="w-5 h-5 text-accent" />
              <span>
                {selectedIds.has(actionSheetItem.id)
                  ? "Remove from Selection"
                  : "Select for Batch Operation"}
              </span>
            </button>

            {/* Delete (Danger) */}
            <div className="pt-2 border-t border-glass-border">
              <button
                type="button"
                onClick={() => handleStartDelete(actionSheetItem)}
                className="flex items-center gap-3 w-full px-4 min-h-[48px] rounded-xl text-sm font-medium text-danger bg-danger/10 hover:bg-danger/20 transition-colors"
              >
                <Trash2 className="w-5 h-5" />
                <span>Delete {actionSheetItem.mimeType === "application/vnd.google-apps.folder" ? "Folder" : "File"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Dialog Modal */}
      {itemToRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setItemToRename(null)}
          />
          <div className="relative w-full max-w-sm glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-text-primary">
                Rename {itemToRename.mimeType === "application/vnd.google-apps.folder" ? "Folder" : "File"}
              </h3>
              <button
                type="button"
                onClick={() => setItemToRename(null)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConfirmRename()}
              autoFocus
              className="w-full min-h-[44px] px-4 py-2 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setItemToRename(null)}
                className="min-h-[40px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRename}
                disabled={renameMutation.isPending || !renameValue.trim()}
                className="min-h-[40px] px-4 rounded-xl text-sm font-medium bg-accent hover:bg-accent-hover text-white disabled:opacity-50 transition-colors"
              >
                {renameMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setItemToDelete(null)}
          />
          <div className="relative w-full max-w-sm glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center gap-3 text-danger">
              <div className="w-9 h-9 rounded-xl bg-danger/15 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-danger" />
              </div>
              <h3 className="text-base font-semibold text-text-primary">Confirm Deletion</h3>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-text-primary break-all">
                &ldquo;{itemToDelete.name}&rdquo;
              </span>{" "}
              from Google Drive?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="min-h-[40px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className="min-h-[40px] px-4 rounded-xl text-sm font-medium bg-danger hover:bg-danger/80 text-white disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Delete"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      {batchDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setBatchDeleteConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center gap-3 text-danger">
              <div className="w-9 h-9 rounded-xl bg-danger/15 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-danger" />
              </div>
              <h3 className="text-base font-semibold text-text-primary">
                Delete {selectedIds.size} Items
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              Are you sure you want to permanently delete all {selectedIds.size} selected items from Google Drive? This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatchDeleteConfirmOpen(false)}
                className="min-h-[40px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBatchDelete}
                disabled={batchDeleteMutation.isPending}
                className="min-h-[40px] px-4 rounded-xl text-sm font-medium bg-danger hover:bg-danger/80 text-white disabled:opacity-50 transition-colors"
              >
                {batchDeleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  `Delete (${selectedIds.size})`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Folder Dialog */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowNewFolderModal(false)}
          />
          <div className="relative w-full max-w-sm glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-text-primary">Create New Folder</h3>
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              placeholder="Folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              autoFocus
              className="w-full min-h-[44px] px-4 py-2 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="min-h-[44px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                disabled={createFolder.isPending || !newFolderName.trim()}
                className="min-h-[44px] px-4 rounded-xl text-sm font-medium bg-accent hover:bg-accent-hover text-white disabled:opacity-50 transition-colors"
              >
                {createFolder.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Create"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Local File Dialog (From VPS path) */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setUploadModalOpen(false)}
          />
          <div className="relative w-full max-w-md glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-text-primary">Upload Server File to Drive</h3>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-text-secondary">
              Enter the full file path on the server to upload to Google Drive:
            </p>
            <input
              type="text"
              placeholder="/home/boxd/Downloads/sample.iso"
              value={manualLocalPath}
              onChange={(e) => setManualLocalPath(e.target.value)}
              className="w-full min-h-[44px] px-4 py-2 rounded-xl text-sm font-mono bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="min-h-[44px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!manualLocalPath.trim()) {
                    toast.error("Please enter a server file path");
                    return;
                  }
                  setUploadModalOpen(false);
                }}
                className="min-h-[44px] px-4 rounded-xl text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* If manual path was submitted, show UploadToDriveModal */}
      {manualLocalPath && !uploadModalOpen && (
        <UploadToDriveModal
          open={!!manualLocalPath}
          onClose={() => setManualLocalPath("")}
          filePath={manualLocalPath}
        />
      )}
    </div>
  );
}
