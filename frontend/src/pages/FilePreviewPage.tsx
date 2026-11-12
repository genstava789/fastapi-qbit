import { useMemo, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import {
  useDriveFileMeta,
  useDriveBreadcrumb,
  useDriveApi,
  useDriveAuthStatus,
  useDeleteDriveFile,
} from "@/hooks/useDrive";
import { formatBytes, formatCompactDate } from "@/lib/utils";
import { UI_STRINGS } from "@/lib/strings";
import { Skeleton, Badge } from "@/components/ui";
import type { DriveBreadcrumb } from "@/types";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Copy,
  Check,
  FileText,
  Film,
  Music,
  Image as ImageIcon,
  FileArchive,
  FileCode,
  HardDrive,
  Calendar,
  Tag,
  Hash,
  Share2,
  FolderOpen,
  Zap,
  Trash2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";

const S = UI_STRINGS.filePreview;

function getFileCategory(
  mimeType: string,
  filename: string
): "video" | "audio" | "image" | "pdf" | "text" | "other" {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  if (
    mimeType.startsWith("video/") ||
    ["mp4", "mkv", "webm", "mov", "avi", "m4v", "flv"].includes(ext)
  ) {
    return "video";
  }
  if (
    mimeType.startsWith("audio/") ||
    ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"].includes(ext)
  ) {
    return "audio";
  }
  if (
    mimeType.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext)
  ) {
    return "image";
  }
  if (mimeType === "application/pdf" || ext === "pdf") {
    return "pdf";
  }
  if (
    mimeType.startsWith("text/") ||
    [
      "txt",
      "log",
      "json",
      "md",
      "csv",
      "xml",
      "html",
      "css",
      "js",
      "ts",
      "py",
      "srt",
      "vtt",
      "nfo",
    ].includes(ext)
  ) {
    return "text";
  }
  return "other";
}

function getHeroIcon(category: string) {
  switch (category) {
    case "video":
      return <Film className="w-12 h-12 text-blue-400" />;
    case "audio":
      return <Music className="w-12 h-12 text-emerald-400" />;
    case "image":
      return <ImageIcon className="w-12 h-12 text-purple-400" />;
    case "pdf":
      return <FileText className="w-12 h-12 text-rose-400" />;
    case "text":
      return <FileCode className="w-12 h-12 text-amber-400" />;
    default:
      return <FileArchive className="w-12 h-12 text-text-muted" />;
  }
}

export function FilePreviewPage() {
  const { fileId, fileName } = useParams<{ fileId: string; fileName?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const api = useDriveApi();

  const navState = location.state as {
    fromFolderId?: string;
    fromFolderName?: string;
  } | null;

  const { data: authStatus } = useDriveAuthStatus();
  const { data: file, isLoading, error } = useDriveFileMeta(fileId);
  const deleteMutation = useDeleteDriveFile();

  const rawParentId = file?.parentId ?? file?.parents?.[0] ?? navState?.fromFolderId;
  const shouldFetchParentPath =
    Boolean(api) &&
    !file?.breadcrumbs &&
    Boolean(rawParentId) &&
    rawParentId !== "root";

  const { data: breadcrumbData } = useDriveBreadcrumb(
    shouldFetchParentPath ? rawParentId : undefined
  );

  const parentBreadcrumbs = useMemo<DriveBreadcrumb[]>(() => {
    const source: DriveBreadcrumb[] = file?.breadcrumbs ?? breadcrumbData ?? [];
    return source.filter(
      (c, idx) => !(idx === 0 && (c.id === "root" || c.name === "My Drive"))
    );
  }, [file?.breadcrumbs, breadcrumbData]);

  const resolvedParentId = useMemo(() => {
    if (parentBreadcrumbs.length > 0) {
      return parentBreadcrumbs[parentBreadcrumbs.length - 1].id;
    }
    if (rawParentId && rawParentId !== "root" && !breadcrumbData && !file?.breadcrumbs) {
      return rawParentId;
    }
    return undefined;
  }, [parentBreadcrumbs, rawParentId, breadcrumbData, file?.breadcrumbs]);

  const backToDriveUrl = resolvedParentId
    ? `/drive?folder=${encodeURIComponent(resolvedParentId)}`
    : "/drive";

  const backToDriveState = useMemo(() => {
    const folderName =
      parentBreadcrumbs.length > 0
        ? parentBreadcrumbs[parentBreadcrumbs.length - 1].name
        : navState?.fromFolderName;
    return folderName && resolvedParentId ? { folderName } : undefined;
  }, [parentBreadcrumbs, navState?.fromFolderName, resolvedParentId]);

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedDownloadUrl, setCopiedDownloadUrl] = useState(false);
  const [copiedFileId, setCopiedFileId] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const canDelete = Boolean(api && authStatus?.authenticated);
  const displayName = file?.name || fileName || S.fallbackTitle;
  const category = getFileCategory(file?.mimeType || "", displayName);

  // Cloudflare Edge Proxy Download URL: /download.aspx?id=:id&name=:name
  const proxyDownloadUrl = fileId
    ? `/download.aspx?id=${fileId}&name=${encodeURIComponent(displayName)}`
    : `/download.aspx?name=${encodeURIComponent(displayName)}`;
  const fullDownloadUrl =
    typeof window !== "undefined"
      ? new URL(proxyDownloadUrl, window.location.origin).href
      : proxyDownloadUrl;

  // Inline stream for video/audio players via Cloudflare Edge
  const streamUrl = fileId
    ? `/file/${fileId}/${encodeURIComponent(displayName)}?inline=true`
    : proxyDownloadUrl;

  const previewPageUrl = fileId
    ? `${window.location.origin}/file/${fileId}/${encodeURIComponent(displayName)}`
    : window.location.href;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(previewPageUrl);
    setCopiedLink(true);
    toast.success(S.previewLinkCopied);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyDownloadUrl = () => {
    navigator.clipboard.writeText(fullDownloadUrl);
    setCopiedDownloadUrl(true);
    toast.success(S.directDownloadUrlCopied);
    setTimeout(() => setCopiedDownloadUrl(false), 2000);
  };

  const handleCopyFileId = () => {
    if (!file?.id) return;
    navigator.clipboard.writeText(file.id);
    setCopiedFileId(true);
    toast.success(S.fileIdCopied);
    setTimeout(() => setCopiedFileId(false), 2000);
  };

  const handleConfirmDelete = () => {
    if (!file?.id) return;
    deleteMutation.mutate(file.id, {
      onSuccess: () => {
        setDeleteConfirmOpen(false);
        navigate(backToDriveUrl, { replace: true, state: backToDriveState });
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-5 max-w-5xl mx-auto py-2">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <Skeleton className="h-6 w-64" />
        </div>
        <Skeleton className="w-full h-72 rounded-2xl" />
        <Skeleton className="w-full h-28 rounded-2xl" />
        <Skeleton className="w-full h-32 rounded-2xl" />
      </div>
    );
  }

  if (error || !file || !fileId) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-danger/15 flex items-center justify-center mx-auto text-danger">
          <FileArchive className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-text-primary">{S.notFoundTitle}</h2>
        <p className="text-sm text-text-secondary">{S.notFoundDescription}</p>
        <button
          type="button"
          onClick={() => navigate("/drive")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{S.backToDrive}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5 max-w-5xl mx-auto">
      {/* ── Top Bar: Back, Parent Breadcrumb & Secondary Actions (Share, Open in Drive, Delete) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigate(backToDriveUrl, { state: backToDriveState })}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
            title={S.backTitle}
            aria-label={S.backAria}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <Link
                to="/drive"
                className="text-xs text-text-muted hover:text-accent transition-colors flex items-center gap-1 flex-shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{S.driveBreadcrumb}</span>
              </Link>
              {parentBreadcrumbs.length > 0 ? (
                parentBreadcrumbs.map((crumb, index) => (
                  <div key={crumb.id} className="flex items-center gap-1.5 min-w-0">
                    <span className="text-text-muted text-xs flex-shrink-0">/</span>
                    <Link
                      to={`/drive?folder=${encodeURIComponent(crumb.id)}`}
                      state={{ folderName: crumb.name }}
                      className={
                        index === parentBreadcrumbs.length - 1
                          ? "text-xs text-text-secondary hover:text-accent transition-colors truncate max-w-[180px] sm:max-w-xs font-medium"
                          : "text-xs text-text-muted hover:text-accent transition-colors truncate max-w-[140px]"
                      }
                      title={crumb.name}
                    >
                      {crumb.name}
                    </Link>
                  </div>
                ))
              ) : resolvedParentId && navState?.fromFolderName ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-text-muted text-xs flex-shrink-0">/</span>
                  <Link
                    to={`/drive?folder=${encodeURIComponent(resolvedParentId)}`}
                    state={{ folderName: navState.fromFolderName }}
                    className="text-xs text-text-secondary hover:text-accent transition-colors truncate max-w-[180px] sm:max-w-xs font-medium"
                  >
                    {navState.fromFolderName}
                  </Link>
                </div>
              ) : null}
            </nav>
          </div>
        </div>

        {/* Focused Secondary Actions: Share Link, Open in Drive, Delete */}
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          <button
            type="button"
            onClick={handleCopyLink}
            className="h-9 px-3 rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-colors flex items-center gap-1.5"
            title={S.shareLinkTitle}
          >
            {copiedLink ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Share2 className="w-3.5 h-3.5" />
            )}
            <span>{copiedLink ? S.copied : S.shareLink}</span>
          </button>

          <a
            href={`https://drive.google.com/file/d/${file.id}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 px-3 rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-colors flex items-center gap-1.5"
            title={S.openInDriveTitle}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{S.openInDrive}</span>
          </a>

          {canDelete && (
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              className="h-9 px-3 rounded-xl bg-danger/10 border border-danger/25 hover:bg-danger/20 text-danger text-xs font-medium transition-colors flex items-center gap-1.5"
              title={S.deleteFileTitle}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{S.deleteFile}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Interactive Preview Canvas ── */}
      <div className="glass rounded-3xl border border-glass-border overflow-hidden bg-black/40 shadow-2xl p-2 sm:p-4">
        {category === "video" && (
          <div className="w-full flex flex-col items-center justify-center">
            <video
              controls
              playsInline
              preload="metadata"
              src={streamUrl}
              className="w-full max-h-[65vh] rounded-2xl bg-black object-contain shadow-xl"
            >
              {S.videoNotSupported}
            </video>
          </div>
        )}

        {category === "audio" && (
          <div className="p-6 sm:p-12 text-center space-y-5 max-w-lg mx-auto">
            <div className="w-20 h-20 rounded-3xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 shadow-xl shadow-emerald-500/10">
              <Music className="w-10 h-10 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-text-primary truncate">
                {displayName}
              </h2>
              <p className="text-xs text-text-muted mt-1">
                {file.size !== null ? formatBytes(file.size) : ""}
              </p>
            </div>
            <audio controls preload="metadata" src={streamUrl} className="w-full rounded-xl">
              {S.audioNotSupported}
            </audio>
          </div>
        )}

        {category === "image" && !imageError && (
          <div className="w-full flex items-center justify-center p-2 min-h-[260px]">
            <img
              src={streamUrl}
              alt={displayName}
              onError={() => setImageError(true)}
              className="max-h-[65vh] max-w-full rounded-2xl object-contain shadow-2xl transition-all"
            />
          </div>
        )}

        {category === "pdf" && (
          <div className="w-full h-[65vh] rounded-2xl overflow-hidden bg-surface-elevated">
            <iframe
              src={`https://drive.google.com/file/d/${file.id}/preview`}
              title={displayName}
              className="w-full h-full border-0"
              allow="autoplay"
            />
          </div>
        )}

        {(category === "other" || category === "text" || imageError) && (
          <div className="p-6 sm:p-12 text-center space-y-4 max-w-md mx-auto">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-surface-elevated border border-glass-border flex items-center justify-center mx-auto shadow-xl">
              {getHeroIcon(category)}
            </div>
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-bold text-text-primary break-words [overflow-wrap:anywhere]">
                {displayName}
              </h2>
              <p className="text-xs text-text-muted">
                {file.size !== null ? formatBytes(file.size) : S.unknownSize}
                {file.mimeType ? ` · ${file.mimeType}` : ""}
              </p>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              {S.noInlinePreview}
            </p>
          </div>
        )}
      </div>

      {/* ── Single Download & Copy URL Action Hub: Cloudflare Edge Fast Download ── */}
      <div className="glass rounded-2xl p-3.5 sm:p-5 border border-glass-border space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center text-accent flex-shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2 flex-wrap">
                <span>{S.edgeCardTitle}</span>
                <Badge variant="accent" className="text-[10px] py-0 px-1.5 font-mono">
                  {S.edgeCardBadge}
                </Badge>
              </h3>
              <p className="text-[11px] text-text-muted mt-0.5 leading-snug">
                {S.edgeCardSubtitle}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleCopyDownloadUrl}
              className="h-10 sm:h-9 px-3 rounded-xl sm:rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
              title={S.copyUrlTitle}
            >
              {copiedDownloadUrl ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedDownloadUrl ? S.copied : S.copyUrl}</span>
            </button>
            <a
              href={proxyDownloadUrl}
              download={displayName}
              className="h-10 sm:h-9 px-3.5 rounded-xl sm:rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shadow-sm shadow-accent/20"
              title={S.directDownloadTitle}
            >
              <Download className="w-3.5 h-3.5" />
              <span>{S.directDownload}</span>
            </a>
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-surface-elevated/70 border border-glass-border text-xs font-mono text-text-muted overflow-x-auto no-scrollbar">
          <span className="whitespace-nowrap select-all">{fullDownloadUrl}</span>
        </div>
      </div>

      {/* ── Compact File Information & Metadata Card ── */}
      <div className="glass rounded-2xl p-3.5 sm:p-4 border border-glass-border space-y-2.5">
        <h3 className="text-xs sm:text-sm font-semibold text-text-primary flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-accent" />
          <span>{S.metadataTitle}</span>
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <div className="col-span-2 sm:col-span-3 px-3 py-2 rounded-xl bg-surface-elevated/60 border border-glass-border/70">
            <span className="text-[11px] text-text-muted flex items-center gap-1.5">
              <FileText className="w-3 h-3 text-accent flex-shrink-0" />
              <span>{S.fileName}</span>
            </span>
            <p className="font-semibold text-text-primary mt-0.5 text-xs sm:text-sm break-words [overflow-wrap:anywhere] leading-snug">
              {displayName}
            </p>
          </div>

          <div className="px-3 py-2 rounded-xl bg-surface-elevated/60 border border-glass-border/70">
            <span className="text-[11px] text-text-muted flex items-center gap-1.5">
              <HardDrive className="w-3 h-3 text-accent flex-shrink-0" />
              <span>{S.fileSize}</span>
            </span>
            <p className="font-mono font-semibold text-text-primary mt-0.5 text-xs sm:text-sm truncate">
              {file.size !== null ? formatBytes(file.size) : "-"}
            </p>
          </div>

          <div className="px-3 py-2 rounded-xl bg-surface-elevated/60 border border-glass-border/70">
            <span className="text-[11px] text-text-muted flex items-center gap-1.5">
              <Calendar className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              <span>{S.lastModified}</span>
            </span>
            <p className="font-mono font-semibold text-text-primary mt-0.5 text-xs sm:text-sm truncate">
              {file.modifiedTime ? formatCompactDate(file.modifiedTime) : "-"}
            </p>
          </div>

          <div className="col-span-2 sm:col-span-1 px-3 py-2 rounded-xl bg-surface-elevated/60 border border-glass-border/70 flex items-center justify-between gap-3 sm:block">
            <span className="text-[11px] text-text-muted flex items-center gap-1.5 flex-shrink-0">
              <Tag className="w-3 h-3 text-warning flex-shrink-0" />
              <span>{S.mimeType}</span>
            </span>
            <p
              className="font-mono font-semibold text-text-primary sm:mt-0.5 truncate text-right sm:text-left"
              title={file.mimeType}
            >
              {file.mimeType || "application/octet-stream"}
            </p>
          </div>

          <div className="col-span-2 sm:col-span-3 px-3 py-2 rounded-xl bg-surface-elevated/60 border border-glass-border/70 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Hash className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
              <span className="text-[11px] text-text-muted flex-shrink-0">
                {S.driveId}
              </span>
              <span className="font-mono font-semibold text-text-primary truncate select-all">
                {file.id}
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopyFileId}
              className="px-2 py-1 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1 flex-shrink-0"
              title={S.copyIdTitle}
            >
              {copiedFileId ? (
                <Check className="w-3 h-3 text-success" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span>{copiedFileId ? S.copied : S.copyId}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Delete Confirmation Modal ── */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !deleteMutation.isPending && setDeleteConfirmOpen(false)}
          />
          <div className="relative w-full max-w-sm glass bg-surface-overlay border border-glass-border rounded-2xl p-5 space-y-4 shadow-2xl z-10">
            <div className="flex items-center gap-3 text-danger">
              <div className="w-9 h-9 rounded-xl bg-danger/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-danger" />
              </div>
              <h3 className="text-base font-semibold text-text-primary">
                {S.deleteModalTitle}
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              {S.deleteModalConfirmPrefix}{" "}
              <span className="font-semibold text-text-primary break-all">
                &ldquo;{displayName}&rdquo;
              </span>{" "}
              {S.deleteModalConfirmSuffix}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleteMutation.isPending}
                className="min-h-[38px] px-4 rounded-xl text-sm text-text-secondary hover:bg-glass-hover disabled:opacity-50"
              >
                {S.cancel}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className="min-h-[38px] px-4 rounded-xl text-sm font-medium bg-danger hover:bg-danger/80 text-white disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{S.deleting}</span>
                  </>
                ) : (
                  S.confirmDelete
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FilePreviewPage;
