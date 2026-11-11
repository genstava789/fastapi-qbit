import { useState, useCallback, useMemo } from "react";
import { Modal, Button, Input } from "@/components/ui";
import { useAppStore } from "@/stores/appStore";
import {
  useAddMagnet,
  useAddTorrentFile,
  useServerPaths,
  useTorrents,
} from "@/hooks/useTorrents";
import { useDropzone } from "react-dropzone";
import {
  Link2,
  Upload,
  FileUp,
  Tag,
  FolderOpen,
  RefreshCw,
  ChevronRight,
  CornerLeftUp,
  Folder,
  Loader2,
  CheckCircle2,
} from "lucide-react";

export function AddTorrentModal() {
  const open = useAppStore((s) => s.addTorrentModalOpen);
  const setOpen = useAppStore((s) => s.setAddTorrentModalOpen);
  const prefill = useAppStore((s) => s.addTorrentPrefill);
  const clearPrefill = useAppStore((s) => s.clearAddTorrentPrefill);

  const addMagnet = useAddMagnet();
  const addFile = useAddTorrentFile();
  const { data: torrents } = useTorrents();

  const [tab, setTab] = useState<"magnet" | "file">("magnet");
  const [magnetUrl, setMagnetUrl] = useState("");
  const [savePath, setSavePath] = useState("");
  const [category, setCategory] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const [reseedMode, setReseedMode] = useState(false);
  const [skipChecking, setSkipChecking] = useState(false);
  const [tags, setTags] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [browsingPaths, setBrowsingPaths] = useState(false);
  const [browseTarget, setBrowseTarget] = useState<string | undefined>(undefined);

  // Sync prefill cleanly when opened from File Browser's "Seed with Torrent / Magnet"
  const [appliedPrefill, setAppliedPrefill] = useState(prefill);
  if (prefill !== appliedPrefill) {
    setAppliedPrefill(prefill);
    if (prefill) {
      if (prefill.savePath) setSavePath(prefill.savePath);
      if (prefill.reseedMode !== undefined) setReseedMode(prefill.reseedMode);
      if (prefill.skipChecking !== undefined)
        setSkipChecking(prefill.skipChecking);
    }
  }

  const {
    data: serverPaths,
    isLoading: pathsLoading,
    isError: pathsError,
  } = useServerPaths(browseTarget, open && browsingPaths);

  // Fallback known save_paths from existing torrents if backend /system/paths is unavailable
  const fallbackPaths = useMemo(() => {
    if (!torrents) return [];
    return Array.from(
      new Set(torrents.map((t) => t.save_path).filter(Boolean))
    ).sort();
  }, [torrents]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
      setTab("file");
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/x-bittorrent": [".torrent"] },
    multiple: false,
  });

  const resetForm = () => {
    setMagnetUrl("");
    setSavePath("");
    setCategory("");
    setIsPaused(false);
    setReseedMode(false);
    setSkipChecking(false);
    setTags("");
    setSelectedFile(null);
    setBrowsingPaths(false);
    setBrowseTarget(undefined);
    clearPrefill();
  };

  const handleClose = () => {
    setOpen(false);
    resetForm();
  };

  const handleSubmit = () => {
    const autoTmmValue = reseedMode ? false : undefined;
    const skipCheckingValue = reseedMode ? skipChecking : false;

    if (tab === "magnet" && magnetUrl.trim()) {
      addMagnet.mutate(
        {
          magnet_url: magnetUrl.trim(),
          save_path: savePath || undefined,
          category: category || undefined,
          is_paused: isPaused,
          tags: tags
            ? tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : undefined,
          skip_checking: skipCheckingValue,
          auto_tmm: autoTmmValue,
        },
        {
          onSuccess: handleClose,
        }
      );
    } else if (tab === "file" && selectedFile) {
      addFile.mutate(
        {
          file: selectedFile,
          options: {
            save_path: savePath || undefined,
            category: category || undefined,
            is_paused: isPaused,
            skip_checking: skipCheckingValue,
            auto_tmm: autoTmmValue,
          },
        },
        {
          onSuccess: handleClose,
        }
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={reseedMode ? "Re-Seed Local Files" : "Add Torrent"}
      size="lg"
    >
      <div className="space-y-4">
        {prefill?.title && (
          <div className="p-3 rounded-xl bg-accent/10 border border-accent/25 text-xs">
            <p className="text-accent font-semibold uppercase tracking-wider">
              Re-Seed Target
            </p>
            <p className="text-text-primary font-medium truncate mt-0.5">
              {prefill.title}
            </p>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex gap-1 p-1 rounded-xl bg-surface-elevated">
          <button
            type="button"
            onClick={() => setTab("magnet")}
            className={`flex-1 flex items-center justify-center gap-2 min-h-[42px] px-4 rounded-lg text-sm font-medium transition-all ${
              tab === "magnet"
                ? "bg-accent text-white shadow-lg"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Link2 className="w-4 h-4" /> Magnet Link
          </button>
          <button
            type="button"
            onClick={() => setTab("file")}
            className={`flex-1 flex items-center justify-center gap-2 min-h-[42px] px-4 rounded-lg text-sm font-medium transition-all ${
              tab === "file"
                ? "bg-accent text-white shadow-lg"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <FileUp className="w-4 h-4" /> Torrent File
          </button>
        </div>

        {/* Magnet Input */}
        {tab === "magnet" && (
          <Input
            label="Magnet URL"
            placeholder="magnet:?xt=urn:btih:..."
            value={magnetUrl}
            onChange={(e) => setMagnetUrl(e.target.value)}
            icon={<Link2 className="w-4 h-4" />}
          />
        )}

        {/* File Dropzone */}
        {tab === "file" && (
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              isDragActive
                ? "border-accent bg-accent/5"
                : selectedFile
                ? "border-success/30 bg-success/5"
                : "border-glass-border hover:border-accent/50"
            }`}
          >
            <input {...getInputProps()} />
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileUp className="w-8 h-8 text-success" />
                <div className="text-left">
                  <p className="text-sm font-medium text-text-primary">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-text-muted">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <Upload className="w-10 h-10 mx-auto mb-3 text-text-muted" />
                <p className="text-sm text-text-secondary">
                  Drop a .torrent file here or{" "}
                  <span className="text-accent">browse</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Re-Seed Mode Toggle */}
        <div className="p-3.5 rounded-xl bg-surface-elevated/80 border border-glass-border space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={reseedMode}
              onChange={(e) => {
                const checked = e.target.checked;
                setReseedMode(checked);
                if (!checked) setBrowsingPaths(false);
              }}
              className="w-5 h-5 mt-0.5 rounded border-glass-border bg-surface accent-accent flex-shrink-0"
            />
            <div>
              <span className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-accent" />
                Existing local files (Re-seed mode)
              </span>
              <p className="text-xs text-text-muted mt-0.5">
                Sets <code className="text-text-secondary">autoTMM=false</code> so qBittorrent uses your exact local path without moving files.
              </p>
            </div>
          </label>

          {reseedMode && (
            <label className="flex items-start gap-3 pl-8 cursor-pointer pt-2 border-t border-glass-border/60">
              <input
                type="checkbox"
                checked={skipChecking}
                onChange={(e) => setSkipChecking(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded border-glass-border bg-surface accent-accent flex-shrink-0"
              />
              <div>
                <span className="text-sm font-medium text-text-primary">
                  Skip hash check (<code className="text-xs">skip_checking</code>)
                </span>
                <p className="text-xs text-text-muted mt-0.5">
                  Start seeding immediately if files are identical. Leave unchecked to verify pieces once before seeding.
                </p>
              </div>
            </label>
          )}
        </div>

        {/* Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-secondary">
                Save Path
              </label>
              <button
                type="button"
                onClick={() => setBrowsingPaths(!browsingPaths)}
                className="text-xs font-medium text-accent hover:underline flex items-center gap-1"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {browsingPaths ? "Hide Browser" : "Browse Server Path"}
              </button>
            </div>
            <Input
              placeholder="/home/boxd/Downloads/"
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              icon={<FolderOpen className="w-4 h-4" />}
            />
          </div>

          <Input
            label="Category"
            placeholder="e.g. movies, tv"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            icon={<Tag className="w-4 h-4" />}
          />
        </div>

        {/* Server Path Browser Panel */}
        {browsingPaths && (
          <div className="rounded-xl bg-surface-elevated border border-glass-border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-glass-border">
              <p className="text-xs font-mono text-text-secondary truncate">
                {serverPaths?.current_path || "Known VPS Download Paths"}
              </p>
              {serverPaths?.current_path && (
                <button
                  type="button"
                  onClick={() => {
                    setSavePath(serverPaths.current_path);
                    setBrowsingPaths(false);
                  }}
                  className="text-xs font-medium text-emerald-400 hover:underline flex items-center gap-1 flex-shrink-0"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Use Folder
                </button>
              )}
            </div>

            {pathsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
              </div>
            ) : !pathsError && serverPaths ? (
              <div className="max-h-40 overflow-y-auto space-y-1">
                {serverPaths.parent_path && (
                  <button
                    type="button"
                    onClick={() => setBrowseTarget(serverPaths.parent_path!)}
                    className="w-full flex items-center gap-2 px-2.5 min-h-[40px] rounded-lg text-xs text-text-secondary hover:bg-glass-hover"
                  >
                    <CornerLeftUp className="w-4 h-4" /> .. (Up one level)
                  </button>
                )}
                {serverPaths.directories.map((dir) => (
                  <div
                    key={dir.path}
                    className="flex items-center justify-between gap-2 px-2.5 min-h-[40px] rounded-lg hover:bg-glass-hover"
                  >
                    <button
                      type="button"
                      onClick={() => setBrowseTarget(dir.path)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left text-xs text-text-primary"
                    >
                      <Folder className="w-4 h-4 text-warning flex-shrink-0" />
                      <span className="truncate">{dir.name}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSavePath(dir.path);
                        setBrowsingPaths(false);
                      }}
                      className="text-[11px] font-medium text-accent px-2 py-1 rounded hover:bg-accent/10"
                    >
                      Select
                    </button>
                  </div>
                ))}
                {serverPaths.directories.length === 0 && (
                  <p className="text-xs text-text-muted py-2 px-2">
                    No subdirectories inside this folder.
                  </p>
                )}
              </div>
            ) : (
              <div className="max-h-36 overflow-y-auto space-y-1">
                <p className="text-[11px] text-text-muted px-1 mb-1">
                  Quick paths from active torrents:
                </p>
                {fallbackPaths.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setSavePath(p);
                      setBrowsingPaths(false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 min-h-[40px] rounded-lg hover:bg-glass-hover text-left text-xs font-mono text-text-primary"
                  >
                    <Folder className="w-4 h-4 text-warning flex-shrink-0" />
                    <span className="truncate">{p}</span>
                  </button>
                ))}
                {fallbackPaths.length === 0 && (
                  <p className="text-xs text-text-muted px-2 py-2">
                    Enter the absolute VPS save path manually above.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "magnet" && (
          <Input
            label="Tags (comma separated)"
            placeholder="tag1, tag2"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        )}

        <label className="flex items-center gap-3 min-h-[44px] text-sm text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={isPaused}
            onChange={(e) => setIsPaused(e.target.checked)}
            className="w-5 h-5 rounded border-glass-border bg-surface-elevated accent-accent"
          />
          Add in paused state
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-glass-border">
          <Button
            variant="secondary"
            className="min-h-[44px]"
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="min-h-[44px]"
            onClick={handleSubmit}
            loading={addMagnet.isPending || addFile.isPending}
            disabled={
              (tab === "magnet" && !magnetUrl.trim()) ||
              (tab === "file" && !selectedFile)
            }
          >
            {reseedMode ? "Start Re-Seed" : "Add Torrent"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
