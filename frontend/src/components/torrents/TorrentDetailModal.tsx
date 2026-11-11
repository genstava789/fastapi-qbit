import { Modal, Button, ProgressBar, Badge } from "@/components/ui";
import {
  useTorrentDetail,
  usePauseTorrent,
  useResumeTorrent,
  useApi,
} from "@/hooks/useTorrents";
import { useAppStore } from "@/stores/appStore";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  getTorrentStateLabel,
} from "@/lib/utils";
import {
  Play,
  Pause,
  Trash2,
  FileDown,
  FolderOpen,
  Hash,
  Download,
  Upload,
  HardDrive,
  Clock,
  Loader2,
} from "lucide-react";

interface TorrentDetailModalProps {
  hash: string | null;
  onClose: () => void;
}

export function TorrentDetailModal({ hash, onClose }: TorrentDetailModalProps) {
  const { data: torrent, isLoading } = useTorrentDetail(hash);
  const pauseMutation = usePauseTorrent();
  const resumeMutation = useResumeTorrent();
  const setDeleteConfirmHash = useAppStore((s) => s.setDeleteConfirmHash);
  const api = useApi();

  if (!hash) return null;

  const ratio =
    torrent && torrent.downloaded > 0
      ? (torrent.uploaded / torrent.downloaded).toFixed(2)
      : "0.00";

  return (
    <Modal open={!!hash} onClose={onClose} title="Torrent Details" size="lg">
      {isLoading || !torrent ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Title & Status */}
          <div>
            <h3 className="text-base font-semibold text-text-primary break-words">
              {torrent.name}
            </h3>
            <div className="flex items-center gap-2 mt-2">
              <Badge
                variant={
                  torrent.state.includes("UP") || torrent.state === "uploading"
                    ? "success"
                    : torrent.state === "downloading" || torrent.state === "forcedDL"
                    ? "accent"
                    : torrent.state.includes("paused")
                    ? "default"
                    : torrent.state === "error" || torrent.state === "missingFiles"
                    ? "danger"
                    : "info"
                }
              >
                {getTorrentStateLabel(torrent.state)}
              </Badge>
              <span className="text-xs text-text-muted font-mono">
                Ratio: {ratio}
              </span>
            </div>
          </div>

          {/* Progress */}
          <div className="p-4 rounded-xl bg-surface-elevated/60 border border-glass-border space-y-2">
            <div className="flex justify-between text-xs text-text-secondary">
              <span>Progress</span>
              <span className="font-mono">{torrent.progress.toFixed(2)}%</span>
            </div>
            <ProgressBar value={torrent.progress} size="md" />
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded-xl bg-surface-elevated/40 border border-glass-border">
              <p className="text-xs text-text-muted flex items-center gap-1">
                <HardDrive className="w-3.5 h-3.5" /> Total Size
              </p>
              <p className="font-mono font-semibold text-text-primary mt-1">
                {formatBytes(torrent.total_size)}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-surface-elevated/40 border border-glass-border">
              <p className="text-xs text-text-muted flex items-center gap-1">
                <Download className="w-3.5 h-3.5 text-accent" /> Downloaded
              </p>
              <p className="font-mono font-semibold text-accent mt-1">
                {formatBytes(torrent.downloaded)}
              </p>
              <p className="text-[11px] font-mono text-text-muted">
                {formatSpeed(torrent.download_speed)}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-surface-elevated/40 border border-glass-border">
              <p className="text-xs text-text-muted flex items-center gap-1">
                <Upload className="w-3.5 h-3.5 text-success" /> Uploaded
              </p>
              <p className="font-mono font-semibold text-success mt-1">
                {formatBytes(torrent.uploaded)}
              </p>
              <p className="text-[11px] font-mono text-text-muted">
                {formatSpeed(torrent.upload_speed)}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-surface-elevated/40 border border-glass-border">
              <p className="text-xs text-text-muted flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> ETA
              </p>
              <p className="font-mono font-semibold text-text-primary mt-1">
                {formatEta(torrent.eta)}
              </p>
            </div>
          </div>

          {/* Paths & Hash */}
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-elevated/30">
              <FolderOpen className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-text-muted">Save Path</p>
                <p className="font-mono text-text-primary break-all mt-0.5">
                  {torrent.save_path}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-surface-elevated/30">
              <Hash className="w-4 h-4 text-info flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-text-muted">Info Hash</p>
                <p className="font-mono text-text-primary break-all mt-0.5">
                  {torrent.hash}
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-glass-border">
            <div className="flex flex-wrap items-center gap-2">
              {torrent.state.includes("paused") ? (
                <Button
                  variant="primary"
                  size="sm"
                  className="min-h-[44px] md:min-h-0"
                  icon={<Play className="w-4 h-4" />}
                  loading={resumeMutation.isPending}
                  onClick={() => resumeMutation.mutate(torrent.hash)}
                >
                  Resume
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-[44px] md:min-h-0"
                  icon={<Pause className="w-4 h-4" />}
                  loading={pauseMutation.isPending}
                  onClick={() => pauseMutation.mutate(torrent.hash)}
                >
                  Pause
                </Button>
              )}
              {api && (
                <a
                  href={api.getExportUrl(torrent.hash)}
                  download
                  className="inline-flex items-center gap-1.5 px-3 min-h-[44px] md:min-h-0 py-1.5 text-xs font-medium rounded-lg glass glass-hover text-text-primary transition-all"
                >
                  <FileDown className="w-4 h-4" />
                  Export .torrent
                </a>
              )}
            </div>
            <Button
              variant="danger"
              size="sm"
              className="min-h-[44px] md:min-h-0"
              icon={<Trash2 className="w-4 h-4" />}
              onClick={() => {
                onClose();
                setDeleteConfirmHash(torrent.hash);
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

