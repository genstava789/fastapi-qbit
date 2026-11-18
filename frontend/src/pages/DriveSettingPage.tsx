import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useDriveAuthStatus,
  useDriveStorageQuota,
  useDriveDefaultPath,
  useDriveEmptyTrash,
} from "@/hooks/useDrive";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import { formatBytes } from "@/lib/utils";
import { ProgressBar, Badge, Skeleton } from "@/components/ui";
import { DriveAuthModal, DriveFolderPickerModal } from "@/components/drive";
import { UI_STRINGS } from "@/lib/strings";
import {
  directTestConnection,
  getValidAccessToken,
} from "@/api/gdriveDirect";
import {
  HardDrive,
  FolderOpen,
  ArrowLeft,
  LogOut,
  User,
  Trash2,
  FolderSync,
  Key,
  RefreshCw,
  CheckCircle,
  ExternalLink,
  ShieldCheck,
  Save,
} from "lucide-react";
import toast from "react-hot-toast";

export function DriveSettingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const driveDefaultFolderId = useAppStore((s) => s.driveDefaultFolderId);
  const driveDefaultFolderName = useAppStore((s) => s.driveDefaultFolderName);
  const setDriveDefaultFolder = useAppStore((s) => s.setDriveDefaultFolder);

  const gdriveAccessToken = useAppStore((s) => s.gdriveAccessToken);
  const gdriveRefreshToken = useAppStore((s) => s.gdriveRefreshToken);
  const gdriveClientId = useAppStore((s) => s.gdriveClientId);
  const gdriveClientSecret = useAppStore((s) => s.gdriveClientSecret);
  const setGDriveTokens = useAppStore((s) => s.setGDriveTokens);
  const clearGDriveTokens = useAppStore((s) => s.clearGDriveTokens);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  // Manual token input states
  const [tokenInput, setTokenInput] = useState(gdriveAccessToken || "");
  const [clientIdInput, setClientIdInput] = useState(gdriveClientId || "");
  const [clientSecretInput, setClientSecretInput] = useState(gdriveClientSecret || "");
  const [refreshTokenInput, setRefreshTokenInput] = useState(gdriveRefreshToken || "");
  const [testingConnection, setTestingConnection] = useState(false);
  const [syncingFromServer, setSyncingFromServer] = useState(false);

  const { data: authStatus, isLoading: authLoading } = useDriveAuthStatus();
  const isAuthenticated = !!authStatus?.authenticated;

  const {
    data: quota,
    isLoading: quotaLoading,
    refetch: refetchQuota,
  } = useDriveStorageQuota(isAuthenticated);

  const { mutation: defaultPathMutation } = useDriveDefaultPath();
  const emptyTrashMutation = useDriveEmptyTrash();

  const storagePercent =
    quota && quota.limit > 0
      ? Math.min(100, Math.max(0, (quota.usage / quota.limit) * 100))
      : 0;

  const freeStorage =
    quota && quota.limit > 0 ? Math.max(0, quota.limit - quota.usage) : 0;

  const handleLogout = async () => {
    try {
      clearGDriveTokens();
      qc.invalidateQueries({ queryKey: ["drive-auth-status"] });
      qc.invalidateQueries({ queryKey: ["drive-storage"] });
      qc.invalidateQueries({ queryKey: ["drive-files"] });
      toast.success("Disconnected from Google Drive");
      navigate("/drive");
    } catch {
      toast.error("Failed to disconnect from Google Drive");
    }
  };

  const handleSelectDefaultFolder = (folderId: string, folderName: string) => {
    setDriveDefaultFolder(folderId, folderName);
    defaultPathMutation.mutate({ folderId, folderName });
  };

  const handleResetDefaultFolder = () => {
    setDriveDefaultFolder("root", "My Drive");
    defaultPathMutation.mutate({ folderId: "root", folderName: "My Drive" });
  };

  const handleSaveCredentials = () => {
    setGDriveTokens({
      accessToken: tokenInput.trim() || null,
      clientId: clientIdInput.trim() || null,
      clientSecret: clientSecretInput.trim() || null,
      refreshToken: refreshTokenInput.trim() || null,
      expiry: tokenInput.trim() ? Date.now() + 3500 * 1000 : null,
    });
    qc.invalidateQueries({ queryKey: ["drive-auth-status"] });
    qc.invalidateQueries({ queryKey: ["drive-storage"] });
    qc.invalidateQueries({ queryKey: ["drive-files"] });
    toast.success("Google Drive credentials saved directly in browser!");
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const res = await directTestConnection();
      toast.success(`Direct Connection Verified! Account: ${res.user} (${res.email})`);
      refetchQuota();
    } catch (err: any) {
      toast.error(`Connection test failed: ${err.message}`);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSyncFromServer = async () => {
    setSyncingFromServer(true);
    try {
      const token = await getValidAccessToken(true);
      if (token) {
        setTokenInput(token);
        const store = useAppStore.getState();
        if (store.gdriveClientId) setClientIdInput(store.gdriveClientId);
        if (store.gdriveClientSecret) setClientSecretInput(store.gdriveClientSecret);
        if (store.gdriveRefreshToken) setRefreshTokenInput(store.gdriveRefreshToken);
        toast.success("Successfully synchronized token from server!");
        qc.invalidateQueries({ queryKey: ["drive-auth-status"] });
        qc.invalidateQueries({ queryKey: ["drive-storage"] });
        qc.invalidateQueries({ queryKey: ["drive-files"] });
      }
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncingFromServer(false);
    }
  };

  if (authLoading) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto py-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-10">
      {/* Top Navigation & Title */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/drive")}
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
          title="Back to Google Drive files"
          aria-label="Back to Google Drive"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <h1 className="text-xl sm:text-2xl font-bold text-text-primary truncate">
              Google Drive Settings
            </h1>
            {isAuthenticated ? (
              <Badge variant="success" className="gap-1 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                Direct API Active
              </Badge>
            ) : (
              <Badge variant="danger" className="flex-shrink-0">
                Disconnected
              </Badge>
            )}
          </div>
          <p className="text-xs sm:text-sm text-text-secondary mt-0.5 truncate">
            Direct client-side fetch configuration, storage quota, and account management
          </p>
        </div>
      </div>

      {/* 1. Google Drive Storage Quota Card (Direct API) */}
      <div className="glass rounded-2xl p-5 border border-glass-border space-y-4 shadow-lg shadow-black/5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center text-accent">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Google Drive Storage (Direct Fetch)
              </h2>
              <p className="text-xs text-text-muted">
                Live quota directly queried from Google Drive API v3
              </p>
            </div>
          </div>
          {quota && quota.limit > 0 && (
            <span className="text-xs font-mono font-semibold text-text-primary px-2.5 py-1 rounded-lg bg-surface-elevated border border-glass-border">
              {formatBytes(quota.usage)} / {formatBytes(quota.limit)} ({storagePercent.toFixed(1)}%)
            </span>
          )}
        </div>

        {quotaLoading ? (
          <Skeleton className="h-3 w-full rounded-full" />
        ) : quota && quota.limit > 0 ? (
          <div className="space-y-2">
            <ProgressBar
              value={storagePercent}
              size="md"
              variant={storagePercent > 90 ? "danger" : "accent"}
            />
            <div className="flex items-center justify-between text-xs text-text-muted font-mono">
              <span>{storagePercent.toFixed(1)}% Used</span>
              <span>{formatBytes(freeStorage)} Free</span>
            </div>
          </div>
        ) : quota && quota.limit <= 0 ? (
          <div className="p-3 rounded-xl bg-surface-elevated text-xs text-text-secondary">
            Storage:{" "}
            <span className="font-semibold text-text-primary">
              {formatBytes(quota.usage)}
            </span>{" "}
            used (Unlimited Cloud Storage)
          </div>
        ) : (
          <p className="text-xs text-text-muted">
            Storage information will appear once connected.
          </p>
        )}

        {/* Breakdown Badges */}
        {quota && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-glass-border/50 text-xs">
            <div className="p-3 rounded-xl bg-surface-elevated/60 border border-glass-border">
              <span className="text-text-muted flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-accent" /> In Drive
              </span>
              <p className="font-mono font-semibold text-text-primary mt-1">
                {formatBytes(quota.usageInDrive)}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-surface-elevated/60 border border-glass-border flex flex-col justify-between">
              <div className="flex items-center justify-between gap-1">
                <span className="text-text-muted flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-danger" /> Trash
                </span>
                {quota.usageInTrash > 0 && (
                  <button
                    type="button"
                    disabled={emptyTrashMutation.isPending}
                    onClick={() => {
                      if (window.confirm(UI_STRINGS.driveSettings.emptyTrashConfirm)) {
                        emptyTrashMutation.mutate();
                      }
                    }}
                    className="px-2 py-0.5 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger border border-danger/20 text-[11px] font-medium transition-colors disabled:opacity-50"
                    title={UI_STRINGS.driveSettings.emptyTrashTitle}
                  >
                    {emptyTrashMutation.isPending ? "Clearing..." : "Empty"}
                  </button>
                )}
              </div>
              <p className="font-mono font-semibold text-text-primary mt-1">
                {formatBytes(quota.usageInTrash)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 2. Direct API Credentials & Token Configuration */}
      <div className="glass rounded-2xl p-5 border border-glass-border space-y-4 shadow-lg shadow-black/5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center text-purple-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Direct API & OAuth Credentials
              </h2>
              <p className="text-xs text-text-muted">
                Frontend fetches Google Drive API directly without backend routing
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSyncFromServer}
              disabled={syncingFromServer}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-surface-elevated border border-glass-border hover:bg-glass-hover text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
              title="Sync saved token from VPS backend"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingFromServer ? "animate-spin" : ""}`} />
              <span>Sync from Server</span>
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testingConnection || !isAuthenticated}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors disabled:opacity-50 shadow-sm"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{testingConnection ? "Testing..." : "Test Direct API"}</span>
            </button>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <div>
            <label className="text-xs font-semibold text-text-secondary block mb-1">
              Google Drive Access Token
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="ya29.a0AfH6SM..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="w-full h-10 px-3 pr-24 rounded-xl text-xs bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <button
                type="button"
                onClick={handleSaveCredentials}
                className="absolute right-1.5 top-1.5 bottom-1.5 px-3 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent font-medium text-xs transition-colors flex items-center gap-1"
              >
                <Save className="w-3 h-3" />
                <span>Save</span>
              </button>
            </div>
            <p className="text-[11px] text-text-muted mt-1">
              Stored securely in browser LocalStorage. All /drive requests use this token directly.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1">
                Client ID (Optional for OAuth auto-refresh)
              </label>
              <input
                type="text"
                placeholder="xxxx.apps.googleusercontent.com"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                className="w-full h-9 px-3 rounded-xl text-xs bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1">
                Client Secret (Optional)
              </label>
              <input
                type="password"
                placeholder="GOCSPX-xxxx"
                value={clientSecretInput}
                onChange={(e) => setClientSecretInput(e.target.value)}
                className="w-full h-9 px-3 rounded-xl text-xs bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 3. Default Target Folder Configuration */}
      <div className="glass rounded-2xl p-5 border border-glass-border space-y-4 shadow-lg shadow-black/5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center text-warning">
            <FolderSync className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              Default Target Folder
            </h2>
            <p className="text-xs text-text-muted">
              Google Drive folder selected for default actions and uploads
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-elevated/70 border border-glass-border space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <FolderOpen className="w-5 h-5 text-warning flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-text-muted">Current Target Folder</p>
                <p className="text-sm font-semibold text-text-primary truncate mt-0.5">
                  {driveDefaultFolderName || "My Drive (Root)"}
                </p>
                <p className="text-[11px] font-mono text-text-muted truncate mt-0.5">
                  ID: {driveDefaultFolderId || "root"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setFolderPickerOpen(true)}
                className="px-3 min-h-[38px] rounded-xl bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors shadow-sm"
              >
                Change Folder
              </button>
              {driveDefaultFolderId && driveDefaultFolderId !== "root" && (
                <button
                  type="button"
                  onClick={handleResetDefaultFolder}
                  className="px-2.5 min-h-[38px] rounded-xl text-text-muted hover:text-text-primary hover:bg-glass-hover text-xs transition-colors"
                  title="Reset to Root (My Drive)"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Account & Identity Management */}
      <div className="glass rounded-2xl p-5 border border-glass-border space-y-4 shadow-lg shadow-black/5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              Account & Identity
            </h2>
            <p className="text-xs text-text-muted">
              Connected Google identity and session management
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-surface-elevated/70 border border-glass-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {quota?.user_photo ? (
              <img
                src={quota.user_photo}
                alt="Google avatar"
                className="w-10 h-10 rounded-full border border-glass-border flex-shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-sm flex-shrink-0">
                {quota?.user_name ? quota.user_name.charAt(0).toUpperCase() : "G"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary truncate">
                {quota?.user_name || "Google Drive Account"}
              </p>
              <p className="text-xs text-text-secondary truncate mt-0.5">
                {quota?.user_email || "Direct API Session"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="px-3 min-h-[38px] rounded-xl bg-surface-elevated border border-glass-border text-text-primary hover:bg-glass-hover text-xs font-medium transition-colors"
            >
              Switch Account / Reconnect
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 min-h-[38px] rounded-xl bg-danger/10 hover:bg-danger/20 text-danger border border-danger/20 text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <DriveAuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      <DriveFolderPickerModal
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        onSelect={handleSelectDefaultFolder}
      />
    </div>
  );
}
