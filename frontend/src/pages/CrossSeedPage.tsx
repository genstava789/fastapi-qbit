import { useState, useMemo } from "react";
import { useTorrents } from "@/hooks/useTorrents";
import { formatBytes, getTorrentStateLabel } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { TorrentDetailModal } from "@/components/torrents";
import { GitFork, Search, Loader2, Info } from "lucide-react";
import type { TorrentItem } from "@/types";

function findCrossSeedCandidates(torrents: TorrentItem[]): {
  group: TorrentItem[];
  size: number;
}[] {
  const sizeMap = new Map<number, TorrentItem[]>();
  for (const t of torrents) {
    if (t.total_size > 0) {
      const existing = sizeMap.get(t.total_size) || [];
      existing.push(t);
      sizeMap.set(t.total_size, existing);
    }
  }
  return Array.from(sizeMap.entries())
    .filter(([, group]) => group.length > 1)
    .map(([size, group]) => ({ size, group }))
    .sort((a, b) => b.size - a.size);
}

export function CrossSeedPage() {
  const { data: torrents, isLoading } = useTorrents();
  const [searchFilter, setSearchFilter] = useState("");
  const [detailHash, setDetailHash] = useState<string | null>(null);

  const candidates = useMemo(() => {
    if (!torrents) return [];
    return findCrossSeedCandidates(torrents);
  }, [torrents]);

  const filtered = useMemo(() => {
    if (!searchFilter) return candidates;
    const q = searchFilter.toLowerCase();
    return candidates.filter((c) =>
      c.group.some((t) => t.name.toLowerCase().includes(q))
    );
  }, [candidates, searchFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Cross-Seed</h1>
        <p className="text-sm text-text-secondary mt-1">
          Discover cross-seeding opportunities across your torrents
        </p>
      </div>

      {/* Info Banner */}
      <div className="glass rounded-xl p-4 flex items-start gap-3 border border-info/20 bg-info/5">
        <Info className="w-5 h-5 text-info flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-text-primary font-medium">
            How Cross-Seeding Works
          </p>
          <p className="text-xs text-text-secondary mt-1">
            Cross-seeding identifies torrents with identical file sizes that may
            contain the same content from different trackers. This allows you to
            seed the same data to multiple trackers, improving your ratio.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Filter candidates..."
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl text-sm bg-surface-elevated border border-glass-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Found {filtered.length} potential cross-seed groups
          </p>
          {filtered.map((candidate, idx) => (
            <div key={idx} className="glass rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="accent">
                  <GitFork className="w-3 h-3" />
                  {candidate.group.length} matches
                </Badge>
                <span className="text-xs text-text-muted font-mono">
                  {formatBytes(candidate.size)}
                </span>
              </div>
              <div className="space-y-2">
                {candidate.group.map((t) => (
                  <button
                    key={t.hash}
                    type="button"
                    onClick={() => setDetailHash(t.hash)}
                    className="w-full text-left flex items-center justify-between gap-3 py-2.5 px-3 min-h-[48px] rounded-xl bg-surface-elevated/50 hover:bg-glass-hover transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {t.name}
                      </p>
                      <p className="text-xs text-text-muted font-mono truncate mt-0.5">
                        {t.hash.substring(0, 16)}... · {t.save_path}
                      </p>
                    </div>
                    <Badge
                      variant={
                        t.state.includes("UP") || t.state === "uploading"
                          ? "success"
                          : "default"
                      }
                    >
                      {getTorrentStateLabel(t.state)}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass rounded-xl p-12 text-center">
          <GitFork className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-30" />
          <p className="text-text-secondary">No cross-seed candidates found</p>
          <p className="text-xs text-text-muted mt-1">
            Cross-seed opportunities appear when multiple torrents share the same
            file size
          </p>
        </div>
      )}

      <TorrentDetailModal
        hash={detailHash}
        onClose={() => setDetailHash(null)}
      />
    </div>
  );
}
