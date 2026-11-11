import { useState } from "react";
import { Button, Input, Badge } from "@/components/ui";
import { Search, Download, Upload, ExternalLink, AlertCircle } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { useAddMagnet } from "@/hooks/useTorrents";
import toast from "react-hot-toast";
import type { ProwlarrSearchResult } from "@/types";

export function ProwlarrPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProwlarrSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [prowlarrUrl, setProwlarrUrl] = useState(
    () => localStorage.getItem("prowlarr_url") || ""
  );
  const [prowlarrApiKey, setProwlarrApiKey] = useState(
    () => localStorage.getItem("prowlarr_apikey") || ""
  );
  const [configured, setConfigured] = useState(
    () => !!(localStorage.getItem("prowlarr_url") && localStorage.getItem("prowlarr_apikey"))
  );

  const addMagnet = useAddMagnet();

  const saveConfig = () => {
    localStorage.setItem("prowlarr_url", prowlarrUrl.replace(/\/$/, ""));
    localStorage.setItem("prowlarr_apikey", prowlarrApiKey);
    setConfigured(true);
  };

  const handleSearch = async () => {
    if (!query.trim() || !configured) return;
    setLoading(true);
    setSearchError(null);
    try {
      const base = prowlarrUrl.replace(/\/$/, "");
      const url = `${base}/api/v1/search?query=${encodeURIComponent(query)}&type=search`;
      const res = await fetch(url, {
        headers: { "X-Api-Key": prowlarrApiKey },
      });
      if (!res.ok) {
        throw new Error(`Prowlarr returned HTTP ${res.status}`);
      }
      const data = await res.json();
      setResults(
        data.map((item: any) => ({
          title: item.title,
          size: item.size,
          seeders: item.seeders,
          leechers: item.leechers,
          magnetUrl: item.magnetUrl || item.downloadUrl,
          downloadUrl: item.downloadUrl,
          indexer: item.indexer,
          publishDate: item.publishDate,
          categories: item.categories?.map((c: any) => c.name) || [],
        }))
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to connect to Prowlarr API";
      setSearchError(message);
      toast.error(`Prowlarr search failed: ${message}`);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToQbit = (result: ProwlarrSearchResult) => {
    const magnetUrl = result.magnetUrl || result.downloadUrl;
    if (magnetUrl?.startsWith("magnet:")) {
      addMagnet.mutate({ magnet_url: magnetUrl });
    }
  };

  if (!configured) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Prowlarr Search</h1>
          <p className="text-sm text-text-secondary mt-1">
            Configure your Prowlarr instance to search indexers
          </p>
        </div>
        <div className="glass rounded-xl p-5 sm:p-6 max-w-lg space-y-4">
          <Input
            label="Prowlarr URL"
            placeholder="https://prowlarr.yourdomain.com"
            value={prowlarrUrl}
            onChange={(e) => setProwlarrUrl(e.target.value)}
            icon={<ExternalLink className="w-4 h-4" />}
          />
          <Input
            label="API Key"
            placeholder="Your Prowlarr API key"
            type="password"
            value={prowlarrApiKey}
            onChange={(e) => setProwlarrApiKey(e.target.value)}
          />
          <Button
            variant="primary"
            className="min-h-[44px] w-full sm:w-auto"
            onClick={saveConfig}
            disabled={!prowlarrUrl || !prowlarrApiKey}
          >
            Save & Connect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Prowlarr Search</h1>
          <p className="text-sm text-text-secondary mt-1">
            Search across all configured indexers
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px]"
          onClick={() => setConfigured(false)}
        >
          Configure
        </Button>
      </div>

      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder="Search for torrents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="min-h-[44px]"
            icon={<Search className="w-4 h-4" />}
          />
        </div>
        <Button
          variant="primary"
          onClick={handleSearch}
          loading={loading}
          className="min-h-[44px]"
        >
          Search
        </Button>
      </div>

      {/* Error Banner */}
      {searchError && (
        <div className="glass rounded-xl p-4 flex items-start gap-3 border border-danger/30 bg-danger/5">
          <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-danger">Prowlarr Error</p>
            <p className="text-xs text-text-secondary mt-0.5">
              {searchError} — Pastikan URL Prowlarr valid dan mengizinkan CORS dari domain frontend ini.
            </p>
          </div>
        </div>
      )}

      {/* Mobile Cards */}
      {results.length > 0 && (
        <div className="md:hidden space-y-3">
          {results.map((r, i) => (
            <div key={i} className="glass rounded-2xl p-4 space-y-3">
              <div>
                <h3 className="text-[15px] font-semibold text-text-primary leading-snug line-clamp-2">
                  {r.title}
                </h3>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Badge variant="default">{r.indexer}</Badge>
                  <span className="text-xs text-text-secondary font-mono">
                    {formatBytes(r.size)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-glass-border">
                <div className="flex items-center gap-4 text-sm font-mono">
                  <span className="text-success font-semibold flex items-center gap-1">
                    <Upload className="w-3.5 h-3.5" /> {r.seeders}
                  </span>
                  <span className="text-danger font-semibold flex items-center gap-1">
                    <Download className="w-3.5 h-3.5" /> {r.leechers}
                  </span>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  className="min-h-[44px] px-4"
                  disabled={!r.magnetUrl?.startsWith("magnet:")}
                  onClick={() => handleAddToQbit(r)}
                  icon={<Download className="w-4 h-4" />}
                >
                  Add
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Desktop Table */}
      {results.length > 0 && (
        <div className="hidden md:block glass rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-glass-border text-text-muted text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left w-24">Indexer</th>
                <th className="px-4 py-3 text-right w-20">Size</th>
                <th className="px-4 py-3 text-right w-16">
                  <span className="flex items-center justify-end gap-1">
                    <Upload className="w-3 h-3" /> S
                  </span>
                </th>
                <th className="px-4 py-3 text-right w-16">
                  <span className="flex items-center justify-end gap-1">
                    <Download className="w-3 h-3" /> L
                  </span>
                </th>
                <th className="px-4 py-3 text-right w-28">Date</th>
                <th className="px-4 py-3 w-20 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-glass-border/50 hover:bg-glass-hover/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary truncate max-w-md">
                      {r.title}
                    </p>
                    {r.categories.length > 0 && (
                      <p className="text-xs text-text-muted mt-0.5">
                        {r.categories.join(", ")}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">
                    {r.indexer}
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary font-mono text-xs">
                    {formatBytes(r.size)}
                  </td>
                  <td className="px-4 py-3 text-right text-success font-mono text-xs">
                    {r.seeders}
                  </td>
                  <td className="px-4 py-3 text-right text-danger font-mono text-xs">
                    {r.leechers}
                  </td>
                  <td className="px-4 py-3 text-right text-text-muted text-xs">
                    {new Date(r.publishDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleAddToQbit(r)}
                      disabled={!r.magnetUrl?.startsWith("magnet:")}
                      className="p-2 rounded-lg hover:bg-accent/10 text-text-muted hover:text-accent transition-colors disabled:opacity-30"
                      title="Add to qBittorrent"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.length === 0 && !loading && query && (
        <div className="glass rounded-xl p-12 text-center">
          <Search className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-30" />
          <p className="text-text-secondary">No results found</p>
        </div>
      )}
    </div>
  );
}
