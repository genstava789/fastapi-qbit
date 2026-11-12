import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DriveFolderPickerModal } from "./DriveFolderPickerModal";
import { useUploadToDrive, useDriveDefaultPath } from "@/hooks/useDrive";
import { useAppStore } from "@/stores/appStore";
import { File, FolderOpen, Upload, Loader2, CheckCircle2, ExternalLink } from "lucide-react";

interface UploadToDriveModalProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
  torrentHash?: string;
}

export function UploadToDriveModal({ open, onClose, filePath, torrentHash }: UploadToDriveModalProps) {
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

  const uploadMutation = useUploadToDrive();

  const fileName = filePath.split("/").pop() || filePath;
  const existingUpload = (torrentHash && completedDriveUploads[torrentHash]) || (fileName && completedDriveUploads[fileName]);

  const handleUpload = () => {
    if (setAsDefault) {
      setDriveDefaultFolder(targetFolderId, targetFolderName);
      defaultPathMutation.mutate({
        folderId: targetFolderId,
        folderName: targetFolderName,
      });
    }

    uploadMutation.mutate(
      { filePath, folderId: targetFolderId, torrentHash },
      {
        onSuccess: () => {
          onClose();
        },
      }
    );
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Upload to Google Drive">
        <div className="space-y-5">
          {/* Duplicate Prevention Notice */}
          {existingUpload && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>This file is already uploaded to Google Drive</span>
              </div>
              <p className="text-text-secondary leading-relaxed">
                A completed upload for this file was recorded{existingUpload.completed_at ? ` on ${new Date(existingUpload.completed_at).toLocaleDateString()}` : ""}. You can view the existing file directly or proceed below to upload another copy.
              </p>
              {existingUpload.drive_file_id && (
                <a
                  href={`https://drive.google.com/open?id=${existingUpload.drive_file_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline font-medium pt-0.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open existing file in Drive
                </a>
              )}
            </div>
          )}

          {/* Selected File */}
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
              File to Upload
            </p>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-elevated border border-glass-border">
              <File className="w-5 h-5 text-accent flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary font-medium truncate">{fileName}</p>
                <p className="text-xs text-text-muted font-mono truncate">{filePath}</p>
              </div>
            </div>
          </div>

          {/* Target Folder */}
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
              Target Folder
            </p>
            <button
              type="button"
              onClick={() => setShowFolderPicker(true)}
              className="flex items-center gap-3 w-full p-3 rounded-xl bg-surface-elevated border border-glass-border hover:border-accent/30 transition-colors text-left"
            >
              <FolderOpen className="w-5 h-5 text-warning flex-shrink-0" />
              <span className="text-sm text-text-primary flex-1 truncate">
                {targetFolderName}
              </span>
              <span className="text-xs text-accent">Change</span>
            </button>
          </div>

          {/* Set as default checkbox */}
          <label className="flex items-center gap-3 min-h-[44px] px-1 cursor-pointer">
            <input
              type="checkbox"
              checked={setAsDefault}
              onChange={(e) => setSetAsDefault(e.target.checked)}
              className="w-4 h-4 rounded accent-accent"
            />
            <span className="text-sm text-text-secondary">
              Set as default upload path
            </span>
          </label>

          {/* Upload Button */}
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploadMutation.isPending}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting Upload...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                {existingUpload ? "Re-upload to Drive" : "Upload to Drive"}
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
