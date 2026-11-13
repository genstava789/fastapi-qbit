import { useEffect, useState } from "react";
import { Button, Input, Badge } from "@/components/ui";
import {
  Search,
  Download,
  Upload,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Settings,
} from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { UI_STRINGS } from "@/lib/strings";
import {
  useAddProwlarrResult,
  useProwlarrApi,
  useProwlarrConfig,
  useSaveProwlarrConfig,
  useTestProwlarrConnection,
} from "@/hooks/useProwlarr";
import toast from "react-hot-toast";
import type { ProwlarrSearchResult } from "@/types";

const S = UI_STRINGS.prowlarr;

export function ProwlarrPage() {
  const api = useProwlarrApi();
  const { data: config, isLoading: configLoading } = useProwlarrConfig();
  const saveConfigMutation = useSaveProwlarrConfig();
  const testConnectionMutation = useTestProwlarrConnection();
  const addResultMutation = useAddProwlarrResult();

  const [query, setQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<ProwlarrSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState(false);

  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [prowlarrApiKey, setProwlarrApiKey] = useState("");

  // Purge legacy client-side localStorage keys from earlier versions
  useEffect(() => {
    localStorage.removeItem("prowlarr_apikey");
    localStorage.removeItem("prowlarr_url");
  }, []);

  const prowlarrUrl = urlDraft ?? config?.url ?? "";
  const configured = Boolean(config?.configured);
  const showSetup = !configured || editingConfig;
  const canSaveConfig =
    Boolean(api) &&
    Boolean(prowlarrUrl.trim()) &&
    (Boolean(prowlarrApiKey.trim()) || Boolean(config?.has_api_key));

  const sanitizeKey = (key: string) => {
    const trimmed = key.trim().replace(/^["']|["']$/g, "");
    if (!trimmed || trimmed.includes("*")) {
      return undefined;
    }
    return trimmed;
  };

  const handleSaveConfig = async () => {
    if (!canSaveConfig) return;
    await saveConfigMutation.mutateAsync({
      url: prowlarrUrl.trim(),
      api_key: sanitizeKey(prowlarrApiKey),
    });
    localStorage.removeItem("prowlarr_url");
    localStorage.removeItem("prowlarr_apikey");
    setUrlDraft(null);
    setProwlarrApiKey("");
    setEditingConfig(false);
  };

  const handleTestConnection = (override?: { url?: string; apiKey?: string }) => {
    if (!api) return;
    const urlToTest = (override?.url ?? prowlarrUrl).trim() || undefined;
    const rawKey = override?.apiKey !== undefined ? override.apiKey : prowlarrApiKey;
    const keyToTest = sanitizeKey(rawKey);

    testConnectionMutation.mutate({
      url: urlToTest,
      api_key: keyToTest,
    });
  };

  const handleSearch = async () => {
    if (!query.trim() || !configured || !api) return;
    setLoading(true);
    setHasSearched(true);
    setSearchError(null);
    try {
      const items = await api.search({ query: query.trim(), type: "search" });
      setResults(items);
    } catch (err: any) {
      const message =
        err?.response?.data?.detail ||
        (err instanceof Error ? err.message : "Failed to search Prowlarr");
      setSearchError(message);
      toast.error(`Prowlarr search failed: ${message}`);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToQbit = (result: ProwlarrSearchResult) => {
    if (!result.magnetUrl && !result.downloadUrl) return;
    addResultMutation.mutate({
      magnet_url: result.magnetUrl,
      download_url: result.downloadUrl,
    });
  };

  if (!api) {
    return (
      <div className="glass rounded-xl p-6 max-w-lg flex items-start gap-3 border border-warning/30 bg-warning/5">
        <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
        <p className="text-sm text-text-secondary">{S.noInstanceWarning}</p>
      </div>
    );
  }

  if (configLoading && !config) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 rounded-lg bg-glass-hover animate-pulse" />
        <div className="glass rounded-xl p-6 max-w-lg h-56 animate-pulse" />
      </div>
    );
  }

  if (showSetup) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{S.title}</h1>
          <p className="text-sm text-text-secondary mt-1">{S.setupSubtitle}</p>
        </div>
        <div className="glass rounded-xl p-5 sm:p-6 max-w-lg space-y-4">
          <Input
            label={S.urlLabel}
            placeholder={S.urlPlaceholder}
            value={prowlarrUrl}
            onChange={(e) => setUrlDraft(e.target.value)}
            icon={<ExternalLink className="w-4 h-4" />}
          />
          <div className="space-y-1.5">
            <Input
              label={S.apiKeyLabel}
              placeholder={
                config?.has_api_key ? S.apiKeyKeepPlaceholder : S.apiKeyPlaceholder
              }
              type="password"
              autoComplete="new-password"
              value={prowlarrApiKey}
              onChange={(e) => setProwlarrApiKey(e.target.value)}
            />
            {config?.has_api_key && config.api_key_masked && (
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />
                <span>
                  {S.savedKeyLabel}: <code className="font-mono text-text-secondary">{config.api_key_masked}</code>
                  <span className="text-text-muted ml-1">({S.savedKeyNotice})</span>
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <Button
              variant="primary"
              className="min-h-[44px] w-full sm:w-auto"
              onClick={handleSaveConfig}
              loading={saveConfigMutation.isPending}
              disabled={!canSaveConfig}
            >
              {S.saveConfig}
            </Button>
            <Button
              variant="secondary"
              className="min-h-[44px] w-full sm:w-auto"
              onClick={() => handleTestConnection()}
              loading={testConnectionMutation.isPending}
              disabled={!prowlarrUrl.trim() && !configured}
              icon={<CheckCircle2 className="w-4 h-4" />}
            >
              {S.testConnection}
            </Button>
            {configured && (
              <Button
                variant="ghost"
                className="min-h-[44px] w-full sm:w-auto"
                onClick={() => {
                  setUrlDraft(null);
                  setProwlarrApiKey("");
                  setEditingConfig(false);
                }}
              >
                {S.cancel}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-text-primary">{S.title}</h1>
            <Badge
              variant={testConnectionMutation.isSuccess ? "success" : "default"}
              className="font-mono text-xs"
            >
              {testConnectionMutation.data?.version
                ? `v${testConnectionMutation.data.version}`
                : S.configuredBadge}
            </Badge>
          </div>
          <p className="text-sm text-text-secondary mt-1">{S.searchSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-[40px]"
            onClick={() => handleTestConnection()}
            loading={testConnectionMutation.isPending}
            icon={<CheckCircle2 className="w-4 h-4 text-success" />}
          >
            {S.testConnection}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[40px]"
            onClick={() => setEditingConfig(true)}
            icon={<Settings className="w-4 h-4" />}
          >
            {S.configure}
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            placeholder={S.searchPlaceholder}
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
          disabled={!query.trim()}
          className="min-h-[44px]"
        >
          {S.searchButton}
        </Button>
      </div>

      {/* Error Banner */}
      {searchError && (
        <div className="glass rounded-xl p-4 flex items-start gap-3 border border-danger/30 bg-danger/5">
          <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-danger">{S.errorTitle}</p>
            <p className="text-xs text-text-secondary mt-0.5">{searchError}</p>
          </div>
        </div>
      )}

      {/* Mobile Cards */}
      {results.length > 0 && (
        <div className="md:hidden space-y-3">
          {results.map((r, i) => (
            <div key={r.guid || i} className="glass rounded-2xl p-4 space-y-3">
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
                  disabled={!r.magnetUrl && !r.downloadUrl}
                  loading={addResultMutation.isPending}
                  onClick={() => handleAddToQbit(r)}
                  icon={<Download className="w-4 h-4" />}
                >
                  {S.addButton}
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
                  key={r.guid || i}
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
                    {r.publishDate
                      ? new Date(r.publishDate).toLocaleDateString()
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleAddToQbit(r)}
                      disabled={(!r.magnetUrl && !r.downloadUrl) || addResultMutation.isPending}
                      className="p-2 rounded-lg hover:bg-accent/10 text-text-muted hover:text-accent transition-colors disabled:opacity-30"
                      title={S.addTitle}
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

      {results.length === 0 && !loading && hasSearched && !searchError && (
        <div className="glass rounded-xl p-12 text-center">
          <Search className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-30" />
          <p className="text-text-secondary">{S.noResults}</p>
        </div>
      )}
    </div>
  );
}
