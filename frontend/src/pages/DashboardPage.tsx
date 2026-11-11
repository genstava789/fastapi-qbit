import { useMemo, useEffect, useState } from "react";
import { useTorrents, useHealth, useActiveInstance } from "@/hooks/useTorrents";
import { formatBytes, formatSpeed } from "@/lib/utils";
import {
  Download,
  Upload,
  HardDrive,
  Activity,
  Server,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type ColorVariant = "accent" | "success" | "info" | "warning";

const colorVariants: Record<ColorVariant, { bg: string; text: string }> = {
  accent: { bg: "bg-accent/10", text: "text-accent" },
  success: { bg: "bg-success/10", text: "text-success" },
  info: { bg: "bg-info/10", text: "text-info" },
  warning: { bg: "bg-warning/10", text: "text-warning" },
};

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
  colorVariant: ColorVariant;
  glowClass?: string;
}

function StatCard({
  label,
  value,
  subValue,
  icon: Icon,
  colorVariant,
  glowClass,
}: StatCardProps) {
  const styles = colorVariants[colorVariant];

  return (
    <div
      className={`glass rounded-xl p-5 transition-all hover:scale-[1.02] ${
        glowClass || ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wider font-semibold">
            {label}
          </p>
          <p className="text-xl sm:text-2xl font-bold text-text-primary mt-1">{value}</p>
          {subValue && (
            <p className="text-xs text-text-secondary mt-0.5">{subValue}</p>
          )}
        </div>
        <div className={`p-2.5 rounded-xl ${styles.bg}`}>
          <Icon className={`w-5 h-5 ${styles.text}`} />
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: torrents } = useTorrents();
  const { data: health } = useHealth();
  const instance = useActiveInstance();
  const [speedHistory, setSpeedHistory] = useState<
    { time: string; dl: number; ul: number }[]
  >([]);

  useEffect(() => {
    if (!torrents) return;
    const totalDl = torrents.reduce((sum, t) => sum + t.download_speed, 0);
    const totalUl = torrents.reduce((sum, t) => sum + t.upload_speed, 0);
    const now = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
    });

    const id = requestAnimationFrame(() => {
      setSpeedHistory((prev) => {
        const next = [...prev, { time: now, dl: totalDl, ul: totalUl }];
        return next.slice(-30);
      });
    });

    return () => cancelAnimationFrame(id);
  }, [torrents]);

  const stats = useMemo(() => {
    if (!torrents) return null;
    const downloading = torrents.filter(
      (t) =>
        t.state === "downloading" ||
        t.state === "forcedDL" ||
        t.state === "metaDL"
    );
    const seeding = torrents.filter(
      (t) =>
        t.state === "uploading" ||
        t.state === "stalledUP" ||
        t.state === "forcedUP"
    );
    const paused = torrents.filter((t) => t.state.includes("paused"));
    const errored = torrents.filter(
      (t) => t.state === "error" || t.state === "missingFiles"
    );
    const totalDl = torrents.reduce((sum, t) => sum + t.download_speed, 0);
    const totalUl = torrents.reduce((sum, t) => sum + t.upload_speed, 0);
    const totalSize = torrents.reduce((sum, t) => sum + t.total_size, 0);
    const totalDownloaded = torrents.reduce((sum, t) => sum + t.downloaded, 0);
    const totalUploaded = torrents.reduce((sum, t) => sum + t.uploaded, 0);

    return {
      total: torrents.length,
      downloading: downloading.length,
      seeding: seeding.length,
      paused: paused.length,
      errored: errored.length,
      totalDl,
      totalUl,
      totalSize,
      totalDownloaded,
      totalUploaded,
    };
  }, [torrents]);

  if (!instance) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Server className="w-16 h-16 text-text-muted mb-4" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          No Instance Configured
        </h2>
        <p className="text-text-secondary max-w-md">
          Go to Settings to add your first qBittorrent instance and start
          managing your torrents.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-secondary mt-1">
          Overview of {instance.name} —{" "}
          {health?.qbittorrent_connected ? "Connected" : "Disconnected"}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Download Speed"
          value={stats ? formatSpeed(stats.totalDl) : "—"}
          icon={Download}
          colorVariant="accent"
          glowClass={stats && stats.totalDl > 0 ? "glow-accent" : ""}
        />
        <StatCard
          label="Upload Speed"
          value={stats ? formatSpeed(stats.totalUl) : "—"}
          icon={Upload}
          colorVariant="success"
          glowClass={stats && stats.totalUl > 0 ? "glow-success" : ""}
        />
        <StatCard
          label="Total Torrents"
          value={stats ? String(stats.total) : "—"}
          subValue={
            stats
              ? `${stats.downloading} downloading · ${stats.seeding} seeding`
              : undefined
          }
          icon={Activity}
          colorVariant="info"
        />
        <StatCard
          label="Disk Usage"
          value={stats ? formatBytes(stats.totalSize) : "—"}
          subValue={
            stats
              ? `↓ ${formatBytes(stats.totalDownloaded)} · ↑ ${formatBytes(
                  stats.totalUploaded
                )}`
              : undefined
          }
          icon={HardDrive}
          colorVariant="warning"
        />
      </div>

      {/* Speed Chart */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-accent" />
            <h3 className="font-semibold text-text-primary">Transfer Speed</h3>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-1 rounded-full bg-accent" /> Download
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-1 rounded-full bg-success" /> Upload
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={speedHistory}>
            <defs>
              <linearGradient id="dlGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="ulGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.08)"
            />
            <XAxis dataKey="time" tick={{ fill: "#a1a1aa", fontSize: 10 }} />
            <YAxis
              tick={{ fill: "#a1a1aa", fontSize: 10 }}
              tickFormatter={(v) => formatBytes(v)}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(12,12,15,0.96)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "8px",
                color: "#fafafa",
                fontSize: "12px",
              }}
              formatter={(value) => [formatSpeed(Number(value ?? 0))]}
            />
            <Area
              type="monotone"
              dataKey="dl"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#dlGrad)"
              name="Download"
            />
            <Area
              type="monotone"
              dataKey="ul"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#ulGrad)"
              name="Upload"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent/10">
            <Download className="w-4 h-4 text-accent" />
          </div>
          <div>
            <p className="text-lg font-bold text-text-primary">
              {stats?.downloading || 0}
            </p>
            <p className="text-xs text-text-muted">Downloading</p>
          </div>
        </div>
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-success/10">
            <Upload className="w-4 h-4 text-success" />
          </div>
          <div>
            <p className="text-lg font-bold text-text-primary">
              {stats?.seeding || 0}
            </p>
            <p className="text-xs text-text-muted">Seeding</p>
          </div>
        </div>
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-warning/10">
            <Activity className="w-4 h-4 text-warning" />
          </div>
          <div>
            <p className="text-lg font-bold text-text-primary">
              {stats?.paused || 0}
            </p>
            <p className="text-xs text-text-muted">Paused</p>
          </div>
        </div>
        <div className="glass rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-danger/10">
            <AlertCircle className="w-4 h-4 text-danger" />
          </div>
          <div>
            <p className="text-lg font-bold text-text-primary">
              {stats?.errored || 0}
            </p>
            <p className="text-xs text-text-muted">Errors</p>
          </div>
        </div>
      </div>

      {/* Connection Info */}
      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Server className="w-5 h-5 text-accent" />
          Connection Info
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-text-muted">Status</p>
            <p className="flex items-center gap-1.5 mt-1 font-medium">
              {health?.qbittorrent_connected ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-success" /> Connected
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-danger" /> Disconnected
                </>
              )}
            </p>
          </div>
          <div>
            <p className="text-text-muted">qBittorrent</p>
            <p className="mt-1 font-medium text-text-primary">
              {health?.qbittorrent_version || "N/A"}
            </p>
          </div>
          <div>
            <p className="text-text-muted">API Version</p>
            <p className="mt-1 font-medium text-text-primary">
              {health?.app_version || "N/A"}
            </p>
          </div>
          <div>
            <p className="text-text-muted">Instance</p>
            <p className="mt-1 font-medium text-text-primary truncate">
              {instance.url}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
