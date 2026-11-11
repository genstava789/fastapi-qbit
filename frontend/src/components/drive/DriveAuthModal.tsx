import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useDriveApi } from "@/hooks/useDrive";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveInstance } from "@/hooks/useTorrents";
import { HardDrive, ExternalLink, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";

interface DriveAuthModalProps {
  open: boolean;
  onClose: () => void;
}

export function DriveAuthModal({ open, onClose }: DriveAuthModalProps) {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  const [authCode, setAuthCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/drive` : undefined;

  const handleGetAuthUrl = async () => {
    if (!api) return;
    try {
      const { url } = await api.getAuthUrl(redirectUri);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Failed to get authorization URL");
    }
  };

  const handleConnect = async () => {
    if (!api || !authCode.trim()) return;
    setLoading(true);
    setStatus("idle");
    setErrorMsg("");
    try {
      const result = await api.exchangeAuthCode(authCode.trim(), redirectUri);
      if (result.success) {
        setStatus("success");
        toast.success("Google Drive connected!");
        qc.invalidateQueries({ queryKey: ["drive-auth-status", instance?.id] });
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

  return (
    <Modal open={open} onClose={onClose} title="Connect Google Drive">
      <div className="space-y-6">
        {/* Icon & Info */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-accent/15 flex items-center justify-center mx-auto">
            <HardDrive className="w-8 h-8 text-accent" />
          </div>
          <div>
            <p className="text-sm text-text-secondary">
              Connect your Google Drive to upload completed torrents directly from the server.
            </p>
          </div>
        </div>

        {/* Step 1 */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
            Step 1 — Get Authorization Code
          </p>
          <button
            type="button"
            onClick={handleGetAuthUrl}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent font-medium text-sm transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Open Google Authorization
          </button>
        </div>

        {/* Step 2 */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-text-muted font-semibold">
            Step 2 — Paste Authorization Code
          </p>
          <input
            type="text"
            placeholder="Paste authorization code here..."
            value={authCode}
            onChange={(e) => setAuthCode(e.target.value)}
            className="w-full min-h-[44px] px-4 py-2 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>

        {/* Status */}
        {status === "success" && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-success/10 text-success text-sm">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span>Successfully connected to Google Drive!</span>
          </div>
        )}
        {status === "error" && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-danger/10 text-danger text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Connect Button */}
        <button
          type="button"
          onClick={handleConnect}
          disabled={loading || !authCode.trim() || status === "success"}
          className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting...
            </>
          ) : (
            "Connect"
          )}
        </button>
      </div>
    </Modal>
  );
}
