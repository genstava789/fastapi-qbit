import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useActiveInstance, useSystemStats, useHealth } from "@/hooks/useTorrents";
import { formatBytes, formatUptime } from "@/lib/utils";
import { Button, Input } from "@/components/ui";
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
} from "lucide-react";
import type { Instance } from "@/types";

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
        <div className="py-6 text-center text-sm text-text-secondary">
          Loading VPS host metrics...
        </div>
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

      {/* 2. System Resources Card (Placed between Instances and About) */}
      <SystemResourcesCard />

      {/* 3. About */}
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
