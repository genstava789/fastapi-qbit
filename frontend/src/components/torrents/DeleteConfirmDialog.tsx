import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { useAppStore } from "@/stores/appStore";
import { useDeleteTorrent, useBulkDeleteTorrents } from "@/hooks/useTorrents";
import { AlertTriangle } from "lucide-react";

export function DeleteConfirmDialog() {
  const hashes = useAppStore((s) => s.deleteConfirmHashes);
  const setHashes = useAppStore((s) => s.setDeleteConfirmHashes);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const deleteMutation = useDeleteTorrent();
  const bulkDeleteMutation = useBulkDeleteTorrents();
  const [deleteFiles, setDeleteFiles] = useState(false);

  if (!hashes || hashes.length === 0) return null;

  const isBulk = hashes.length > 1;
  const isPending = deleteMutation.isPending || bulkDeleteMutation.isPending;

  const handleClose = () => {
    setDeleteFiles(false);
    setHashes(null);
  };

  const handleConfirm = () => {
    if (isBulk) {
      bulkDeleteMutation.mutate(
        { hashes, deleteFiles },
        {
          onSuccess: () => {
            clearSelection();
            handleClose();
          },
        }
      );
    } else {
      deleteMutation.mutate(
        { hash: hashes[0], deleteFiles },
        {
          onSuccess: () => {
            clearSelection();
            handleClose();
          },
        }
      );
    }
  };

  return (
    <Modal
      open={hashes.length > 0}
      onClose={handleClose}
      title={isBulk ? `Delete ${hashes.length} Torrents` : "Delete Torrent"}
      size="sm"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-danger/5 border border-danger/20">
          <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-text-primary font-medium">
              {isBulk
                ? `Are you sure you want to delete ${hashes.length} selected torrents?`
                : "Are you sure you want to delete this torrent?"}
            </p>
            <p className="text-xs text-text-muted mt-1 font-mono">
              {isBulk
                ? `${hashes.length} items selected`
                : `Hash: ${hashes[0].substring(0, 16)}...`}
            </p>
          </div>
        </div>

        <label className="flex items-center gap-3 min-h-[44px] px-2 rounded-lg text-sm text-danger cursor-pointer hover:bg-danger/5">
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            className="w-5 h-5 rounded border-danger/30 bg-surface-elevated accent-danger"
          />
          <span>Also delete downloaded files from disk</span>
        </label>

        <div className="flex justify-end gap-3 pt-2 border-t border-glass-border">
          <Button variant="secondary" className="min-h-[44px]" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="min-h-[44px]"
            loading={isPending}
            onClick={handleConfirm}
          >
            {isBulk ? `Delete (${hashes.length})` : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
