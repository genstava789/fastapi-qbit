import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DriveFolderPickerModal } from "./DriveFolderPickerModal";
import { useUploadToDrive, useDriveDefaultPath } from "@/hooks/useDrive";
import { useAppStore } from "@/stores/appStore";
import { File, FolderOpen, Upload, Loader2 } from "lucide-react";

interface UploadToDriveModalProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
}

export function UploadToDriveModal({ open, onClose, filePath }: UploadToDriveModalProps) {
  const driveDefaultFolderId = useAppStore((s) => s.driveDefaultFolderId);
  const driveDefaultFolderName = useAppStore((s) => s.driveDefaultFolderName);
  const setDriveDefaultFolder = useAppStore((s) => s.setDriveDefaultFolder);
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

  const handleUpload = () => {
    if (setAsDefault) {
      setDriveDefaultFolder(targetFolderId, targetFolderName);
      defaultPathMutation.mutate({
        folderId: targetFolderId,
        folderName: targetFolderName,
      });
    }

    uploadMutation.mutate(
      { filePath, folderId: targetFolderId },
      {
        onSuccess: () => {
          onClose();
        },
      }
    );
  };

  const fileName = filePath.split("/").pop() || filePath;

  return (
    <>
      <Modal open={open} onClose={onClose} title="Upload to Google Drive">
        <div className="space-y-5">
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
                Upload to Drive
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
