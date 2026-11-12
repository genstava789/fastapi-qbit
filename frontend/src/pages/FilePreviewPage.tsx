import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDriveFileMeta, useDriveApi } from "@/hooks/useDrive";
import { formatBytes, formatCompactDate, cn } from "@/lib/utils";
import { Skeleton, Badge } from "@/components/ui";
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
} from "lucide-react";
import toast from "react-hot-toast";

function getFileCategory(mimeType: string, filename: string): "video" | "audio" | "image" | "pdf" | "text" | "other" {
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
  const api = useDriveApi();

  const { data: file, isLoading, error } = useDriveFileMeta(fileId);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedDownloadUrl, setCopiedDownloadUrl] = useState(false);
  const [imageError, setImageError] = useState(false);

  const displayName = file?.name || fileName || "File Preview";
  const category = getFileCategory(file?.mimeType || "", displayName);

  // Cloudflare Edge Proxy Download URL
  const proxyDownloadUrl = api && fileId
    ? api.getCloudflareProxyDownloadUrl(fileId, displayName)
    : `/download.aspx?id=${fileId}&name=${encodeURIComponent(displayName)}`;

  // Direct backend streaming URL (fallback / stream source)
  const streamUrl = api && fileId ? api.getDirectStreamUrl(fileId) : proxyDownloadUrl;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    toast.success("Link pratinjau disalin");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyDownloadUrl = () => {
    const fullUrl = new URL(proxyDownloadUrl, window.location.origin).href;
    navigator.clipboard.writeText(fullUrl);
    setCopiedDownloadUrl(true);
    toast.success("Tautan unduhan Cloudflare proxy disalin");
    setTimeout(() => setCopiedDownloadUrl(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto py-2">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <Skeleton className="h-6 w-64" />
        </div>
        <Skeleton className="w-full h-80 rounded-2xl" />
        <Skeleton className="w-full h-40 rounded-2xl" />
      </div>
    );
  }

  if (error || !file || !fileId) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-danger/15 flex items-center justify-center mx-auto text-danger">
          <FileArchive className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-text-primary">File Tidak Ditemukan</h2>
        <p className="text-sm text-text-secondary">
          Tidak dapat memuat metadata file dari Google Drive. Pastikan file ada dan akun Drive terhubung.
        </p>
        <button
          type="button"
          onClick={() => navigate("/drive")}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors shadow-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Google Drive</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* ── Top Bar: Back, Path & Quick Actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
            title="Kembali"
            aria-label="Kembali"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                to="/drive"
                className="text-xs text-text-muted hover:text-accent transition-colors flex items-center gap-1"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Google Drive</span>
              </Link>
              <span className="text-text-muted">/</span>
              <span className="text-xs text-text-secondary truncate max-w-[200px] sm:max-w-xs">
                {displayName}
              </span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-text-primary truncate max-w-md sm:max-w-xl mt-0.5">
              {displayName}
            </h1>
          </div>
        </div>

        {/* Top Right Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleCopyLink}
            className="h-9 px-3 rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-colors flex items-center gap-1.5"
            title="Salin link halaman pratinjau"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-success" /> : <Share2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Bagikan</span>
          </button>

          <a
            href={`https://drive.google.com/file/d/${file.id}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 px-3 rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-colors flex items-center gap-1.5"
            title="Buka langsung di Google Drive resmi"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Buka di Drive</span>
          </a>

          <a
            href={proxyDownloadUrl}
            download={displayName}
            className="h-9 px-3.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors shadow-sm shadow-accent/20 flex items-center gap-1.5"
            title="Unduh langsung dengan proxy Cloudflare"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </a>
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
              Browser Anda tidak mendukung pemutar video HTML5.
            </video>
          </div>
        )}

        {category === "audio" && (
          <div className="p-8 sm:p-12 text-center space-y-6 max-w-lg mx-auto">
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
              Browser Anda tidak mendukung pemutar audio HTML5.
            </audio>
          </div>
        )}

        {category === "image" && !imageError && (
          <div className="w-full flex items-center justify-center p-2 min-h-[300px]">
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
          <div className="p-8 sm:p-14 text-center space-y-5 max-w-md mx-auto">
            <div className="w-20 h-20 rounded-3xl bg-surface-elevated border border-glass-border flex items-center justify-center mx-auto shadow-xl">
              {getHeroIcon(category)}
            </div>
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-bold text-text-primary break-words [overflow-wrap:anywhere]">
                {displayName}
              </h2>
              <p className="text-xs text-text-muted">
                {file.size !== null ? formatBytes(file.size) : "Ukuran tidak diketahui"}
                {file.mimeType ? ` · ${file.mimeType}` : ""}
              </p>
            </div>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <a
                href={proxyDownloadUrl}
                download={displayName}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white text-xs sm:text-sm font-semibold hover:bg-accent-hover transition-colors shadow-lg shadow-accent/25"
              >
                <Download className="w-4 h-4" />
                <span>Unduh File Sekarang</span>
              </a>
              <a
                href={`https://drive.google.com/file/d/${file.id}/view`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-surface-elevated border border-glass-border text-text-secondary hover:text-text-primary text-xs sm:text-sm font-medium transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Buka di Drive</span>
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── Accelerated Download Card ── */}
      <div className="glass rounded-2xl p-4 sm:p-5 border border-glass-border space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center text-accent">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <span>Unduhan Cepat Cloudflare Edge</span>
                <Badge variant="accent" className="text-[10px] py-0 px-1.5 font-mono">
                  Proxy CDN
                </Badge>
              </h3>
              <p className="text-[11px] text-text-muted">
                Dialirkan melalui edge network Cloudflare dengan dukungan multithreading & pause/resume
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyDownloadUrl}
              className="h-8 px-2.5 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-colors flex items-center gap-1"
              title="Salin tautan unduhan langsung"
            >
              {copiedDownloadUrl ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              <span>Salin URL</span>
            </button>
            <a
              href={proxyDownloadUrl}
              download={displayName}
              className="h-8 px-3 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Langsung</span>
            </a>
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-surface-elevated/70 border border-glass-border text-xs font-mono text-text-muted break-all flex items-center justify-between gap-2">
          <span className="truncate">{proxyDownloadUrl}</span>
          <span className="text-[10px] text-text-muted flex-shrink-0 uppercase font-semibold">GET /download.aspx</span>
        </div>
      </div>

      {/* ── Metadata Grid ── */}
      <div className="glass rounded-2xl p-5 border border-glass-border space-y-4">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-accent" />
          <span>Informasi & Metadata File</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-surface-elevated/60 border border-glass-border">
            <span className="text-text-muted flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-accent" /> Ukuran File
            </span>
            <p className="font-mono font-semibold text-text-primary mt-1 text-sm">
              {file.size !== null ? formatBytes(file.size) : "-"}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-surface-elevated/60 border border-glass-border">
            <span className="text-text-muted flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-warning" /> Tipe Konten (MIME)
            </span>
            <p className="font-mono font-semibold text-text-primary mt-1 truncate" title={file.mimeType}>
              {file.mimeType || "application/octet-stream"}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-surface-elevated/60 border border-glass-border">
            <span className="text-text-muted flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" /> Terakhir Dimodifikasi
            </span>
            <p className="font-mono font-semibold text-text-primary mt-1">
              {file.modifiedTime ? formatCompactDate(file.modifiedTime) : "-"}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-surface-elevated/60 border border-glass-border col-span-1 sm:col-span-2 md:col-span-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-text-muted flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-purple-400" /> Google Drive File ID
              </span>
              <p className="font-mono font-semibold text-text-primary mt-1 truncate select-all">
                {file.id}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(file.id);
                toast.success("File ID disalin");
              }}
              className="self-start sm:self-auto px-2.5 py-1 rounded-lg bg-surface-elevated border border-glass-border hover:bg-glass-hover text-xs text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
            >
              <Copy className="w-3 h-3" />
              <span>Salin ID</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
export default FilePreviewPage;
