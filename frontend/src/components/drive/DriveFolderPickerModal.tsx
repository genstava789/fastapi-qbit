import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useDriveFiles, useDriveBreadcrumb, useCreateDriveFolder, useDriveDefaultPath } from "@/hooks/useDrive";
import { useAppStore } from "@/stores/appStore";
import {
  FolderOpen,
  ChevronRight,
  Plus,
  Loader2,
  Check,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DriveFolderPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (folderId: string, folderName: string) => void;
}

export function DriveFolderPickerModal({
  open,
  onClose,
  onSelect,
}: DriveFolderPickerModalProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderName, setSelectedFolderName] = useState<string>("My Drive");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [setAsDefault, setSetAsDefault] = useState(false);

  const { data: files, isLoading } = useDriveFiles(currentFolderId);
  const { data: breadcrumb } = useDriveBreadcrumb(currentFolderId);
  const createFolder = useCreateDriveFolder();
  const { setDriveDefaultFolder } = useAppStore();
  const { mutation: defaultPathMutation } = useDriveDefaultPath();

  const folders = files?.files.filter(
    (f) => f.mimeType === "application/vnd.google-apps.folder"
  );

  const handleNavigate = (folderId: string, folderName: string) => {
    setCurrentFolderId(folderId);
    setSelectedFolderId(folderId);
    setSelectedFolderName(folderName);
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolder.mutate(
      { name: newFolderName.trim(), parentId: currentFolderId },
      {
        onSuccess: () => {
          setNewFolderName("");
          setShowNewFolder(false);
        },
      }
    );
  };

  const handleSelect = () => {
    const folderId = selectedFolderId || "root";
    onSelect(folderId, selectedFolderName);
    if (setAsDefault) {
      setDriveDefaultFolder(folderId, selectedFolderName);
      defaultPathMutation.mutate({ folderId, folderName: selectedFolderName });
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Select Drive Folder" size="md">
      <div className="space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-wrap text-sm">
          <button
            type="button"
            onClick={() => {
              setCurrentFolderId(undefined);
              setSelectedFolderId(null);
              setSelectedFolderName("My Drive");
            }}
            className="flex items-center gap-1 min-h-[32px] px-2 rounded-lg text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            <span>My Drive</span>
          </button>
          {breadcrumb?.map((crumb) => (
            <div key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              <button
                type="button"
                onClick={() => handleNavigate(crumb.id, crumb.name)}
                className="min-h-[32px] px-2 rounded-lg text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors truncate max-w-[150px]"
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* Folder List */}
        <div className="min-h-[200px] max-h-[300px] overflow-y-auto rounded-xl border border-glass-border bg-surface-elevated p-1 space-y-0.5">
          {isLoading ? (
            <div className="flex items-center justify-center h-[200px]">
              <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
            </div>
          ) : folders && folders.length > 0 ? (
            folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => handleNavigate(folder.id, folder.name)}
                className={cn(
                  "flex items-center gap-3 w-full min-h-[44px] px-3 rounded-xl text-sm transition-all text-left",
                  selectedFolderId === folder.id
                    ? "bg-accent/15 text-accent border border-accent/20"
                    : "text-text-primary hover:bg-glass-hover"
                )}
              >
                <FolderOpen className="w-4 h-4 text-warning flex-shrink-0" />
                <span className="truncate flex-1">{folder.name}</span>
                <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
              </button>
            ))
          ) : (
            <div className="flex items-center justify-center h-[200px] text-text-muted text-sm">
              No subfolders here
            </div>
          )}
        </div>

        {/* Create New Folder */}
        {showNewFolder ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              autoFocus
              className="flex-1 min-h-[44px] px-4 py-2 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={createFolder.isPending || !newFolderName.trim()}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-white transition-colors"
            >
              {createFolder.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-2 min-h-[44px] px-3 rounded-xl text-sm text-accent hover:bg-accent/10 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create New Folder
          </button>
        )}

        {/* Default path toggle */}
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

        {/* Select Button */}
        <button
          type="button"
          onClick={handleSelect}
          className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-sm transition-colors"
        >
          Select "{selectedFolderName}"
        </button>
      </div>
    </Modal>
  );
}
