import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, Plus, RefreshCw, Menu, X, ArrowRight } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useHealth, useActiveInstance, useTorrents } from "@/hooks/useTorrents";
import { Button, Badge } from "@/components/ui";
import { formatBytes, getTorrentStateLabel, cn } from "@/lib/utils";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const setAddTorrentModalOpen = useAppStore((s) => s.setAddTorrentModalOpen);
  const setMobileMenuOpen = useAppStore((s) => s.setMobileMenuOpen);
  const activeInstance = useActiveInstance();
  const { data: health } = useHealth();
  const { data: torrents } = useTorrents();
  const qc = useQueryClient();
  const isFetchingAny = useIsFetching();
  const [focused, setFocused] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const isTorrentsRoute = location.pathname === "/torrents";
  const isFilesRoute = location.pathname === "/files";
  const isDriveRoute = location.pathname.startsWith("/drive");
  const isInlineFilterRoute = isTorrentsRoute || isFilesRoute;

  const isSpinning = isSyncing || isFetchingAny > 0;

  const handleGlobalRefresh = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      if (isDriveRoute) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["drive-files"] }),
          qc.invalidateQueries({ queryKey: ["drive-storage-quota"] }),
          qc.invalidateQueries({ queryKey: ["drive-breadcrumbs"] }),
          qc.invalidateQueries({ queryKey: ["drive-uploads"] }),
          qc.refetchQueries({ queryKey: ["drive-files"], type: "active" }),
          qc.refetchQueries({ queryKey: ["drive-storage-quota"], type: "active" }),
        ]);
      } else if (isFilesRoute) {
        await qc.invalidateQueries({ queryKey: ["fs-files"] });
      } else {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["torrents"] }),
          qc.invalidateQueries({ queryKey: ["main-stats"] }),
        ]);
      }
    } finally {
      setTimeout(() => setIsSyncing(false), 500);
    }
  };

  const placeholder = isTorrentsRoute
    ? "Search torrents..."
    : isFilesRoute
    ? "Filter files & folders..."
    : "Jump to torrent...";

  const quickMatches = useMemo(() => {
    if (isInlineFilterRoute || !searchQuery.trim() || !torrents) return [];
    const q = searchQuery.toLowerCase();
    return torrents
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) || t.hash.toLowerCase().includes(q)
      )
      .slice(0, 5);
  }, [isInlineFilterRoute, searchQuery, torrents]);

  const showQuickJump = !isInlineFilterRoute && focused && searchQuery.trim().length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isInlineFilterRoute && searchQuery.trim()) {
      setFocused(false);
      navigate("/torrents");
    }
    if (e.key === "Escape") {
      setFocused(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur-xl border-b border-glass-border">
      <div className="flex items-center justify-between gap-2 sm:gap-3 h-16 px-3 sm:px-6">
        {/* Mobile Hamburger */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-glass-hover text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Contextual Search */}
        <div className="relative flex-1 max-w-md min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder={placeholder}
            value={searchQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 180)}
            onKeyDown={handleKeyDown}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-10 pr-9 rounded-xl md:rounded-lg text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-glass-hover"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Quick Jump Popover when on Dashboard / Settings / etc. */}
          {showQuickJump && (
            <div className="absolute left-0 right-0 top-12 z-50 bg-surface-overlay border border-glass-border rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-3.5 py-2 border-b border-glass-border flex items-center justify-between text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                <span>Quick Torrent Jump</span>
                <span>{quickMatches.length} matches</span>
              </div>

              {quickMatches.length > 0 ? (
                <div className="divide-y divide-glass-border/50">
                  {quickMatches.map((t) => (
                    <button
                      key={t.hash}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setFocused(false);
                        navigate("/torrents");
                      }}
                      className="w-full px-3.5 py-2.5 text-left hover:bg-glass-hover flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {t.name}
                        </p>
                        <p className="text-xs text-text-muted font-mono">
                          {formatBytes(t.total_size)} · {t.progress.toFixed(1)}%
                        </p>
                      </div>
                      <Badge variant="default">
                        {getTorrentStateLabel(t.state)}
                      </Badge>
                    </button>
                  ))}
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setFocused(false);
                      navigate("/torrents");
                    }}
                    className="w-full px-3.5 py-2.5 text-xs font-medium text-accent hover:bg-accent/10 flex items-center justify-center gap-1.5"
                  >
                    Filter in Torrents page
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="px-4 py-4 text-xs text-text-muted text-center">
                  No torrents match &ldquo;{searchQuery}&rdquo;
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
          {health && (
            <Badge
              variant={health.qbittorrent_connected ? "success" : "danger"}
              className="hidden sm:inline-flex"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  health.qbittorrent_connected ? "bg-success" : "bg-danger"
                }`}
              />
              {health.qbittorrent_connected
                ? `${activeInstance?.name ? `${activeInstance.name} · ` : ""}qBit ${health.qbittorrent_version}`
                : "Disconnected"}
            </Badge>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleGlobalRefresh}
            disabled={isSpinning}
            className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-2 text-text-secondary hover:text-text-primary disabled:opacity-50"
            icon={<RefreshCw className={cn("w-4 h-4", isSpinning && "animate-spin")} />}
            title="Sync data"
          >
            <span className="sr-only">Refresh</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setAddTorrentModalOpen(true)}
            className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3"
            icon={<Plus className="w-4 h-4" />}
          >
            <span className="hidden sm:inline">Add Torrent</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
