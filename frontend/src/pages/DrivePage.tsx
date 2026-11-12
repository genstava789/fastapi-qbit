import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams, useParams, useNavigate } from "react-router-dom";
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
  FolderPlus,
  File,
  Download,
  ExternalLink,
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
  CheckSquare,
  ArrowLeft,
  AlertTriangle,
  ArrowUpDown,
  LayoutList,
  LayoutGrid,
  RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import type { DriveFileItem } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileIcon(mimeType: string, compact = false) {
  const size = compact ? "w-4 h-4" : "w-5 h-5";
  if (mimeType.startsWith("video/"))
    return <Film className={cn(size, "text-purple-400 flex-shrink-0")} />;
  if (mimeType.startsWith("audio/"))
    return <Music className={cn(size, "text-emerald-400 flex-shrink-0")} />;
  if (mimeType.startsWith("image/"))
    return <ImageIcon className={cn(size, "text-pink-400 flex-shrink-0")} />;
  if (
    mimeType.includes("zip") ||
    mimeType.includes("tar") ||
    mimeType.includes("compressed") ||
    mimeType.includes("rar")
  ) {
    return <Archive className={cn(size, "text-amber-400 flex-shrink-0")} />;
  }
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("text")
  ) {
    return <FileText className={cn(size, "text-blue-400 flex-shrink-0")} />;
  }
  return <File className={cn(size, "text-accent flex-shrink-0")} />;
}

// Compact date formatting (e.g. "12 Nov" for current year, "12 Nov '25" for prior years)
function formatCompactDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const isCurrentYear = d.getFullYear() === now.getFullYear();

    const dayMonth = d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
    });

    if (isCurrentYear) {
      return dayMonth;
    }
    return `${dayMonth} '${String(d.getFullYear()).slice(-2)}`;
  } catch {
    return "";
  }
}

type SortField = "name" | "size" | "date";
type SortDir = "asc" | "desc";
type ViewMode = "list" | "grid";

function sortItems(items: DriveFileItem[], field: SortField, dir: SortDir): DriveFileItem[] {
  const multiplier = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (field === "name") {
      return multiplier * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    if (field === "size") {
      return multiplier * ((a.size ?? 0) - (b.size ?? 0));
    }
    // date
    const da = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
    const db = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
    return multiplier * (da - db);
  });
}

// ---------------------------------------------------------------------------
// Main DrivePage Component
// ---------------------------------------------------------------------------

export function DrivePage() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read current folder directly from route parameter or URL query param
  const { folderId: routeFolderId } = useParams<{ folderId?: string }>();
  const currentFolderId = routeFolderId || searchParams.get("folder") || undefined;

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
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sort & View state
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Breadcrumb horizontal scroll ref
  const breadcrumbScrollRef = useRef<HTMLDivElement>(null);

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
          toast.error(err instanceof Error ? err.message : "Otorisasi gagal", { id: "gdrive-oauth" });
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
    isError: filesError,
    error: filesErrorObj,
    refetch: refetchFiles,
  } = useDriveFiles(currentFolderId, isAuthenticated);

  const { data: breadcrumb } = useDriveBreadcrumb(
    isAuthenticated ? currentFolderId : undefined
  );

  const createFolder = useCreateDriveFolder();
  const deleteMutation = useDeleteDriveFile();
  const renameMutation = useRenameDriveFile();
  const batchDeleteMutation = useBatchDeleteDriveFiles();

  // Reset multi-select, select mode, and search when folder changes
  const [prevFolderId, setPrevFolderId] = useState(currentFolderId);
  if (prevFolderId !== currentFolderId) {
    setPrevFolderId(currentFolderId);
    setSelectedIds(new Set());
    setIsSelectMode(false);
    setSearchQuery("");
  }

  // Auto scroll breadcrumb to the right end when breadcrumb updates
  useEffect(() => {
    if (breadcrumbScrollRef.current) {
      breadcrumbScrollRef.current.scrollTo({
        left: breadcrumbScrollRef.current.scrollWidth,
        behavior: "smooth",
      });
    }
  }, [breadcrumb, currentFolderId]);

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
          toast.success(`Folder "${newFolderName.trim()}" dibuat`);
        },
      }
    );
  };

  const handleDownload = async (file: DriveFileItem) => {
    const downloadUrl = `/download.aspx?id=${file.id}&name=${encodeURIComponent(file.name)}`;
    window.location.href = downloadUrl;
  };

  const handlePreview = (file: DriveFileItem) => {
    navigate(`/file/${file.id}/${encodeURIComponent(file.name)}`);
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
          toast.success("Nama file berhasil diubah");
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
        toast.success("File berhasil dihapus");
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
        setIsSelectMode(false);
        toast.success(`${ids.length} item berhasil dihapus`);
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

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  const setSorting = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setShowSortMenu(false);
  };

  // Filter & sort files & folders
  const filteredItems = useMemo(() => {
    if (!filesData?.files) return { folders: [], files: [], all: [] };
    const q = searchQuery.toLowerCase().trim();
    const all = q
      ? filesData.files.filter((f) => f.name.toLowerCase().includes(q))
      : filesData.files;

    const folders = sortItems(
      all.filter((f) => f.mimeType === "application/vnd.google-apps.folder"),
      sortField,
      sortDir
    );
    const files = sortItems(
      all.filter((f) => f.mimeType !== "application/vnd.google-apps.folder"),
      sortField,
      sortDir
    );

    return { folders, files, all: [...folders, ...files] };
  }, [filesData, searchQuery, sortField, sortDir]);

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
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full rounded-xl" />
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
              Google Drive
            </h1>
            <p className="text-text-secondary text-sm max-w-md mx-auto leading-relaxed">
              Hubungkan akun Google Drive untuk mengunggah torrent yang selesai langsung dari server ke cloud tanpa menggunakan kuota lokal, serta menjelajahi file cloud Anda.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-6 min-h-[44px] rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-sm shadow-lg shadow-accent/25 transition-all"
          >
            <HardDrive className="w-5 h-5" />
            Hubungkan Google Drive
          </button>
        </div>
        <DriveAuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Authenticated View
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-3">
      {/* ── Tier 1: Page Header Row (No 'Connected' badge, distinct FolderPlus icon) ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center text-accent flex-shrink-0">
            <HardDrive className="w-4 h-4" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-text-primary truncate">
            Google Drive
          </h1>
        </div>

        {/* Action Buttons: distinct FolderPlus and Upload buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Create Folder button with FolderPlus icon */}
          <button
            type="button"
            onClick={() => setShowNewFolderModal(true)}
            className="min-h-[36px] px-2.5 sm:px-3 flex items-center justify-center gap-1.5 rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-primary text-xs sm:text-sm font-medium transition-colors"
            title="Buat folder baru"
            aria-label="Buat folder baru"
          >
            <FolderPlus className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="hidden sm:inline">Folder Baru</span>
          </button>

          {/* Upload server file */}
          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="min-h-[36px] px-2.5 sm:px-3 flex items-center justify-center gap-1.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs sm:text-sm font-medium transition-colors shadow-sm shadow-accent/20"
            title="Upload file dari server ke Drive"
          >
            <UploadCloud className="w-4 h-4 flex-shrink-0" />
            <span className="hidden sm:inline">Upload</span>
          </button>

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => refetchFiles()}
            disabled={filesFetching}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl bg-surface-elevated border border-glass-border text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors disabled:opacity-50"
            title="Segarkan daftar file"
            aria-label="Segarkan"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", filesFetching && "animate-spin")} />
          </button>

          {/* Settings button */}
          <button
            type="button"
            onClick={() => navigate("/drive-setting")}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl bg-surface-elevated border border-glass-border text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors"
            title="Pengaturan Drive & Penyimpanan"
            aria-label="Pengaturan Drive"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Tier 2: Sticky Path Navigation (Dedicated Full-Width Row, Swipeable) ── */}
      <div className="sticky top-14 z-20 bg-surface/95 backdrop-blur-xl border-y border-glass-border py-2 space-y-2 -mx-4 px-4 sm:-mx-6 sm:px-6">
        {/* Full-width horizontally scrollable breadcrumb */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Back/Up button if inside a subfolder */}
          {currentFolderId && (
            <button
              type="button"
              onClick={handleGoUp}
              className="flex items-center gap-1 min-h-[30px] px-2 rounded-lg bg-surface-elevated border border-glass-border text-text-secondary hover:text-text-primary hover:bg-glass-hover transition-colors flex-shrink-0 text-xs font-medium"
              title="Ke folder sebelumnya"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Naik</span>
            </button>
          )}

          {/* Horizontally scrollable breadcrumb strip */}
          <div
            ref={breadcrumbScrollRef}
            className="flex items-center gap-1 overflow-x-auto no-scrollbar scroll-smooth py-0.5 text-xs flex-1 min-w-0"
          >
            <button
              type="button"
              onClick={() => navigateToFolder(undefined)}
              className={cn(
                "flex items-center gap-1.5 min-h-[30px] px-2.5 rounded-lg font-medium transition-colors flex-shrink-0",
                !currentFolderId
                  ? "bg-accent/15 text-accent border border-accent/25"
                  : "text-text-secondary hover:text-text-primary hover:bg-glass-hover"
              )}
            >
              <Home className="w-3.5 h-3.5 flex-shrink-0" />
              <span>My Drive</span>
            </button>

            {breadcrumb?.map((crumb) => {
              const isCurrent = currentFolderId === crumb.id;
              return (
                <div key={crumb.id} className="flex items-center gap-1 flex-shrink-0">
                  <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0 opacity-60" />
                  <button
                    type="button"
                    onClick={() => navigateToFolder(crumb.id)}
                    className={cn(
                      "min-h-[30px] px-2.5 rounded-lg font-medium transition-colors whitespace-nowrap flex-shrink-0 max-w-[220px] sm:max-w-[320px] truncate",
                      isCurrent
                        ? "bg-accent/15 text-accent border border-accent/25"
                        : "text-text-secondary hover:text-text-primary hover:bg-glass-hover"
                    )}
                    title={crumb.name}
                  >
                    {crumb.name}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Tier 3: Search Bar & Mode Controls ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-0.5">
          {/* Drive file search bar */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Cari file atau folder di Drive..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-8 rounded-xl text-xs sm:text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary rounded-lg transition-colors"
                aria-label="Hapus pencarian"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Action Row: When Select Mode Active vs Normal Mode */}
          {isSelectMode ? (
            /* Active Select Mode Bar */
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/25 text-xs w-full animate-fadeIn">
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] sm:text-xs font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                />
                <span>
                  {selectedIds.size > 0
                    ? `${selectedIds.size} dipilih`
                    : `Semua (${filteredItems.all.length})`}
                </span>
              </label>

              <div className="flex items-center gap-1.5 ml-auto">
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setBatchDeleteConfirmOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-danger text-white text-[11px] font-medium shadow-sm hover:bg-danger/90 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Hapus ({selectedIds.size})</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={exitSelectMode}
                  className="px-2.5 py-1 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover text-[11px] font-medium text-text-primary transition-colors"
                >
                  Selesai
                </button>
              </div>
            </div>
          ) : (
            /* Normal Mode Toolbar Controls */
            <div className="flex items-center justify-between gap-2 text-xs text-text-muted w-full">
              {/* Left: Button to enter Select Mode and item count */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsSelectMode(true)}
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover transition-colors text-text-secondary hover:text-text-primary text-[11px] sm:text-xs font-medium"
                  title="Pilih beberapa file"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-accent" />
                  <span>Pilih</span>
                </button>
                <span className="text-[11px] text-text-muted">
                  {filteredItems.all.length} item
                </span>
              </div>

              {/* Right: Sort and View mode */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Sort Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowSortMenu(!showSortMenu)}
                    className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover transition-colors text-text-secondary hover:text-text-primary text-[11px] sm:text-xs font-medium"
                    title="Urutkan file"
                  >
                    <ArrowUpDown className="w-3 h-3 text-text-muted" />
                    <span>
                      {sortField === "name" ? "Nama" : sortField === "size" ? "Ukuran" : "Tanggal"}
                    </span>
                    <span className="text-[10px] text-accent font-bold">
                      {sortDir === "asc" ? "↑" : "↓"}
                    </span>
                  </button>

                  {showSortMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                      <div className="absolute right-0 top-9 z-50 min-w-[150px] bg-surface-overlay border border-glass-border rounded-xl shadow-2xl py-1 text-xs">
                        {(
                          [
                            ["name", "Nama"],
                            ["size", "Ukuran"],
                            ["date", "Tanggal"],
                          ] as [SortField, string][]
                        ).map(([f, label]) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setSorting(f)}
                            className={cn(
                              "w-full px-3 py-2 text-left hover:bg-glass-hover transition-colors flex items-center justify-between",
                              sortField === f ? "text-accent font-semibold bg-accent/5" : "text-text-secondary"
                            )}
                          >
                            <span>{label}</span>
                            {sortField === f && (
                              <span className="text-[10px] text-accent font-bold">
                                {sortDir === "asc" ? "A-Z / Min" : "Z-A / Max"}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* View Mode Toggle: List vs Grid */}
                <div className="flex items-center rounded-lg border border-glass-border bg-surface-elevated p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      viewMode === "list"
                        ? "bg-accent/15 text-accent shadow-sm"
                        : "text-text-muted hover:text-text-primary"
                    )}
                    title="Tampilan Daftar (List)"
                    aria-label="Tampilan Daftar"
                  >
                    <LayoutList className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    className={cn(
                      "p-1.5 rounded-md transition-colors",
                      viewMode === "grid"
                        ? "bg-accent/15 text-accent shadow-sm"
                        : "text-text-muted hover:text-text-primary"
                    )}
                    title="Tampilan Kotak (Grid)"
                    aria-label="Tampilan Kotak"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Tier 4: Files & Folders Content List / Grid ── */}
      {filesLoading || filesFetching ? (
        <ListSkeleton rows={viewMode === "grid" ? 8 : 6} />
      ) : filesError ? (
        /* Error State */
        <div className="glass rounded-2xl border border-danger/30 bg-danger/5 p-6 sm:p-8 text-center space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-danger/15 flex items-center justify-center mx-auto text-danger">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm sm:text-base font-semibold text-text-primary">
              Gagal Memuat File
            </h3>
            <p className="text-xs text-text-secondary max-w-sm mx-auto">
              {(filesErrorObj as any)?.response?.data?.detail ||
                (filesErrorObj as any)?.message ||
                "Terjadi kendala saat mengambil file dari Google Drive."}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => refetchFiles()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Coba Lagi</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/drive-setting")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-elevated border border-glass-border text-text-secondary hover:text-text-primary text-xs font-medium transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Pengaturan Drive</span>
            </button>
          </div>
        </div>
      ) : (
        <div>
          {filteredItems.folders.length === 0 && filteredItems.files.length === 0 ? (
            <div className="glass rounded-2xl border border-glass-border py-14 text-center space-y-3">
              <FolderOpen className="w-10 h-10 mx-auto text-text-muted opacity-30" />
              <p className="text-text-secondary text-sm">
                {searchQuery ? "Tidak ada file atau folder yang cocok" : "Folder ini kosong"}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-medium"
                >
                  <FolderPlus className="w-4 h-4" />
                  Buat folder baru
                </button>
              )}
            </div>
          ) : viewMode === "list" ? (
            /* ── LIST VIEW ── */
            <div className="glass rounded-2xl border border-glass-border overflow-hidden divide-y divide-glass-border/40">
              {/* Folders */}
              {filteredItems.folders.map((folder) => {
                const isSelected = selectedIds.has(folder.id);
                return (
                  <div
                    key={folder.id}
                    onClick={() => {
                      if (isSelectMode) {
                        toggleSelect(folder.id);
                      } else {
                        navigateToFolder(folder.id);
                      }
                    }}
                    className={cn(
                      "flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 min-h-[48px] transition-colors group cursor-pointer",
                      isSelected
                        ? "bg-accent/15 border-l-2 border-l-accent"
                        : "hover:bg-glass-hover/60 border-l-2 border-l-transparent"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Checkbox ONLY in Select Mode */}
                      {isSelectMode && (
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
                      )}

                      <FolderOpen className="w-5 h-5 text-amber-400 flex-shrink-0" />

                      <div className="min-w-0 flex-1">
                        {/* Long name wraps onto 2 lines cleanly without being aggressively cut off */}
                        <p
                          className="text-xs sm:text-sm font-medium text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2 leading-snug group-hover:text-accent transition-colors"
                          title={folder.name}
                        >
                          {folder.name}
                        </p>
                        <p className="text-[11px] text-text-muted leading-tight mt-0.5">
                          Folder{folder.modifiedTime ? ` · ${formatCompactDate(folder.modifiedTime)}` : ""}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionSheetItem(folder);
                      }}
                      className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors flex-shrink-0"
                      title="Opsi folder"
                      aria-label="Opsi folder"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}

              {/* Files */}
              {filteredItems.files.map((file) => {
                const isSelected = selectedIds.has(file.id);
                return (
                  <div
                    key={file.id}
                    onClick={() => {
                      if (isSelectMode) {
                        toggleSelect(file.id);
                      } else {
                        handlePreview(file);
                      }
                    }}
                    className={cn(
                      "flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 min-h-[48px] transition-colors group cursor-pointer",
                      isSelected
                        ? "bg-accent/15 border-l-2 border-l-accent"
                        : "hover:bg-glass-hover/40 border-l-2 border-l-transparent"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Checkbox ONLY in Select Mode */}
                      {isSelectMode && (
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
                      )}

                      {getFileIcon(file.mimeType, false)}

                      <div className="min-w-0 flex-1">
                        {/* Long name wraps onto 2 lines cleanly without being aggressively cut off */}
                        <p
                          className="text-xs sm:text-sm font-medium text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2 leading-snug group-hover:text-accent transition-colors"
                          title={file.name}
                        >
                          {file.name}
                        </p>
                        <p className="text-[11px] text-text-muted leading-tight mt-0.5">
                          {file.size !== null ? formatBytes(file.size) : "0 B"}
                          {file.modifiedTime ? ` · ${formatCompactDate(file.modifiedTime)}` : ""}
                        </p>
                      </div>
                    </div>

                    {/* Quick Desktop Actions + Mobile More Options */}
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePreview(file);
                        }}
                        className="hidden sm:flex min-w-[32px] min-h-[32px] items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors opacity-0 group-hover:opacity-100"
                        title="Buka di Google Drive"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(file);
                        }}
                        className="hidden sm:flex min-w-[32px] min-h-[32px] items-center justify-center rounded-lg text-accent hover:bg-accent/15 transition-colors opacity-0 group-hover:opacity-100"
                        title="Unduh file"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionSheetItem(file);
                        }}
                        className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors flex-shrink-0"
                        title="Opsi lainnya"
                        aria-label="Opsi lainnya"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── GRID VIEW ── */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
              {/* Folders */}
              {filteredItems.folders.map((folder) => {
                const isSelected = selectedIds.has(folder.id);
                return (
                  <div
                    key={folder.id}
                    onClick={() => {
                      if (isSelectMode) {
                        toggleSelect(folder.id);
                      } else {
                        navigateToFolder(folder.id);
                      }
                    }}
                    className={cn(
                      "glass rounded-xl border cursor-pointer p-3 space-y-2 transition-all group hover:shadow-md",
                      isSelected
                        ? "border-accent bg-accent/15 ring-2 ring-accent/30"
                        : "border-glass-border hover:border-glass-border/80 hover:bg-glass-hover/40"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center">
                        <FolderOpen className="w-4 h-4 text-amber-400" />
                      </div>
                      <div className="flex items-center gap-0.5">
                        {isSelectMode ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleSelect(folder.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded accent-accent cursor-pointer"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionSheetItem(folder);
                            }}
                            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p
                      className="text-xs font-medium text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2 leading-snug"
                      title={folder.name}
                    >
                      {folder.name}
                    </p>
                    <p className="text-[10px] text-text-muted leading-tight">
                      Folder{folder.modifiedTime ? ` · ${formatCompactDate(folder.modifiedTime)}` : ""}
                    </p>
                  </div>
                );
              })}

              {/* Files */}
              {filteredItems.files.map((file) => {
                const isSelected = selectedIds.has(file.id);
                return (
                  <div
                    key={file.id}
                    onClick={() => {
                      if (isSelectMode) {
                        toggleSelect(file.id);
                      } else {
                        handlePreview(file);
                      }
                    }}
                    className={cn(
                      "glass rounded-xl border cursor-pointer p-3 space-y-2 transition-all group hover:shadow-md",
                      isSelected
                        ? "border-accent bg-accent/15 ring-2 ring-accent/30"
                        : "border-glass-border hover:border-glass-border/80 hover:bg-glass-hover/40"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="w-8 h-8 rounded-lg bg-surface-elevated flex items-center justify-center">
                        {getFileIcon(file.mimeType, false)}
                      </div>
                      <div className="flex items-center gap-0.5">
                        {isSelectMode ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleSelect(file.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded accent-accent cursor-pointer"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionSheetItem(file);
                            }}
                            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover transition-colors"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p
                      className="text-xs font-medium text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2 leading-snug"
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    <p className="text-[10px] text-text-muted leading-tight">
                      {file.size !== null ? formatBytes(file.size) : "0 B"}
                      {file.modifiedTime ? ` · ${formatCompactDate(file.modifiedTime)}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Action Sheet Modal (Bottom Drawer on Mobile) ── */}
      {actionSheetItem && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setActionSheetItem(null)}
          />
          <div
            className="relative w-full bg-surface-overlay border-t border-glass-border rounded-t-3xl p-4 space-y-1.5 z-10 shadow-2xl animate-fadeIn"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
          >
            {/* Header info */}
            <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-glass-border">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary break-words [overflow-wrap:anywhere] line-clamp-2">
                  {actionSheetItem.name}
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {actionSheetItem.mimeType === "application/vnd.google-apps.folder"
                    ? "Folder"
                    : `${formatBytes(actionSheetItem.size || 0)} · ${formatCompactDate(actionSheetItem.modifiedTime)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionSheetItem(null)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl text-text-secondary hover:bg-glass-hover"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Download file action */}
            {actionSheetItem.mimeType !== "application/vnd.google-apps.folder" && (
              <button
                type="button"
                onClick={() => {
                  const f = actionSheetItem;
                  setActionSheetItem(null);
                  handleDownload(f);
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
              >
                <Download className="w-5 h-5 text-accent" />
                <span>Unduh File</span>
              </button>
            )}

            {/* Open in Drive */}
            <button
              type="button"
              onClick={() => {
                const f = actionSheetItem;
                setActionSheetItem(null);
                handlePreview(f);
              }}
              className="flex items-center gap-3 w-full px-4 min-h-[44px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <ExternalLink className="w-5 h-5 text-text-secondary" />
              <span>Buka di Google Drive</span>
            </button>

            {/* Rename */}
            <button
              type="button"
              onClick={() => handleStartRename(actionSheetItem)}
              className="flex items-center gap-3 w-full px-4 min-h-[44px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <Edit2 className="w-5 h-5 text-amber-400" />
              <span>Ganti Nama</span>
            </button>

            {/* Select / Deselect & Enter Select Mode */}
            <button
              type="button"
              onClick={() => {
                toggleSelect(actionSheetItem.id);
                setIsSelectMode(true);
                setActionSheetItem(null);
              }}
              className="flex items-center gap-3 w-full px-4 min-h-[44px] rounded-xl text-sm font-medium text-text-primary hover:bg-glass-hover transition-colors"
            >
              <Check className="w-5 h-5 text-accent" />
              <span>
                {selectedIds.has(actionSheetItem.id)
                  ? "Batalkan Pilihan"
                  : "Pilih Item Ini"}
              </span>
            </button>

            {/* Delete */}
            <div className="pt-1.5 border-t border-glass-border">
              <button
                type="button"
                onClick={() => handleStartDelete(actionSheetItem)}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] rounded-xl text-sm font-medium text-danger bg-danger/10 hover:bg-danger/20 transition-colors"
              >
                <Trash2 className="w-5 h-5" />
                <span>
                  Hapus {actionSheetItem.mimeType === "application/vnd.google-apps.folder" ? "Folder" : "File"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rename Modal ── */}
      {itemToRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setItemToRename(null)}
          />
          <div className="relative w-full max-w-sm glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-text-primary">
                Ganti Nama {itemToRename.mimeType === "application/vnd.google-apps.folder" ? "Folder" : "File"}
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
              className="w-full min-h-[42px] px-4 py-2 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setItemToRename(null)}
                className="min-h-[38px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmRename}
                disabled={renameMutation.isPending || !renameValue.trim()}
                className="min-h-[38px] px-4 rounded-xl text-sm font-medium bg-accent hover:bg-accent-hover text-white disabled:opacity-50 transition-colors"
              >
                {renameMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Simpan"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Single Delete Modal ── */}
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
              <h3 className="text-base font-semibold text-text-primary">Konfirmasi Hapus</h3>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              Apakah Anda yakin ingin menghapus permanen{" "}
              <span className="font-semibold text-text-primary break-all">
                &ldquo;{itemToDelete.name}&rdquo;
              </span>{" "}
              dari Google Drive?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="min-h-[38px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className="min-h-[38px] px-4 rounded-xl text-sm font-medium bg-danger hover:bg-danger/80 text-white disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Hapus"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Batch Delete Modal ── */}
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
                Hapus {selectedIds.size} Item
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              Apakah Anda yakin ingin menghapus permanen {selectedIds.size} item yang dipilih dari Google Drive? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatchDeleteConfirmOpen(false)}
                className="min-h-[38px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmBatchDelete}
                disabled={batchDeleteMutation.isPending}
                className="min-h-[38px] px-4 rounded-xl text-sm font-medium bg-danger hover:bg-danger/80 text-white disabled:opacity-50 transition-colors"
              >
                {batchDeleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  `Hapus (${selectedIds.size})`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create New Folder Modal ── */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowNewFolderModal(false)}
          />
          <div className="relative w-full max-w-sm glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-semibold text-text-primary">Folder Baru</h3>
              </div>
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
              className="w-full min-h-[42px] px-4 py-2 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="min-h-[38px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                disabled={createFolder.isPending || !newFolderName.trim()}
                className="min-h-[38px] px-4 rounded-xl text-sm font-medium bg-accent hover:bg-accent-hover text-white disabled:opacity-50 transition-colors"
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

      {/* ── Upload Server File Dialog (From VPS path) ── */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setUploadModalOpen(false)}
          />
          <div className="relative w-full max-w-md glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-accent" />
                <h3 className="text-base font-semibold text-text-primary">Upload File Server ke Drive</h3>
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              Masukkan path lengkap file pada server (VPS) untuk diunggah langsung ke folder Drive ini:
            </p>
            <input
              type="text"
              placeholder="/home/boxd/Downloads/file.iso"
              value={manualLocalPath}
              onChange={(e) => setManualLocalPath(e.target.value)}
              className="w-full min-h-[42px] px-4 py-2 rounded-xl text-sm font-mono bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="min-h-[38px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover"
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
                  setUploadModalOpen(false);
                }}
                className="min-h-[38px] px-4 rounded-xl text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
              >
                Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload modal triggered by manual path */}
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
