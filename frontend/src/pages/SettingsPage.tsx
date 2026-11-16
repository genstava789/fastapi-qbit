import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { useActiveInstance, useSystemStats, useHealth } from "@/hooks/useTorrents";
import { formatBytes, formatUptime } from "@/lib/utils";
import { Button, Input, SystemCardSkeleton } from "@/components/ui";
import {
  Server,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Globe,
  Cpu,
  HardDrive,
  MemoryStick,
  Clock,
  Terminal,
  RefreshCw,
  AlertCircle,
  FolderSync,
  UploadCloud,
  Link,
  FileText,
  CheckCircle2,
} from "lucide-react";
import type { Instance, RcloneConfigResponse } from "@/types";
import { RcloneApi } from "@/api/client";

const COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#38bdf8",
  "#ec4899",
  "#14b8a6",
];

function SystemResourcesCard() {
  const activeInstance = useActiveInstance();
  const { data: health } = useHealth();
  const {
    data: stats,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useSystemStats();

  if (!activeInstance) return null;

  const isOnline = !!stats || !!health?.qbittorrent_connected;
  const freeDiskPct = stats && stats.disk_total_bytes > 0
    ? (stats.disk_free_bytes / stats.disk_total_bytes) * 100
    : 100;
  const diskBarColor =
    freeDiskPct < 10
      ? "bg-danger"
      : freeDiskPct < 20
      ? "bg-warning"
      : "bg-emerald-500";

  return (
    <div className="glass rounded-xl p-5 space-y-4">
      {/* Header Kartu */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-glass-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              isOnline
                ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)]"
                : "bg-danger"
            }`}
          />
          <h2 className="text-base sm:text-lg font-semibold text-text-primary truncate">
            {stats?.hostname || activeInstance.name} —{" "}
            <span className={isOnline ? "text-emerald-400" : "text-danger"}>
              {isOnline ? "Online" : "Offline"}
            </span>
          </h2>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-glass-hover text-text-secondary hover:text-text-primary transition-colors"
          aria-label="Refresh system stats"
          title="Refresh system stats"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {isLoading ? (
        <SystemCardSkeleton />
      ) : isError || !stats ? (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-surface-elevated/80 border border-glass-border text-sm">
          <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-text-primary">
              Endpoint `/api/v1/system/stats` belum aktif di host ini
            </p>
            <p className="text-xs text-text-secondary leading-relaxed">
              Deploy pembaruan backend FastAPI (`app/api/v1/endpoints/system.py`) ke server VPS Anda ({activeInstance.url}) untuk memantau CPU, RAM, Disk Storage, Uptime, dan IP host secara real-time.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* OS & Mesin (1 Baris Ringkas) */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-text-secondary bg-surface-elevated/70 px-3.5 py-2.5 rounded-xl border border-glass-border">
            <span className="font-medium text-text-primary">
              {stats.os_name} • {stats.architecture}
            </span>
            <span className="flex items-center gap-1.5 font-mono text-text-secondary">
              <Terminal className="w-3.5 h-3.5 text-accent" />
              {stats.active_user}
            </span>
          </div>

          {/* Resource Bars Bertingkat */}
          <div className="space-y-3.5">
            {/* CPU */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="flex items-center gap-1.5 font-medium text-text-secondary">
                  <Cpu className="w-4 h-4 text-sky-400" />
                  CPU
                </span>
                <span className="font-mono font-semibold text-text-primary">
                  {stats.cpu_percent.toFixed(1)}% ({stats.cpu_cores}{" "}
                  {stats.cpu_cores === 1 ? "Core" : "Cores"})
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-surface-elevated overflow-hidden">
                <div
                  className="h-full rounded-full bg-sky-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(2, stats.cpu_percent))}%` }}
                />
              </div>
            </div>

            {/* RAM */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="flex items-center gap-1.5 font-medium text-text-secondary">
                  <MemoryStick className="w-4 h-4 text-purple-400" />
                  RAM
                </span>
                <span className="font-mono font-semibold text-text-primary">
                  {formatBytes(stats.ram_used_bytes)} /{" "}
                  {formatBytes(stats.ram_total_bytes)} ({stats.ram_percent.toFixed(0)}%)
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-surface-elevated overflow-hidden">
                <div
                  className="h-full rounded-full bg-purple-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(2, stats.ram_percent))}%` }}
                />
              </div>
            </div>

            {/* Disk Storage */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="flex items-center gap-1.5 font-medium text-text-secondary">
                  <HardDrive className="w-4 h-4 text-emerald-400" />
                  Disk Storage
                </span>
                <span className="font-mono font-semibold text-text-primary">
                  {formatBytes(stats.disk_free_bytes)} /{" "}
                  {formatBytes(stats.disk_total_bytes)} Free
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-surface-elevated overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${diskBarColor}`}
                  style={{ width: `${Math.min(100, Math.max(2, stats.disk_percent))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Footer: Uptime & Host IP */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-glass-border text-xs sm:text-sm">
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-elevated/50">
              <span className="flex items-center gap-1.5 text-text-secondary">
                <Clock className="w-3.5 h-3.5 text-accent" />
                Uptime
              </span>
              <span className="font-mono font-semibold text-text-primary">
                {formatUptime(stats.uptime_seconds)}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-elevated/50">
              <span className="flex items-center gap-1.5 text-text-secondary">
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                Host IP
              </span>
              <span className="font-mono font-semibold text-text-primary">
                {stats.public_ip || "Unavailable"}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RcloneConfigCard() {
  const activeInstance = useActiveInstance();
  const [config, setConfig] = useState<RcloneConfigResponse | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [activeTab, setActiveTab] = useState<"url" | "upload">("url");
  const [urlInput, setUrlInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const api = useMemo(() => {
    if (!activeInstance) return null;
    return new RcloneApi(activeInstance.url, activeInstance.apiPrefix);
  }, [activeInstance]);

  const loadConfig = useCallback(async () => {
    if (!api) return;
    setIsFetching(true);
    try {
      const data = await api.getConfig();
      setConfig(data);
    } catch (err: any) {
      console.error("Failed to load rclone config:", err);
    } finally {
      setIsFetching(false);
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    if (api) {
      setIsFetching(true);
      api
        .getConfig()
        .then((data) => {
          if (active) setConfig(data);
        })
        .catch((err) => {
          console.error("Failed to load rclone config:", err);
        })
        .finally(() => {
          if (active) setIsFetching(false);
        });
    }
    return () => {
      active = false;
    };
  }, [api]);

  if (!activeInstance) return null;

  const handleSaveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api || !urlInput.trim()) return;
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await api.saveConfigFromUrl(urlInput.trim());
      setConfig(res);
      setStatusMessage({
        type: "success",
        text:
          res.message ||
          `Konfigurasi rclone berhasil disimpan (${res.remotes.length} remote terdeteksi).`,
      });
      setUrlInput("");
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text:
          err.response?.data?.detail ||
          err.message ||
          "Gagal mengunduh atau memproses rclone.conf dari URL.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUploadFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api || !selectedFile) return;
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await api.uploadConfigFile(selectedFile);
      setConfig(res);
      setStatusMessage({
        type: "success",
        text:
          res.message ||
          `File ${selectedFile.name} berhasil diunggah (${res.remotes.length} remote terdeteksi).`,
      });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text:
          err.response?.data?.detail ||
          err.message ||
          "Gagal mengunggah konfigurasi rclone.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!api) return;
    if (
      !window.confirm(
        "Apakah Anda yakin ingin menghapus file konfigurasi rclone ini?"
      )
    )
      return;
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await api.deleteConfig();
      setConfig(res);
      setStatusMessage({
        type: "success",
        text: "Konfigurasi rclone berhasil dihapus.",
      });
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text:
          err.response?.data?.detail ||
          err.message ||
          "Gagal menghapus konfigurasi rclone.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-glass-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <FolderSync className="w-5 h-5 text-accent flex-shrink-0" />
          <h2 className="text-base sm:text-lg font-semibold text-text-primary">
            Rclone Configuration
          </h2>
          {config?.configured ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3" />
              Active ({config.remotes.length} Remotes)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-elevated text-text-muted border border-glass-border">
              <AlertCircle className="w-3 h-3" />
              Not Configured
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => loadConfig()}
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-glass-hover text-text-secondary hover:text-text-primary transition-colors"
          aria-label="Refresh rclone config"
          title="Refresh rclone config"
        >
          <RefreshCw
            className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Status or Alert Message */}
      {statusMessage && (
        <div
          className={`flex items-start justify-between gap-2 p-3 rounded-xl border text-sm ${
            statusMessage.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
              : "bg-danger/10 border-danger/20 text-red-300"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-danger" />
            )}
            <span className="text-xs sm:text-sm">{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-text-muted hover:text-text-primary p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Configured Details */}
      {config?.configured && (
        <div className="space-y-3 p-4 rounded-xl bg-surface-elevated/70 border border-glass-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-medium text-text-primary">
              Configured Remotes
            </span>
            <div className="flex items-center gap-3 text-xs text-text-secondary">
              {config.file_size > 0 && (
                <span>
                  Size:{" "}
                  <span className="font-mono text-text-primary">
                    {formatBytes(config.file_size)}
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSubmitting}
                className="flex items-center gap-1 text-danger hover:underline text-xs"
              >
                <Trash2 className="w-3 h-3" />
                Remove Config
              </button>
            </div>
          </div>

          {config.remotes.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {config.remotes_detail && config.remotes_detail.length > 0
                ? config.remotes_detail.map((remote) => (
                    <div
                      key={remote.name}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-elevated border border-glass-border font-mono text-xs text-text-primary"
                    >
                      <span className="font-semibold text-accent">
                        {remote.name}:
                      </span>
                      {remote.type && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/20 text-accent font-sans">
                          {remote.type}
                        </span>
                      )}
                    </div>
                  ))
                : config.remotes.map((name) => (
                    <div
                      key={name}
                      className="px-2.5 py-1 rounded-lg bg-surface-elevated border border-glass-border font-mono text-xs font-semibold text-accent"
                    >
                      {name}:
                    </div>
                  ))}
            </div>
          ) : (
            <p className="text-xs text-text-secondary italic">
              File rclone.conf terpasang tetapi belum ada remote yang didefinisikan.
            </p>
          )}
        </div>
      )}

      {/* Setup Methods */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <p className="text-xs sm:text-sm font-medium text-text-secondary">
            {config?.configured
              ? "Perbarui Konfigurasi (rclone.conf)"
              : "Pasang Konfigurasi (rclone.conf)"}
          </p>
        </div>

        {/* Method Segmented Tabs */}
        <div className="flex gap-1.5 p-1 rounded-xl bg-surface-elevated/80 border border-glass-border">
          <button
            type="button"
            onClick={() => setActiveTab("url")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === "url"
                ? "bg-accent text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Link className="w-3.5 h-3.5" />
            GitHub / Gist URL
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === "upload"
                ? "bg-accent text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Upload File
          </button>
        </div>

        {/* Tab 1: URL Method */}
        {activeTab === "url" && (
          <form onSubmit={handleSaveUrl} className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Input
                label="Raw GitHub / Gist URL"
                placeholder="https://gist.githubusercontent.com/.../raw/rclone.conf"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                icon={<Link className="w-4 h-4" />}
              />
              <p className="text-[11px] text-text-muted leading-relaxed">
                Mendukung tautan GitHub Raw, Gist Raw, atau link gist/github biasa (akan otomatis dikonversi ke raw URL).
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isSubmitting || !urlInput.trim()}
                icon={
                  isSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )
                }
              >
                {isSubmitting ? "Mengunduh & Menyimpan..." : "Unduh & Simpan Config"}
              </Button>
            </div>
          </form>
        )}

        {/* Tab 2: Upload File Method */}
        {activeTab === "upload" && (
          <form onSubmit={handleUploadFile} className="space-y-3 pt-1">
            <input
              ref={fileInputRef}
              type="file"
              accept=".conf,.txt,*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setSelectedFile(file);
              }}
            />

            {!selectedFile ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-glass-border hover:border-accent/50 rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors bg-surface-elevated/40"
              >
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div className="text-center">
                  <p className="text-xs sm:text-sm font-medium text-text-primary">
                    Klik untuk memilih file{" "}
                    <span className="text-accent font-mono">rclone.conf</span>
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Mendukung ekstensi .conf atau file teks konfigurasi
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-elevated/80 border border-glass-border">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-accent flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-text-primary truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-[10px] text-text-muted font-mono">
                      {formatBytes(selectedFile.size)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="p-1 hover:bg-glass-hover rounded-lg text-text-muted hover:text-danger transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isSubmitting || !selectedFile}
                icon={
                  isSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )
                }
              >
                {isSubmitting ? "Mengunggah..." : "Unggah & Simpan Config"}
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Bot Shell Integration Hint */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-elevated/60 border border-glass-border text-xs text-text-secondary">
        <Terminal className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <div className="space-y-0.5 leading-relaxed">
          <p className="font-medium text-text-primary">Integrasi Bot Telegram</p>
          <p className="text-text-muted text-[11px]">
            Konfigurasi rclone ini otomatis dibaca saat menjalankan perintah{" "}
            <code className="px-1 py-0.5 bg-surface-elevated rounded text-accent font-mono text-[10px]">
              /shell rclone &lt;perintah&gt;
            </code>{" "}
            pada Telegram bot tanpa perlu menyisipkan flag{" "}
            <code className="text-text-primary font-mono text-[10px]">
              --config
            </code>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const instances = useAppStore((s) => s.instances);
  const addInstance = useAppStore((s) => s.addInstance);
  const removeInstance = useAppStore((s) => s.removeInstance);
  const updateInstance = useAppStore((s) => s.updateInstance);

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    url: "",
    apiPrefix: "/api/v1",
    color: COLORS[0],
  });

  const handleAdd = () => {
    if (!form.name || !form.url) return;
    addInstance({
      id: crypto.randomUUID(),
      name: form.name,
      url: form.url.replace(/\/$/, ""),
      apiPrefix: form.apiPrefix,
      color: form.color,
    });
    setForm({ name: "", url: "", apiPrefix: "/api/v1", color: COLORS[0] });
    setShowAdd(false);
  };

  const handleUpdate = (id: string) => {
    updateInstance(id, {
      name: form.name,
      url: form.url.replace(/\/$/, ""),
      apiPrefix: form.apiPrefix,
      color: form.color,
    });
    setEditingId(null);
  };

  const startEdit = (inst: Instance) => {
    setEditingId(inst.id);
    setForm({
      name: inst.name,
      url: inst.url,
      apiPrefix: inst.apiPrefix,
      color: inst.color || COLORS[0],
    });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary mt-1">
          Manage qBittorrent instances, monitor VPS resources, and view app details
        </p>
      </div>

      {/* 1. Instances */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Server className="w-5 h-5 text-accent" />
            Instances
          </h2>
          <Button
            variant="primary"
            size="sm"
            className="min-h-[44px] md:min-h-0"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => {
              setShowAdd(true);
              setForm({ name: "", url: "", apiPrefix: "/api/v1", color: COLORS[0] });
            }}
          >
            Add Instance
          </Button>
        </div>

        {/* Instance List */}
        <div className="space-y-3">
          {instances.map((inst) => (
            <div key={inst.id} className="glass rounded-xl p-4">
              {editingId === inst.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Name"
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      icon={<Server className="w-4 h-4" />}
                    />
                    <Input
                      label="URL"
                      value={form.url}
                      onChange={(e) =>
                        setForm({ ...form, url: e.target.value })
                      }
                      icon={<Globe className="w-4 h-4" />}
                    />
                  </div>
                  <Input
                    label="API Prefix"
                    value={form.apiPrefix}
                    onChange={(e) =>
                      setForm({ ...form, apiPrefix: e.target.value })
                    }
                  />
                  <div>
                    <p className="text-xs text-text-muted mb-1.5">Color</p>
                    <div className="flex gap-2">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setForm({ ...form, color: c })}
                          className={`w-7 h-7 rounded-full border-2 transition-all ${
                            form.color === c
                              ? "border-white scale-110"
                              : "border-transparent"
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-[44px] md:min-h-0"
                      onClick={() => setEditingId(null)}
                      icon={<X className="w-4 h-4" />}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="min-h-[44px] md:min-h-0"
                      onClick={() => handleUpdate(inst.id)}
                      icon={<Save className="w-4 h-4" />}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: inst.color || COLORS[0] }}
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-text-primary truncate">
                        {inst.name}
                      </p>
                      <p className="text-xs text-text-muted font-mono truncate">
                        {inst.url}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(inst)}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-glass-hover text-text-muted hover:text-text-primary transition-colors"
                      aria-label={`Edit ${inst.name}`}
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInstance(inst.id)}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                      aria-label={`Delete ${inst.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {instances.length === 0 && !showAdd && (
            <div className="glass rounded-xl p-8 text-center">
              <Server className="w-10 h-10 mx-auto mb-3 text-text-muted opacity-30" />
              <p className="text-text-secondary">
                No instances configured yet
              </p>
              <p className="text-xs text-text-muted mt-1">
                Add your first qBittorrent instance to get started
              </p>
            </div>
          )}
        </div>

        {/* Add Form */}
        {showAdd && (
          <div className="glass rounded-xl p-4 space-y-3 border border-accent/20">
            <p className="text-sm font-semibold text-accent">New Instance</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Name"
                placeholder="My Server"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                icon={<Server className="w-4 h-4" />}
              />
              <Input
                label="URL"
                placeholder="https://my-server.com"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                icon={<Globe className="w-4 h-4" />}
              />
            </div>
            <Input
              label="API Prefix"
              placeholder="/api/v1"
              value={form.apiPrefix}
              onChange={(e) =>
                setForm({ ...form, apiPrefix: e.target.value })
              }
            />
            <div>
              <p className="text-xs text-text-muted mb-1.5">Color</p>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      form.color === c
                        ? "border-white scale-110"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-[44px] md:min-h-0"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="min-h-[44px] md:min-h-0"
                onClick={handleAdd}
                disabled={!form.name || !form.url}
                icon={<Plus className="w-4 h-4" />}
              >
                Add Instance
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 2. System Resources Card */}
      <SystemResourcesCard />

      {/* 3. Rclone Configuration Card */}
      <RcloneConfigCard />

      {/* 4. About */}
      <div className="glass rounded-xl p-5">
        <h2 className="text-lg font-semibold text-text-primary mb-3">About</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-text-muted">Application</span>
            <span className="text-text-primary font-medium">qBit UI</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Version</span>
            <span className="text-text-primary font-mono">1.1.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Runtime</span>
            <span className="text-text-primary">Cloudflare Workers</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Framework</span>
            <span className="text-text-primary">React + Vite + TailwindCSS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
