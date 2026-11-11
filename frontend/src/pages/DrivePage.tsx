import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  useDriveApi,
  useDriveAuthStatus,
  useDriveFiles,
  useDriveBreadcrumb,
  useDriveStorageQuota,
  useDriveUploads,
  useCreateDriveFolder,
} from "@/hooks/useDrive";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveInstance } from "@/hooks/useTorrents";
import { formatBytes, cn } from "@/lib/utils";
import { ProgressBar, Badge, ListSkeleton, Skeleton } from "@/components/ui";
import {
  DriveAuthModal,
  UploadToDriveModal,
} from "@/components/drive";
import {
  HardDrive,
  FolderOpen,
  File,
  Download,
  ExternalLink,
  Plus,
  RefreshCw,
  LogOut,
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
} from "lucide-react";
import toast from "react-hot-toast";
import type { DriveFileItem } from "@/types";

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("video/")) return <Film className="w-4 h-4 text-purple-400 flex-shrink-0" />;
  if (mimeType.startsWith("audio/")) return <Music className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  if (mimeType.startsWith("image/")) return <ImageIcon className="w-4 h-4 text-pink-400 flex-shrink-0" />;
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("compressed") || mimeType.includes("rar")) {
    return <Archive className="w-4 h-4 text-amber-400 flex-shrink-0" />;
  }
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("text")) {
    return <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />;
  }
  return <File className="w-4 h-4 text-accent flex-shrink-0" />;
}

export function DrivePage() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [manualLocalPath, setManualLocalPath] = useState("");

  const { data: authStatus, isLoading: authLoading } = useDriveAuthStatus();
  const isAuthenticated = !!authStatus?.authenticated;

  // Auto-exchange OAuth code if redirected with ?code=...
  useEffect(() => {
    const code = searchParams.get("code");
    if (code && api) {
      const redirectUri = `${window.location.origin}/drive`;
      toast.loading("Menghubungkan akun Google Drive...", { id: "gdrive-oauth" });
      api
        .exchangeAuthCode(code, redirectUri)
        .then((res) => {
          if (res.success) {
            toast.success("Google Drive berhasil terhubung!", { id: "gdrive-oauth" });
            qc.invalidateQueries({ queryKey: ["drive-auth-status", instance?.id] });
          } else {
            toast.error(res.message || "Gagal menghubungkan Google Drive", { id: "gdrive-oauth" });
          }
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : "Gagal otorisasi", { id: "gdrive-oauth" });
        })
        .finally(() => {
          navigate("/drive", { replace: true });
        });
    }
  }, [searchParams, api, qc, instance?.id, navigate]);

  const { data: filesData, isLoading: filesLoading, refetch: refetchFiles } = useDriveFiles(
    currentFolderId,
    isAuthenticated
  );
  const { data: breadcrumb } = useDriveBreadcrumb(isAuthenticated ? currentFolderId : undefined);
  const { data: quota, isLoading: quotaLoading, refetch: refetchQuota } = useDriveStorageQuota(
    isAuthenticated
  );
  const { data: uploads } = useDriveUploads();

  const createFolder = useCreateDriveFolder();

  const handleRefresh = () => {
    refetchFiles();
    refetchQuota();
    qc.invalidateQueries({ queryKey: ["drive-uploads", instance?.id] });
    toast.success("Drive data refreshed");
  };

  const handleLogout = async () => {
    if (!api) return;
    try {
      await api.logout();
      qc.invalidateQueries({ queryKey: ["drive-auth-status", instance?.id] });
      toast.success("Disconnected from Google Drive");
    } catch {
      toast.error("Failed to disconnect");
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

  // Filter files & folders
  const filteredItems = useMemo(() => {
    if (!filesData?.files) return { folders: [], files: [] };
    const q = searchQuery.toLowerCase().trim();
    const all = q
      ? filesData.files.filter((f) => f.name.toLowerCase().includes(q))
      : filesData.files;

    const folders = all.filter((f) => f.mimeType === "application/vnd.google-apps.folder");
    const files = all.filter((f) => f.mimeType !== "application/vnd.google-apps.folder");

    return { folders, files };
  }, [filesData, searchQuery]);

  // Storage calculation
  const storagePercent = useMemo(() => {
    if (!quota || quota.limit <= 0) return 0;
    return Math.min(100, Math.max(0, (quota.usage / quota.limit) * 100));
  }, [quota]);

  if (authLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <ListSkeleton rows={5} />
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
            <h1 className="text-2xl font-bold text-text-primary">Google Drive Integration</h1>
            <p className="text-text-secondary text-sm max-w-md mx-auto leading-relaxed">
              Sambungkan akun Google Drive Anda untuk mengunggah file unduhan torrent secara langsung dari server
              tanpa melalui perangkat lokal, serta jelajahi file cloud Anda secara instan.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-6 min-h-[48px] rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-sm shadow-lg shadow-accent/25 transition-all"
          >
            <HardDrive className="w-5 h-5" />
            Hubungkan Google Drive
          </button>
        </div>
        <DriveAuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">Google Drive</h1>
            <Badge variant="success" className="gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              Connected
            </Badge>
          </div>
          <p className="text-sm text-text-secondary mt-1">
            Jelajahi file Google Drive & pantau background task upload torrent
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleRefresh}
            className="min-w-[44px] min-h-[44px] px-3 flex items-center justify-center gap-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-glass-hover text-sm font-medium transition-colors border border-glass-border"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNewFolderModal(true)}
            className="min-w-[44px] min-h-[44px] px-3 flex items-center justify-center gap-2 rounded-xl text-text-primary hover:bg-glass-hover text-sm font-medium transition-colors border border-glass-border"
          >
            <Plus className="w-4 h-4 text-accent" />
            <span>Folder Baru</span>
          </button>

          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="min-w-[44px] min-h-[44px] px-3.5 flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors shadow-lg shadow-accent/20"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload Server File</span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="min-w-[44px] min-h-[44px] px-3 flex items-center justify-center gap-2 rounded-xl text-text-muted hover:text-danger hover:bg-danger/10 text-sm font-medium transition-colors border border-glass-border"
            title="Logout / Disconnect"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Disconnect</span>
          </button>
        </div>
      </div>

      {/* Storage Quota Card */}
      <div className="glass rounded-2xl p-4 sm:p-5 border border-glass-border space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-accent" />
            <span className="text-sm font-semibold text-text-primary">Google Drive Storage</span>
          </div>
          {quota && quota.limit > 0 && (
            <span className="text-xs font-mono text-text-secondary">
              {formatBytes(quota.usage)} / {formatBytes(quota.limit)} ({storagePercent.toFixed(1)}%)
            </span>
          )}
        </div>

        {quotaLoading ? (
          <Skeleton className="h-2 w-full rounded-full" />
        ) : quota && quota.limit > 0 ? (
          <ProgressBar value={storagePercent} size="md" variant={storagePercent > 90 ? "danger" : "accent"} />
        ) : quota && quota.limit <= 0 ? (
          <div className="text-xs text-text-muted">Penyimpanan: {formatBytes(quota.usage)} digunakan (Paket Unlimited / Tidak Terbatas)</div>
        ) : null}

        {quota && (
          <div className="flex items-center gap-4 text-xs text-text-muted flex-wrap">
            <span>Di Drive: {formatBytes(quota.usageInDrive)}</span>
            <span>Di Sampah: {formatBytes(quota.usageInTrash)}</span>
          </div>
        )}
      </div>

      {/* Background Uploads Section */}
      {uploads && uploads.length > 0 && (
        <div className="glass rounded-2xl p-4 sm:p-5 border border-glass-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-accent" />
              <h2 className="text-sm font-semibold text-text-primary">Active Background Uploads</h2>
            </div>
            <Badge variant="accent">{uploads.length} Task</Badge>
          </div>

          <div className="space-y-2.5">
            {uploads.map((up) => (
              <div
                key={up.upload_id}
                className="p-3 rounded-xl bg-surface-elevated border border-glass-border space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">{up.filename}</p>
                    <p className="text-xs text-text-muted font-mono">
                      {formatBytes(up.bytes_uploaded)} / {formatBytes(up.total_bytes)}
                    </p>
                  </div>
                  <Badge
                    variant={
                      up.status === "completed"
                        ? "success"
                        : up.status === "failed"
                        ? "danger"
                        : "accent"
                    }
                  >
                    {up.status}
                  </Badge>
                </div>
                <ProgressBar
                  value={up.progress_percent}
                  size="sm"
                  showLabel
                  variant={
                    up.status === "completed"
                      ? "success"
                      : up.status === "failed"
                      ? "danger"
                      : "accent"
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Breadcrumb Path */}
        <div className="flex items-center gap-1 flex-wrap text-sm">
          <button
            type="button"
            onClick={() => setCurrentFolderId(undefined)}
            className={cn(
              "flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-xl font-medium transition-colors",
              !currentFolderId
                ? "bg-accent/15 text-accent"
                : "text-text-secondary hover:text-text-primary hover:bg-glass-hover"
            )}
          >
            <Home className="w-4 h-4" />
            <span>My Drive</span>
          </button>
          {breadcrumb?.map((crumb) => (
            <div key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
              <button
                type="button"
                onClick={() => setCurrentFolderId(crumb.id)}
                className={cn(
                  "min-h-[36px] px-2.5 rounded-xl font-medium transition-colors truncate max-w-[160px]",
                  currentFolderId === crumb.id
                    ? "bg-accent/15 text-accent"
                    : "text-text-secondary hover:text-text-primary hover:bg-glass-hover"
                )}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* Search inside folder */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Cari file / folder..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[40px] pl-9 pr-8 py-1.5 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Files & Folders Content */}
      {filesLoading ? (
        <ListSkeleton rows={6} />
      ) : (
        <div className="glass rounded-2xl border border-glass-border overflow-hidden">
          {filteredItems.folders.length === 0 && filteredItems.files.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <FolderOpen className="w-12 h-12 mx-auto text-text-muted opacity-30" />
              <p className="text-text-secondary text-sm">Folder ini kosong</p>
              <button
                type="button"
                onClick={() => setShowNewFolderModal(true)}
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
              >
                <Plus className="w-3.5 h-3.5" />
                Buat folder baru
              </button>
            </div>
          ) : (
            <div className="divide-y divide-glass-border/50">
              {/* Folders List */}
              {filteredItems.folders.map((folder) => (
                <div
                  key={folder.id}
                  onClick={() => setCurrentFolderId(folder.id)}
                  className="flex items-center justify-between gap-3 px-4 py-3 min-h-[52px] hover:bg-glass-hover/60 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <FolderOpen className="w-5 h-5 text-amber-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-text-primary truncate group-hover:text-accent transition-colors">
                      {folder.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-muted flex-shrink-0">
                    {folder.modifiedTime && (
                      <span className="hidden sm:inline">
                        {new Date(folder.modifiedTime).toLocaleDateString()}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-text-muted group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              ))}

              {/* Files List */}
              {filteredItems.files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 min-h-[52px] hover:bg-glass-hover/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {getFileIcon(file.mimeType)}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
                      <div className="flex items-center gap-2 text-xs text-text-muted font-mono">
                        {file.size !== null && <span>{formatBytes(file.size)}</span>}
                        {file.modifiedTime && (
                          <span className="hidden sm:inline">
                            · {new Date(file.modifiedTime).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePreview(file)}
                      className="min-w-[40px] min-h-[40px] px-2.5 flex items-center justify-center gap-1.5 rounded-xl text-text-secondary hover:text-text-primary hover:bg-glass-hover text-xs font-medium transition-colors"
                      title="Pratinjau di Google Drive"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span className="hidden md:inline">Pratinjau</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownload(file)}
                      className="min-w-[40px] min-h-[40px] px-2.5 flex items-center justify-center gap-1.5 rounded-xl text-accent hover:bg-accent/15 text-xs font-medium transition-colors"
                      title="Download File"
                    >
                      <Download className="w-4 h-4" />
                      <span className="hidden md:inline">Download</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
              <h3 className="text-base font-semibold text-text-primary">Buat Folder Baru</h3>
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
              placeholder="Nama folder..."
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
                Batal
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
                  "Buat"
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
              <h3 className="text-base font-semibold text-text-primary">Upload File Lokal Server ke Drive</h3>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-text-secondary">
              Masukkan path file lengkap di server VPS yang ingin diunggah ke Google Drive (atau pilih langsung dari menu File Browser):
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
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!manualLocalPath.trim()) {
                    toast.error("Masukkan path file server");
                    return;
                  }
                  // will open UploadToDriveModal with this path
                  setUploadModalOpen(false);
                }}
                className="min-h-[44px] px-4 rounded-xl text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
              >
                Lanjutkan
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
