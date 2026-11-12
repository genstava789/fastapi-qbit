import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TorrentActionResponse, TorrentFilter, TorrentItem } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number): string {
  if (seconds <= 0 || seconds >= 8640000) return "∞";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatUptime(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export function getTorrentStateColor(state: string): string {
  const stateMap: Record<string, string> = {
    uploading: "text-success",
    stalledUP: "text-success",
    downloading: "text-accent",
    stalledDL: "text-warning",
    pausedDL: "text-text-muted",
    pausedUP: "text-text-muted",
    queuedDL: "text-info",
    queuedUP: "text-info",
    checkingDL: "text-info",
    checkingUP: "text-info",
    error: "text-danger",
    missingFiles: "text-danger",
    moving: "text-info",
  };
  return stateMap[state] || "text-text-secondary";
}

export function getTorrentStateBg(state: string): string {
  const stateMap: Record<string, string> = {
    uploading: "bg-success/10 text-success border-success/20",
    stalledUP: "bg-success/10 text-success border-success/20",
    downloading: "bg-accent/10 text-accent border-accent/20",
    stalledDL: "bg-warning/10 text-warning border-warning/20",
    pausedDL: "bg-text-muted/10 text-text-muted border-text-muted/20",
    pausedUP: "bg-text-muted/10 text-text-muted border-text-muted/20",
    error: "bg-danger/10 text-danger border-danger/20",
    missingFiles: "bg-danger/10 text-danger border-danger/20",
  };
  return stateMap[state] || "bg-surface-elevated text-text-secondary border-glass-border";
}

export function getTorrentStateLabel(state: string): string {
  const labels: Record<string, string> = {
    uploading: "Seeding",
    stalledUP: "Seeding (stalled)",
    downloading: "Downloading",
    stalledDL: "Stalled",
    pausedDL: "Paused",
    pausedUP: "Completed",
    queuedDL: "Queued",
    queuedUP: "Queued",
    checkingDL: "Checking",
    checkingUP: "Checking",
    error: "Error",
    missingFiles: "Missing Files",
    moving: "Moving",
    forcedDL: "Downloading [F]",
    forcedUP: "Seeding [F]",
    allocating: "Allocating",
    metaDL: "Fetching Metadata",
  };
  return labels[state] || state;
}

export function filterTorrents(
  torrents: TorrentItem[],
  filter: TorrentFilter
): TorrentItem[] {
  if (filter === "all") return torrents;
  const filterMap: Record<string, (t: TorrentItem) => boolean> = {
    downloading: (t) =>
      ["downloading", "forcedDL", "metaDL", "allocating"].includes(t.state),
    completed: (t) =>
      ["uploading", "stalledUP", "pausedUP", "forcedUP"].includes(t.state),
    active: (t) => t.download_speed > 0 || t.upload_speed > 0,
    paused: (t) => t.state.includes("paused"),
    inactive: (t) => t.download_speed === 0 && t.upload_speed === 0,
    stalled: (t) => t.state.includes("stalled"),
    error: (t) => t.state === "error" || t.state === "missingFiles",
  };
  return torrents.filter(filterMap[filter] || (() => true));
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize = 10
): {
  items: T[];
  totalPages: number;
  currentPage: number;
  startIndex: number;
  endIndex: number;
} {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, items.length);
  return {
    items: items.slice(start, end),
    totalPages,
    currentPage,
    startIndex: items.length === 0 ? 0 : start + 1,
    endIndex: end,
  };
}

/**
 * Calculates the share ratio of a torrent.
 * When native qBittorrent ratio is available and valid from backend/qBittorrent,
 * it strictly returns the native ratio to prevent runaway increments.
 * Falls back to peer download calculations or cached historical ratios when needed.
 */
export function calculateTorrentRatio(
  torrent: {
    downloaded?: number;
    uploaded?: number;
    total_size?: number;
    progress?: number;
    ratio?: number;
  },
  cachedRatio?: number
): string {
  // 1. If qBittorrent native ratio is available and valid (>= 0 and < 999),
  // strictly respect it as the definitive source of truth from backend/qBittorrent.
  if (
    torrent.ratio !== undefined &&
    torrent.ratio !== null &&
    !isNaN(torrent.ratio) &&
    torrent.ratio >= 0 &&
    torrent.ratio < 999
  ) {
    return torrent.ratio.toFixed(2);
  }

  const uploaded = torrent.uploaded || 0;
  const downloaded = torrent.downloaded || 0;
  const totalSize = torrent.total_size || 0;

  let currentRatio: number | undefined = undefined;

  // 2. Normal torrent with downloaded bytes from peers
  if (downloaded > 0) {
    currentRatio = uploaded / downloaded;
  }
  // 3. Re-seed mode: files already exist on disk (downloaded <= 0)
  // Share ratio is calculated against completed file size on disk
  else if (totalSize > 0 && uploaded > 0) {
    currentRatio = uploaded / totalSize;
  }

  // 4. Fallback to cached historical ratio (e.g. before reseed / recheck)
  if (cachedRatio !== undefined && cachedRatio > 0) {
    if (currentRatio === undefined || currentRatio <= 0) {
      return cachedRatio.toFixed(2);
    }
    // For re-seed mode without native ratio, accumulate session uploads on top of cached ratio
    const effectiveRatio = Math.max(
      currentRatio,
      downloaded <= 0 && totalSize > 0
        ? cachedRatio + uploaded / totalSize
        : cachedRatio
    );
    return effectiveRatio.toFixed(2);
  }

  if (currentRatio !== undefined) {
    return currentRatio.toFixed(2);
  }

  // Fallback for uploaded without size / download
  if (uploaded > 0) {
    return "∞";
  }

  return "0.00";
}

/**
 * Checks whether a torrent is completed (100% progress or in any seeding/completed state).
 */
export function isTorrentComplete(torrent: {
  progress?: number;
  state?: string;
}): boolean {
  if (torrent.progress !== undefined && torrent.progress >= 100) {
    return true;
  }
  const state = torrent.state || "";
  const completeStates = [
    "uploading",
    "stalledUP",
    "pausedUP",
    "forcedUP",
    "checkingUP",
    "queuedUP",
  ];
  return completeStates.includes(state) || state.includes("UP");
}


/**
 * Checks if a string representation of qBittorrent result or error message
 * corresponds to a successful TorrentsAddedMetadata response.
 */
export function isTorrentsAddedMetadataSuccess(text?: string | null): boolean {
  if (!text || typeof text !== "string") return false;
  if (!text.toLowerCase().includes("torrentsaddedmetadata")) return false;

  // If added_torrent_ids contains at least one ID: ['xyz...'] or ["xyz..."] or ('xyz',)
  const hasAddedIds = /['"]added_torrent_ids['"]\s*:\s*(?:\[\s*['"][a-fA-F0-9]+['"]|\(\s*['"][a-fA-F0-9]+['"])/i.test(
    text
  );
  if (hasAddedIds) return true;

  // If success_count is greater than 0
  const successMatch = text.match(/['"]success_count['"]\s*:\s*(\d+)/i);
  if (successMatch && parseInt(successMatch[1], 10) > 0) return true;

  // Check for explicit zero-addition / failure: e.g. success_count: 0 and added_torrent_ids: []
  const isEmptyIds = /['"]added_torrent_ids['"]\s*:\s*(?:\[\s*\]|\(\s*\))/i.test(text);
  const isZeroSuccess = successMatch && parseInt(successMatch[1], 10) === 0;
  if (isEmptyIds && isZeroSuccess) {
    return false;
  }

  // If failure_count is 0 and it's not explicitly zero additions
  const failureMatch = text.match(/['"]failure_count['"]\s*:\s*(\d+)/i);
  if (failureMatch && parseInt(failureMatch[1], 10) === 0 && !isEmptyIds && !isZeroSuccess) {
    return true;
  }

  return !isZeroSuccess && !isEmptyIds;
}

/**
 * Checks if a torrent action response (or message) indicates success,
 * even if success was marked false due to TorrentsAddedMetadata string parsing.
 */
export function isTorrentAddSuccess(
  response?: {
    success?: boolean;
    message?: string;
    data?: any;
  } | null
): boolean {
  if (!response) return false;
  if (response.success) return true;

  if (isTorrentsAddedMetadataSuccess(response.message)) return true;

  const resultStr =
    typeof response.data?.result === "string"
      ? response.data.result
      : typeof response.data?.result === "object"
      ? JSON.stringify(response.data.result)
      : "";

  if (isTorrentsAddedMetadataSuccess(resultStr)) return true;

  return false;
}

/**
 * Normalizes a TorrentActionResponse, converting false-negative TorrentsAddedMetadata
 * into true success responses.
 */
export function normalizeTorrentActionResponse(
  response: TorrentActionResponse,
  defaultSuccessMessage = "Magnet link successfully queued for download."
): TorrentActionResponse {
  if (response.success) return response;

  if (isTorrentAddSuccess(response)) {
    return {
      ...response,
      success: true,
      message: defaultSuccessMessage,
    };
  }

  return response;
}


