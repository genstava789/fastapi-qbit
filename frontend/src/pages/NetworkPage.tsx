import { useState } from "react";
import { Button, Badge } from "@/components/ui";
import { useActiveInstance } from "@/hooks/useTorrents";
import {
  Wifi,
  Globe,
  Gauge,
  Activity,
  Loader2,
  CheckCircle2,
  XCircle,
  Server,
  RefreshCw,
} from "lucide-react";
import type { NetworkDiagnostics } from "@/types";

interface ConnectivityResult {
  name: string;
  host: string;
  status: "idle" | "checking" | "ok" | "error";
  latencyMs?: number;
}

export function NetworkPage() {
  const instance = useActiveInstance();
  const [diagnostics, setDiagnostics] = useState<NetworkDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [ipLoading, setIpLoading] = useState(false);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [connChecking, setConnChecking] = useState(false);
  const [targets, setTargets] = useState<ConnectivityResult[]>([
    {
      name: "Active API Backend",
      host: instance?.url || "https://mild-leaf.nyc.boxd.sh",
      status: "idle",
    },
    {
      name: "Cloudflare DoH (1.1.1.1)",
      host: "https://cloudflare-dns.com/dns-query?name=example.com&type=A",
      status: "idle",
    },
    {
      name: "Cloudflare Speed Edge",
      host: "https://speed.cloudflare.com/__down?bytes=1024",
      status: "idle",
    },
  ]);

  const checkPublicIp = async () => {
    setIpLoading(true);
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const data = await res.json();
      setPublicIp(data.ip);
    } catch {
      setPublicIp("Unable to detect");
    } finally {
      setIpLoading(false);
    }
  };

  const runSpeedTest = async () => {
    setLoading(true);
    try {
      const testUrl = "https://speed.cloudflare.com/__down?bytes=10000000";
      const startTime = performance.now();
      const res = await fetch(testUrl);
      const blob = await res.blob();
      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;
      const speedMbps = (blob.size * 8) / duration / 1000000;

      setDiagnostics({
        publicIp: publicIp || "Unknown",
        downloadSpeed: speedMbps,
        latency: Math.round(endTime - startTime),
      });
    } catch {
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  };

  const runConnectivityChecks = async () => {
    setConnChecking(true);
    const activeUrl = instance?.url || "https://mild-leaf.nyc.boxd.sh";
    const apiPrefix = instance?.apiPrefix || "/api/v1";

    const list = [
      {
        name: "Active API Backend",
        host: activeUrl,
        probeUrl: `${activeUrl}${apiPrefix}/health`,
        headers: undefined as Record<string, string> | undefined,
      },
      {
        name: "Cloudflare DoH (1.1.1.1)",
        host: "cloudflare-dns.com",
        probeUrl: "https://cloudflare-dns.com/dns-query?name=cloudflare.com&type=A",
        headers: { Accept: "application/dns-json" },
      },
      {
        name: "Cloudflare Speed Edge",
        host: "speed.cloudflare.com",
        probeUrl: "https://speed.cloudflare.com/__down?bytes=1024",
        headers: undefined as Record<string, string> | undefined,
      },
    ];

    setTargets(
      list.map((item) => ({
        name: item.name,
        host: item.host,
        status: "checking",
      }))
    );

    const results = await Promise.all(
      list.map(async (item): Promise<ConnectivityResult> => {
        const start = performance.now();
        try {
          const res = await fetch(item.probeUrl, {
            headers: item.headers,
            cache: "no-store",
          });
          const latencyMs = Math.round(performance.now() - start);
          return {
            name: item.name,
            host: item.host,
            status: res.ok ? "ok" : "error",
            latencyMs,
          };
        } catch {
          return {
            name: item.name,
            host: item.host,
            status: "error",
          };
        }
      })
    );

    setTargets(results);
    setConnChecking(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Network Agent</h1>
        <p className="text-sm text-text-secondary mt-1">
          Client-side speed test, public IP lookup, and latency checks to your FastAPI backend
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Public IP */}
        <div className="glass rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-accent" />
            <h3 className="font-semibold text-text-primary">Public IP Address</h3>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1 p-4 rounded-xl bg-surface-elevated text-center">
              {ipLoading ? (
                <Loader2 className="w-6 h-6 mx-auto text-accent animate-spin" />
              ) : publicIp ? (
                <div>
                  <p className="text-xl sm:text-2xl font-mono font-bold text-text-primary break-all">
                    {publicIp}
                  </p>
                  <p className="text-xs text-success flex items-center justify-center gap-1 mt-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Detected
                  </p>
                </div>
              ) : (
                <p className="text-sm text-text-muted">Not checked yet</p>
              )}
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={checkPublicIp}
            loading={ipLoading}
            icon={<RefreshCw className="w-4 h-4" />}
            className="w-full min-h-[44px]"
          >
            Check IP
          </Button>
        </div>

        {/* Speed Test */}
        <div className="glass rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-success" />
            <h3 className="font-semibold text-text-primary">Speed Test</h3>
          </div>
          <div className="p-4 rounded-xl bg-surface-elevated text-center">
            {loading ? (
              <div className="space-y-2">
                <Loader2 className="w-8 h-8 mx-auto text-accent animate-spin" />
                <p className="text-sm text-text-secondary">Running speed test...</p>
              </div>
            ) : diagnostics?.downloadSpeed ? (
              <div>
                <p className="text-3xl font-bold text-text-primary">
                  {diagnostics.downloadSpeed.toFixed(1)}
                </p>
                <p className="text-sm text-text-muted">Mbps download</p>
                {diagnostics.latency && (
                  <p className="text-xs text-text-secondary mt-2">
                    Transfer duration: {diagnostics.latency}ms (10 MB)
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-text-muted">Run a test to see results</p>
            )}
          </div>
          <Button
            variant="primary"
            onClick={runSpeedTest}
            loading={loading}
            icon={<Activity className="w-4 h-4" />}
            className="w-full min-h-[44px]"
          >
            Run Speed Test
          </Button>
        </div>

        {/* Connectivity Check */}
        <div className="glass rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-warning" />
              <h3 className="font-semibold text-text-primary">Connectivity Check</h3>
            </div>
          </div>
          <div className="space-y-2">
            {targets.map((target) => (
              <div
                key={target.name}
                className="flex items-center justify-between gap-2 p-3 rounded-xl bg-surface-elevated"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">
                    {target.name}
                  </p>
                  <p className="text-xs text-text-muted font-mono truncate">
                    {target.host}
                  </p>
                </div>
                <div className="flex-shrink-0">
                  {target.status === "checking" ? (
                    <Loader2 className="w-4 h-4 text-accent animate-spin" />
                  ) : target.status === "ok" ? (
                    <Badge variant="success">{target.latencyMs}ms</Badge>
                  ) : target.status === "error" ? (
                    <Badge variant="danger">
                      <XCircle className="w-3 h-3" /> Fail
                    </Badge>
                  ) : (
                    <Wifi className="w-4 h-4 text-text-muted" />
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            onClick={runConnectivityChecks}
            loading={connChecking}
            icon={<Wifi className="w-4 h-4" />}
            className="w-full min-h-[44px]"
          >
            Test Latency & Connectivity
          </Button>
        </div>

        {/* Network Info */}
        <div className="glass rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-info" />
            <h3 className="font-semibold text-text-primary">Client Network</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between p-3 rounded-xl bg-surface-elevated">
              <span className="text-text-muted">Connection Type</span>
              <span className="text-text-primary font-medium">
                {(navigator as unknown as { connection?: { effectiveType?: string } })
                  .connection?.effectiveType || "Unknown"}
              </span>
            </div>
            <div className="flex justify-between p-3 rounded-xl bg-surface-elevated">
              <span className="text-text-muted">Online Status</span>
              <span
                className={`font-medium ${
                  navigator.onLine ? "text-success" : "text-danger"
                }`}
              >
                {navigator.onLine ? "Online" : "Offline"}
              </span>
            </div>
            <div className="flex justify-between p-3 rounded-xl bg-surface-elevated">
              <span className="text-text-muted">Active Instance</span>
              <span className="text-text-primary text-xs font-mono truncate max-w-[200px]">
                {instance?.url || "None"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
