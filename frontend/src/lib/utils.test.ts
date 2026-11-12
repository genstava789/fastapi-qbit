import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  getTorrentStateColor,
  getTorrentStateLabel,
  filterTorrents,
  paginateItems,
  formatUptime,
  isTorrentsAddedMetadataSuccess,
  isTorrentAddSuccess,
  normalizeTorrentActionResponse,
  calculateTorrentRatio,
} from "./utils";
import type { TorrentItem } from "@/types";

const sampleTorrents: TorrentItem[] = [
  {
    hash: "h1",
    name: "Ubuntu ISO",
    state: "downloading",
    progress: 50,
    total_size: 1000,
    downloaded: 500,
    uploaded: 0,
    download_speed: 5000,
    upload_speed: 0,
    eta: 100,
    save_path: "/downloads",
  },
  {
    hash: "h2",
    name: "Debian ISO",
    state: "uploading",
    progress: 100,
    total_size: 2000,
    downloaded: 2000,
    uploaded: 4000,
    download_speed: 0,
    upload_speed: 1000,
    eta: 8640000,
    save_path: "/downloads",
  },
  {
    hash: "h3",
    name: "Paused Item",
    state: "pausedDL",
    progress: 10,
    total_size: 3000,
    downloaded: 300,
    uploaded: 0,
    download_speed: 0,
    upload_speed: 0,
    eta: 8640000,
    save_path: "/downloads",
  },
  {
    hash: "h4",
    name: "Error Item",
    state: "error",
    progress: 0,
    total_size: 4000,
    downloaded: 0,
    uploaded: 0,
    download_speed: 0,
    upload_speed: 0,
    eta: 8640000,
    save_path: "/downloads",
  },
];

describe("utils formatting", () => {
  it("formats bytes correctly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1073741824)).toBe("1 GB");
  });

  it("formats speed correctly", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(2048)).toBe("2 KB/s");
  });

  it("formats ETA correctly", () => {
    expect(formatEta(0)).toBe("∞");
    expect(formatEta(-1)).toBe("∞");
    expect(formatEta(8640000)).toBe("∞");
    expect(formatEta(45)).toBe("45s");
    expect(formatEta(125)).toBe("2m 5s");
    expect(formatEta(3665)).toBe("1h 1m");
  });

  it("maps torrent states to readable labels and colors", () => {
    expect(getTorrentStateLabel("downloading")).toBe("Downloading");
    expect(getTorrentStateLabel("uploading")).toBe("Seeding");
    expect(getTorrentStateLabel("pausedDL")).toBe("Paused");
    expect(getTorrentStateLabel("unknownState")).toBe("unknownState");

    expect(getTorrentStateColor("downloading")).toBe("text-accent");
    expect(getTorrentStateColor("uploading")).toBe("text-success");
    expect(getTorrentStateColor("error")).toBe("text-danger");
  });

  it("filters torrents by status category accurately", () => {
    expect(filterTorrents(sampleTorrents, "all")).toHaveLength(4);
    expect(filterTorrents(sampleTorrents, "downloading").map((t) => t.hash)).toEqual(["h1"]);
    expect(filterTorrents(sampleTorrents, "completed").map((t) => t.hash)).toEqual(["h2"]);
    expect(filterTorrents(sampleTorrents, "paused").map((t) => t.hash)).toEqual(["h3"]);
    expect(filterTorrents(sampleTorrents, "error").map((t) => t.hash)).toEqual(["h4"]);
    expect(filterTorrents(sampleTorrents, "active").map((t) => t.hash)).toEqual(["h1", "h2"]);
    expect(filterTorrents(sampleTorrents, "inactive").map((t) => t.hash)).toEqual(["h3", "h4"]);
  });

  it("paginates items accurately with page size 10", () => {
    const items = Array.from({ length: 24 }, (_, idx) => idx + 1);
    const p1 = paginateItems(items, 1, 10);
    expect(p1.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p1.totalPages).toBe(3);
    expect(p1.startIndex).toBe(1);
    expect(p1.endIndex).toBe(10);

    const p3 = paginateItems(items, 3, 10);
    expect(p3.items).toEqual([21, 22, 23, 24]);
    expect(p3.currentPage).toBe(3);
    expect(p3.startIndex).toBe(21);
    expect(p3.endIndex).toBe(24);

    // Clamps out-of-range page numbers safely
    const clamped = paginateItems(items, 99, 10);
    expect(clamped.currentPage).toBe(3);
  });

  it("formats system uptime cleanly", () => {
    expect(formatUptime(0)).toBe("0m");
    expect(formatUptime(1232520)).toBe("14d 6h 22m");
    expect(formatUptime(3660)).toBe("1h 1m");
  });

  describe("torrent add response helpers", () => {
    const userMetadataError =
      "Could not add magnet link (it may already exist in your download queue: 'TorrentsAddedMetadata({'added_torrent_ids': ['094a7f561ec0c6bafd4bee07842b610e3d475386'], 'failure_count': 0, 'pending_count': 0, 'success_count': 1})').";
    const userMetadataResult =
      "TorrentsAddedMetadata({'added_torrent_ids': ['094a7f561ec0c6bafd4bee07842b610e3d475386'], 'failure_count': 0, 'pending_count': 0, 'success_count': 1})";
    const failedMetadataResult =
      "TorrentsAddedMetadata({'added_torrent_ids': [], 'failure_count': 1, 'pending_count': 0, 'success_count': 0})";

    it("correctly identifies TorrentsAddedMetadata success in strings", () => {
      expect(isTorrentsAddedMetadataSuccess(userMetadataError)).toBe(true);
      expect(isTorrentsAddedMetadataSuccess(userMetadataResult)).toBe(true);
      expect(isTorrentsAddedMetadataSuccess(failedMetadataResult)).toBe(false);
      expect(isTorrentsAddedMetadataSuccess("Some unrelated error")).toBe(false);
      expect(isTorrentsAddedMetadataSuccess(null)).toBe(false);
    });

    it("evaluates isTorrentAddSuccess correctly for both real and false-negative responses", () => {
      expect(isTorrentAddSuccess({ success: true, message: "Queued" })).toBe(true);
      expect(
        isTorrentAddSuccess({
          success: false,
          message: userMetadataError,
          data: { result: userMetadataResult },
        })
      ).toBe(true);
      expect(
        isTorrentAddSuccess({
          success: false,
          message: "Could not add magnet: failed",
          data: { result: failedMetadataResult },
        })
      ).toBe(false);
      expect(isTorrentAddSuccess(null)).toBe(false);
    });

    it("normalizes false-negative TorrentActionResponse to success: true", () => {
      const normalized = normalizeTorrentActionResponse({
        success: false,
        message: userMetadataError,
        data: { result: userMetadataResult },
      });
      expect(normalized.success).toBe(true);
      expect(normalized.message).toBe("Magnet link successfully queued for download.");

      const genuineFailure = normalizeTorrentActionResponse({
        success: false,
        message: "Network error",
      });
      expect(genuineFailure.success).toBe(false);
      expect(genuineFailure.message).toBe("Network error");
    });
  });

  describe("calculateTorrentRatio", () => {
    it("calculates normal download ratio accurately", () => {
      expect(calculateTorrentRatio({ downloaded: 1000, uploaded: 1500 })).toBe("1.50");
      expect(calculateTorrentRatio({ downloaded: 2000, uploaded: 1000 })).toBe("0.50");
    });

    it("calculates re-seed ratio against total_size when downloaded is 0", () => {
      // Re-seed torrent with 0 downloaded bytes
      expect(
        calculateTorrentRatio({
          downloaded: 0,
          uploaded: 500,
          total_size: 1000,
        })
      ).toBe("0.50");
      expect(
        calculateTorrentRatio({
          downloaded: 0,
          uploaded: 2000,
          total_size: 1000,
        })
      ).toBe("2.00");
    });

    it("preserves previous ratio on re-seed when downloaded is 0 and uploaded reset", () => {
      // Torrent was reseeded or is checking; downloaded & uploaded temporarily 0
      expect(
        calculateTorrentRatio(
          {
            downloaded: 0,
            uploaded: 0,
            total_size: 1000,
          },
          1.75
        )
      ).toBe("1.75");
    });

    it("accumulates new reseed uploads seamlessly on top of cached prior ratio", () => {
      // Torrent had 1.50 ratio before reseed, now uploads 200MB more on 1000MB torrent
      expect(
        calculateTorrentRatio(
          {
            downloaded: 0,
            uploaded: 200,
            total_size: 1000,
          },
          1.5
        )
      ).toBe("1.70");
    });

    it("respects native qBittorrent ratio if available and valid", () => {
      expect(calculateTorrentRatio({ ratio: 2.345, downloaded: 1000, uploaded: 2345 })).toBe(
        "2.35"
      );
    });

    it("handles zero and infinite edge cases cleanly", () => {
      expect(calculateTorrentRatio({ downloaded: 0, uploaded: 0 })).toBe("0.00");
      expect(calculateTorrentRatio({ downloaded: 0, uploaded: 500, total_size: 0 })).toBe(
        "∞"
      );
    });
  });
});
