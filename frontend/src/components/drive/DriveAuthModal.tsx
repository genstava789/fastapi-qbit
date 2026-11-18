import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import {
  directGetAuthUrl,
  directExchangeAuthCode,
  directTestConnection,
  getValidAccessToken,
} from "@/api/gdriveDirect";
import {
  HardDrive,
  ExternalLink,
  Loader2,
  CheckCircle,
  AlertCircle,
  Key,
  RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";

interface DriveAuthModalProps {
  open: boolean;
  onClose: () => void;
}

export function DriveAuthModal({ open, onClose }: DriveAuthModalProps) {
  const qc = useQueryClient();
  const setGDriveTokens = useAppStore((s) => s.setGDriveTokens);

  const [authMode, setAuthMode] = useState<"oauth" | "token">("oauth");
  const [authCode, setAuthCode] = useState("");
  const [directTokenInput, setDirectTokenInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const redirectUri =
    typeof window !== "undefined" ? `${window.location.origin}/drive` : undefined;

  const handleGetAuthUrl = () => {
    try {
      const url = directGetAuthUrl(redirectUri);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Failed to generate authorization URL");
    }
  };

  const handleConnectOAuth = async () => {
    if (!authCode.trim()) return;
    setLoading(true);
    setStatus("idle");
    setErrorMsg("");
    try {
      const result = await directExchangeAuthCode(
        authCode.trim(),
        redirectUri || `${window.location.origin}/drive`
      );
      if (result.success) {
        setStatus("success");
        toast.success("Google Drive connected!");
        qc.invalidateQueries({ queryKey: ["drive-auth-status"] });
        qc.invalidateQueries({ queryKey: ["drive-files"] });
        qc.invalidateQueries({ queryKey: ["drive-storage"] });
        setTimeout(() => {
          onClose();
          setAuthCode("");
          setStatus("idle");
        }, 1200);
      } else {
        setStatus("error");
        setErrorMsg(result.message || "Failed to connect");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  const handleConnectDirectToken = async () => {
    if (!directTokenInput.trim()) return;
    setLoading(true);
    setStatus("idle");
    setErrorMsg("");
    try {
      const token = directTokenInput.trim();
      setGDriveTokens({
        accessToken: token,
        expiry: Date.now() + 3500 * 1000,
      });

      // Verify connection directly
      const test = await directTestConnection();
      setStatus("success");
      toast.success(`Connected as ${test.user || test.email}!`);
      qc.invalidateQueries({ queryKey: ["drive-auth-status"] });
      qc.invalidateQueries({ queryKey: ["drive-files"] });
      qc.invalidateQueries({ queryKey: ["drive-storage"] });
      setTimeout(() => {
        onClose();
        setDirectTokenInput("");
        setStatus("idle");
      }, 1200);
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message || "Invalid token or could not verify connection with Google Drive");
    } finally {
      setLoading(false);
    }
  };

  const handleSyncFromServer = async () => {
    setLoading(true);
    setStatus("idle");
    setErrorMsg("");
    try {
      const token = await getValidAccessToken(true);
      if (token) {
        setStatus("success");
        toast.success("Google Drive token imported!");
        qc.invalidateQueries({ queryKey: ["drive-auth-status"] });
        qc.invalidateQueries({ queryKey: ["drive-files"] });
        qc.invalidateQueries({ queryKey: ["drive-storage"] });
        setTimeout(() => {
          onClose();
          setStatus("idle");
        }, 1200);
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message || "No saved token found on server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Connect Google Drive">
      <div className="space-y-5">
        {/* Icon & Info */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-accent/15 flex items-center justify-center mx-auto text-accent">
            <HardDrive className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-text-primary">
              Direct Google Drive Connection
            </h3>
            <p className="text-xs text-text-secondary mt-0.5 max-w-sm mx-auto">
              Access your Google Drive files and download directly in your browser without backend reliance.
            </p>
          </div>
        </div>

        {/* Auth Mode Toggle */}
        <div className="grid grid-cols-2 p-1 bg-surface-elevated rounded-xl border border-glass-border text-xs">
          <button
            type="button"
            onClick={() => setAuthMode("oauth")}
            className={`py-1.5 px-3 rounded-lg font-medium transition-all ${
              authMode === "oauth"
                ? "bg-accent text-white shadow-sm"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            Google OAuth Code
          </button>
          <button
            type="button"
            onClick={() => setAuthMode("token")}
            className={`py-1.5 px-3 rounded-lg font-medium transition-all ${
              authMode === "token"
                ? "bg-accent text-white shadow-sm"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            Access Token
          </button>
        </div>

        {authMode === "oauth" ? (
          <div className="space-y-4">
            {/* Step 1 */}
            <div className="space-y-1.5">
              <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
                Step 1 — Authorize with Google
              </p>
              <button
                type="button"
                onClick={handleGetAuthUrl}
                className="w-full min-h-[40px] flex items-center justify-center gap-2 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent font-medium text-xs sm:text-sm transition-colors border border-accent/20"
              >
                <ExternalLink className="w-4 h-4" />
                Open Google Authorization Window
              </button>
            </div>

            {/* Step 2 */}
            <div className="space-y-1.5">
              <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
                Step 2 — Paste Authorization Code
              </p>
              <input
                type="text"
                placeholder="Paste authorization code here (4/0A...)..."
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                className="w-full min-h-[40px] px-3.5 py-2 rounded-xl text-xs sm:text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono"
              />
            </div>

            <button
              type="button"
              onClick={handleConnectOAuth}
              disabled={loading || !authCode.trim() || status === "success"}
              className="w-full min-h-[42px] flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect with Code"
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
                Enter OAuth Access Token
              </p>
              <textarea
                rows={3}
                placeholder="ya29.a0AfH6SM..."
                value={directTokenInput}
                onChange={(e) => setDirectTokenInput(e.target.value)}
                className="w-full p-3 rounded-xl text-xs bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 font-mono resize-none"
              />
              <p className="text-[11px] text-text-muted">
                Paste an active Google Drive OAuth Access Token for direct client-side requests.
              </p>
            </div>

            <button
              type="button"
              onClick={handleConnectDirectToken}
              disabled={loading || !directTokenInput.trim() || status === "success"}
              className="w-full min-h-[42px] flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying Token...
                </>
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  Save & Connect Token
                </>
              )}
            </button>
          </div>
        )}

        {/* Sync from server shortcut */}
        <div className="pt-2 border-t border-glass-border/40">
          <button
            type="button"
            onClick={handleSyncFromServer}
            disabled={loading}
            className="w-full py-2 px-3 rounded-xl bg-surface-elevated hover:bg-glass-hover text-text-secondary hover:text-text-primary text-xs font-medium transition-colors flex items-center justify-center gap-1.5 border border-glass-border"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Sync Existing Token from Server</span>
          </button>
        </div>

        {/* Status Messages */}
        {status === "success" && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-success/10 text-success text-xs font-medium border border-success/20">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            <span>Successfully connected to Google Drive!</span>
          </div>
        )}
        {status === "error" && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-danger/10 text-danger text-xs font-medium border border-danger/20">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{errorMsg}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
