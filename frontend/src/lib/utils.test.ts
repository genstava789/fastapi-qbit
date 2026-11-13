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
  isTorrentComplete,
  isTorrentDownloading,
  getTorrentDownloadPriorityTier,
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

    it("strictly preserves native qBittorrent ratio and prevents runaway increment even with cachedRatio", () => {
      // Even if re-seed mode parameters or cachedRatio are present, native ratio from backend must prevail
      expect(
        calculateTorrentRatio(
          {
            ratio: 1.25,
            downloaded: 0,
            uploaded: 500,
            total_size: 1000,
          },
          10.5
        )
      ).toBe("1.25");
    });

    it("respects native ratio of zero cleanly", () => {
      expect(calculateTorrentRatio({ ratio: 0, downloaded: 0, uploaded: 0, total_size: 1000 })).toBe(
        "0.00"
      );
    });

    it("handles zero and infinite edge cases cleanly", () => {
      expect(calculateTorrentRatio({ downloaded: 0, uploaded: 0 })).toBe("0.00");
      expect(calculateTorrentRatio({ downloaded: 0, uploaded: 500, total_size: 0 })).toBe(
        "∞"
      );
    });
  });

  describe("isTorrentComplete", () => {
    it("returns true when progress is 100% or greater", () => {
      expect(isTorrentComplete({ progress: 100, state: "downloading" })).toBe(true);
      expect(isTorrentComplete({ progress: 100.0, state: "pausedUP" })).toBe(true);
    });

    it("returns true for seeding states regardless of progress", () => {
      expect(isTorrentComplete({ progress: 99.9, state: "uploading" })).toBe(true);
      expect(isTorrentComplete({ progress: 0, state: "pausedUP" })).toBe(true);
      expect(isTorrentComplete({ progress: 0, state: "stalledUP" })).toBe(true);
      expect(isTorrentComplete({ progress: 0, state: "forcedUP" })).toBe(true);
      expect(isTorrentComplete({ progress: 0, state: "queuedUP" })).toBe(true);
      expect(isTorrentComplete({ progress: 0, state: "checkingUP" })).toBe(true);
    });

    it("returns false for incomplete/downloading states with progress < 100", () => {
      expect(isTorrentComplete({ progress: 50, state: "downloading" })).toBe(false);
      expect(isTorrentComplete({ progress: 0, state: "metaDL" })).toBe(false);
      expect(isTorrentComplete({ progress: 85, state: "pausedDL" })).toBe(false);
      expect(isTorrentComplete({ progress: 0, state: "error" })).toBe(false);
    });
  });

  describe("isTorrentDownloading", () => {
    it("returns true for active downloads with progress < 100", () => {
      expect(
        isTorrentDownloading({
          hash: "1",
          name: "Test",
          state: "downloading",
          progress: 50,
          total_size: 1000,
          downloaded: 500,
          uploaded: 0,
          download_speed: 1024,
          upload_speed: 0,
          eta: 50,
          save_path: "/downloads",
        })
      ).toBe(true);
    });

    it("returns true for queued or stalled downloads", () => {
      expect(
        isTorrentDownloading({
          hash: "2",
          name: "Queued",
          state: "queuedDL",
          progress: 10,
          total_size: 1000,
          downloaded: 100,
          uploaded: 0,
          download_speed: 0,
          upload_speed: 0,
          eta: 0,
          save_path: "/downloads",
        })
      ).toBe(true);
      expect(
        isTorrentDownloading({
          hash: "3",
          name: "Stalled",
          state: "stalledDL",
          progress: 20,
          total_size: 1000,
          downloaded: 200,
          uploaded: 0,
          download_speed: 0,
          upload_speed: 0,
          eta: 0,
          save_path: "/downloads",
        })
      ).toBe(true);
    });

    it("returns false when progress >= 100", () => {
      expect(
        isTorrentDownloading({
          hash: "4",
          name: "Complete",
          state: "uploading",
          progress: 100,
          total_size: 1000,
          downloaded: 1000,
          uploaded: 500,
          download_speed: 0,
          upload_speed: 100,
          eta: 0,
          save_path: "/downloads",
        })
      ).toBe(false);
    });

    it("returns false for paused or error downloads", () => {
      expect(
        isTorrentDownloading({
          hash: "5",
          name: "Paused",
          state: "pausedDL",
          progress: 50,
          total_size: 1000,
          downloaded: 500,
          uploaded: 0,
          download_speed: 0,
          upload_speed: 0,
          eta: 0,
          save_path: "/downloads",
        })
      ).toBe(false);
      expect(
        isTorrentDownloading({
          hash: "6",
          name: "Error",
          state: "error",
          progress: 0,
          total_size: 1000,
          downloaded: 0,
          uploaded: 0,
          download_speed: 0,
          upload_speed: 0,
          eta: 0,
          save_path: "/downloads",
        })
      ).toBe(false);
    });
  });

  describe("getTorrentDownloadPriorityTier", () => {
    it("assigns Tier 0 to actively downloading torrents", () => {
      expect(
        getTorrentDownloadPriorityTier({
          hash: "1",
          name: "Active DL",
          state: "downloading",
          progress: 25,
          total_size: 1000,
          downloaded: 250,
          uploaded: 0,
          download_speed: 500000,
          upload_speed: 0,
          eta: 10,
          save_path: "/downloads",
        })
      ).toBe(0);
    });

    it("assigns Tier 1 to queued or stalled downloads", () => {
      expect(
        getTorrentDownloadPriorityTier({
          hash: "2",
          name: "Stalled DL",
          state: "stalledDL",
          progress: 50,
          total_size: 1000,
          downloaded: 500,
          uploaded: 0,
          download_speed: 0,
          upload_speed: 0,
          eta: 0,
          save_path: "/downloads",
        })
      ).toBe(1);
    });

    it("assigns Tier 2 to completed or seeding torrents", () => {
      expect(
        getTorrentDownloadPriorityTier({
          hash: "3",
          name: "Seeding",
          state: "uploading",
          progress: 100,
          total_size: 1000,
          downloaded: 1000,
          uploaded: 2000,
          download_speed: 0,
          upload_speed: 50000,
          eta: 0,
          save_path: "/downloads",
        })
      ).toBe(2);
    });

    it("assigns Tier 3 to paused or error torrents", () => {
      expect(
        getTorrentDownloadPriorityTier({
          hash: "4",
          name: "Paused",
          state: "pausedDL",
          progress: 30,
          total_size: 1000,
          downloaded: 300,
          uploaded: 0,
          download_speed: 0,
          upload_speed: 0,
          eta: 0,
          save_path: "/downloads",
        })
      ).toBe(3);
      expect(
        getTorrentDownloadPriorityTier({
          hash: "5",
          name: "Error",
          state: "error",
          progress: 0,
          total_size: 1000,
          downloaded: 0,
          uploaded: 0,
          download_speed: 0,
          upload_speed: 0,
          eta: 0,
          save_path: "/downloads",
        })
      ).toBe(3);
    });

    it("strictly preserves lower tier number priority (Tier 0 < Tier 1 < Tier 2 < Tier 3)", () => {
      const active = {
        hash: "1",
        name: "Active",
        state: "downloading",
        progress: 10,
        total_size: 1000,
        downloaded: 100,
        uploaded: 0,
        download_speed: 100,
        upload_speed: 0,
        eta: 10,
        save_path: "/dl",
      };
      const stalled = {
        hash: "2",
        name: "Stalled",
        state: "stalledDL",
        progress: 90,
        total_size: 1000,
        downloaded: 900,
        uploaded: 0,
        download_speed: 0,
        upload_speed: 0,
        eta: 0,
        save_path: "/dl",
      };
      const seeding = {
        hash: "3",
        name: "Seeding",
        state: "uploading",
        progress: 100,
        total_size: 1000,
        downloaded: 1000,
        uploaded: 500,
        download_speed: 0,
        upload_speed: 100,
        eta: 0,
        save_path: "/dl",
      };
      const paused = {
        hash: "4",
        name: "Paused",
        state: "pausedDL",
        progress: 50,
        total_size: 1000,
        downloaded: 500,
        uploaded: 0,
        download_speed: 0,
        upload_speed: 0,
        eta: 0,
        save_path: "/dl",
      };

      const tierActive = getTorrentDownloadPriorityTier(active);
      const tierStalled = getTorrentDownloadPriorityTier(stalled);
      const tierSeeding = getTorrentDownloadPriorityTier(seeding);
      const tierPaused = getTorrentDownloadPriorityTier(paused);

      expect(tierActive).toBeLessThan(tierStalled);
      expect(tierStalled).toBeLessThan(tierSeeding);
      expect(tierSeeding).toBeLessThan(tierPaused);
    });
  });
});
