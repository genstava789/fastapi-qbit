import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TorrentFilter, TorrentItem } from "@/types";

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

