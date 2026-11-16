import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DriveFolderPickerModal } from "./DriveFolderPickerModal";
import { useBatchUploadToDrive, useDriveDefaultPath } from "@/hooks/useDrive";
import { useAppStore } from "@/stores/appStore";
import { formatBytes } from "@/lib/utils";
import type { TorrentItem } from "@/types";
import {
  FolderOpen,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileCheck2,
} from "lucide-react";

export interface BatchUploadItem {
  filePath: string;
  name: string;
  size?: number;
  torrentHash?: string;
}

interface BatchUploadToDriveModalProps {
  open: boolean;
  onClose: () => void;
  torrents?: TorrentItem[];
  items?: BatchUploadItem[];
  allSelectedCount?: number;
  onSuccess?: () => void;
}

export function BatchUploadToDriveModal({
  open,
  onClose,
  torrents = [],
  items,
  allSelectedCount,
  onSuccess,
}: BatchUploadToDriveModalProps) {
  const driveDefaultFolderId = useAppStore((s) => s.driveDefaultFolderId);
  const driveDefaultFolderName = useAppStore((s) => s.driveDefaultFolderName);
  const setDriveDefaultFolder = useAppStore((s) => s.setDriveDefaultFolder);
  const completedDriveUploads = useAppStore((s) => s.completedDriveUploads);
  const { mutation: defaultPathMutation } = useDriveDefaultPath();

  const [targetFolderId, setTargetFolderId] = useState<string>(
    driveDefaultFolderId || "root"
  );
  const [targetFolderName, setTargetFolderName] = useState<string>(
    driveDefaultFolderName || "My Drive"
  );
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);

  const batchUploadMutation = useBatchUploadToDrive();

  // Normalize input items
  const uploadItems: BatchUploadItem[] = items && items.length > 0
    ? items
    : torrents.map((t) => ({
        filePath:
          t.content_path ||
          (t.save_path.endsWith("/")
            ? `${t.save_path}${t.name}`
            : `${t.save_path}/${t.name}`),
        torrentHash: t.hash,
        name: t.name,
        size: t.total_size,
      }));

  const totalBytes = uploadItems.reduce((acc, it) => acc + (it.size || 0), 0);
  const skippedCount =
    allSelectedCount && allSelectedCount > uploadItems.length
      ? allSelectedCount - uploadItems.length
      : 0;

  const handleUpload = () => {
    if (uploadItems.length === 0) return;

    if (setAsDefault) {
      setDriveDefaultFolder(targetFolderId, targetFolderName);
      defaultPathMutation.mutate({
        folderId: targetFolderId,
        folderName: targetFolderName,
      });
    }

    const payload = uploadItems.map((it) => ({
      filePath: it.filePath,
      torrentHash: it.torrentHash,
      name: it.name,
    }));

    batchUploadMutation.mutate(
      { items: payload, folderId: targetFolderId },
      {
        onSuccess: (data) => {
          if (data.some((r) => !r.error)) {
            onSuccess?.();
            onClose();
          }
        },
      }
    );
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Batch Upload to Google Drive" size="lg">
        <div className="space-y-4">
          {/* Summary Banner */}
          <div className="p-3.5 rounded-xl bg-surface-elevated border border-accent/30 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center text-accent">
                <FileCheck2 className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {uploadItems.length} Item{uploadItems.length > 1 ? "s" : ""} Selected
                </p>
                <p className="text-xs text-text-muted">
                  Total payload: <span className="font-mono">{formatBytes(totalBytes)}</span>
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Ready to Upload
            </span>
          </div>

          {/* Skipped incompleted notice if any */}
          {skippedCount > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>
                {skippedCount} item(s) skipped automatically.
              </span>
            </div>
          )}

          {/* Items List Preview */}
          <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
              Selected Items ({uploadItems.length})
            </p>
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 rounded-xl">
              {uploadItems.map((it, idx) => {
                const isAlreadyUploaded =
                  (it.torrentHash && completedDriveUploads[it.torrentHash]) ||
                  (it.name && completedDriveUploads[it.name]);

                return (
                  <div
                    key={it.filePath || it.torrentHash || idx}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-surface-elevated/60 border border-glass-border text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-text-primary truncate" title={it.name}>
                        {it.name}
                      </p>
                      <p className="text-text-muted font-mono text-[11px] mt-0.5">
                        {formatBytes(it.size || 0)}
                      </p>
                    </div>
                    {isAlreadyUploaded && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 flex-shrink-0">
                        <CheckCircle2 className="w-3 h-3" />
                        In Drive
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Target Folder */}
          <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
              Target Folder
            </p>
            <button
              type="button"
              onClick={() => setShowFolderPicker(true)}
              disabled={batchUploadMutation.isPending}
              className="flex items-center gap-3 w-full p-3 rounded-xl bg-surface-elevated border border-glass-border hover:border-accent/30 transition-colors text-left disabled:opacity-50"
            >
              <FolderOpen className="w-5 h-5 text-warning flex-shrink-0" />
              <span className="text-sm text-text-primary flex-1 truncate">
                {targetFolderName}
              </span>
              <span className="text-xs text-accent">Change</span>
            </button>
          </div>

          {/* Set as default checkbox */}
          <label className="flex items-center gap-3 min-h-[40px] px-1 cursor-pointer">
            <input
              type="checkbox"
              checked={setAsDefault}
              onChange={(e) => setSetAsDefault(e.target.checked)}
              disabled={batchUploadMutation.isPending}
              className="w-4 h-4 rounded accent-accent"
            />
            <span className="text-xs sm:text-sm text-text-secondary">
              Set as default upload path
            </span>
          </label>

          {/* Upload Button */}
          <button
            type="button"
            onClick={handleUpload}
            disabled={batchUploadMutation.isPending || uploadItems.length === 0}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors shadow-lg shadow-accent/20"
          >
            {batchUploadMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting Batch Upload...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload {uploadItems.length} Item{uploadItems.length > 1 ? "s" : ""} to Drive
              </>
            )}
          </button>
        </div>
      </Modal>

      <DriveFolderPickerModal
        open={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelect={(folderId, folderName) => {
          setTargetFolderId(folderId);
          setTargetFolderName(folderName);
        }}
      />
    </>
  );
}

