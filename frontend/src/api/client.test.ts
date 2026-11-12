import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { QbitApi, DriveApi } from "./client";

vi.mock("axios", () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    defaults: { baseURL: "https://mild-leaf.nyc.boxd.sh/api/v1" },
  };
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
    },
  };
});

describe("QbitApi client", () => {
  let api: QbitApi;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new QbitApi("https://mild-leaf.nyc.boxd.sh", "/api/v1");
    mockClient = (axios.create as any).mock.results[0].value;
  });

  it("constructs export torrent URL properly", () => {
    expect(api.getExportUrl("abc123")).toBe(
      "https://mild-leaf.nyc.boxd.sh/api/v1/torrents/abc123/export"
    );
  });

  it("calls health endpoint", async () => {
    const mockHealth = {
      status: "healthy",
      app_version: "1.0.0",
      qbittorrent_connected: true,
      qbittorrent_version: "v4.6.3",
    };
    mockClient.get.mockResolvedValueOnce({ data: mockHealth });
    const res = await api.getHealth();
    expect(mockClient.get).toHaveBeenCalledWith("/health");
    expect(res).toEqual(mockHealth);
  });

  it("calls listTorrents with optional filters", async () => {
    mockClient.get.mockResolvedValueOnce({ data: [] });
    await api.listTorrents({ status_filter: "downloading" });
    expect(mockClient.get).toHaveBeenCalledWith("/torrents", {
      params: { status_filter: "downloading" },
    });
  });

  it("calls addMagnet with magnet payload", async () => {
    const payload = { magnet_url: "magnet:?xt=urn:btih:1234", is_paused: true };
    mockClient.post.mockResolvedValueOnce({
      data: { success: true, message: "Queued" },
    });
    const res = await api.addMagnet(payload);
    expect(mockClient.post).toHaveBeenCalledWith(
      "/torrents/add-magnet",
      payload
    );
    expect(res.success).toBe(true);
  });

  it("normalizes TorrentsAddedMetadata response to success: true for addMagnet", async () => {
    const payload = { magnet_url: "magnet:?xt=urn:btih:094a7f561ec0c6bafd4bee07842b610e3d475386" };
    const rawBackendErrorMsg =
      "Could not add magnet link (it may already exist in your download queue: 'TorrentsAddedMetadata({'added_torrent_ids': ['094a7f561ec0c6bafd4bee07842b610e3d475386'], 'failure_count': 0, 'pending_count': 0, 'success_count': 1})').";
    mockClient.post.mockResolvedValueOnce({
      data: {
        success: false,
        message: rawBackendErrorMsg,
        data: {
          result:
            "TorrentsAddedMetadata({'added_torrent_ids': ['094a7f561ec0c6bafd4bee07842b610e3d475386'], 'failure_count': 0, 'pending_count': 0, 'success_count': 1})",
        },
      },
    });
    const res = await api.addMagnet(payload);
    expect(res.success).toBe(true);
    expect(res.message).toBe("Magnet link berhasil ditambahkan!");
  });

  it("keeps success: false for real add failures with empty added_torrent_ids", async () => {
    const payload = { magnet_url: "magnet:?xt=urn:btih:failed" };
    mockClient.post.mockResolvedValueOnce({
      data: {
        success: false,
        message:
          "Could not add magnet link (it may already exist in your download queue: 'TorrentsAddedMetadata({'added_torrent_ids': [], 'failure_count': 1, 'pending_count': 0, 'success_count': 0})').",
        data: {
          result:
            "TorrentsAddedMetadata({'added_torrent_ids': [], 'failure_count': 1, 'pending_count': 0, 'success_count': 0})",
        },
      },
    });
    const res = await api.addMagnet(payload);
    expect(res.success).toBe(false);
  });

  it("calls pause, resume, and delete endpoints", async () => {
    mockClient.post.mockResolvedValue({ data: { success: true, message: "ok" } });
    mockClient.delete.mockResolvedValue({ data: { success: true, message: "ok" } });

    await api.pauseTorrent("hash1");
    expect(mockClient.post).toHaveBeenCalledWith("/torrents/hash1/pause");

    await api.resumeTorrent("hash1");
    expect(mockClient.post).toHaveBeenCalledWith("/torrents/hash1/resume");

    await api.deleteTorrent("hash1", true);
    expect(mockClient.delete).toHaveBeenCalledWith("/torrents/hash1", {
      params: { delete_files: true },
    });
  });

  it("calls system stats and server paths endpoints", async () => {
    mockClient.get.mockResolvedValueOnce({ data: { hostname: "vps-nyc" } });
    const stats = await api.getSystemStats();
    expect(mockClient.get).toHaveBeenCalledWith("/system/stats");
    expect(stats.hostname).toBe("vps-nyc");

    mockClient.get.mockResolvedValueOnce({
      data: { current_path: "/downloads", parent_path: null, directories: [] },
    });
    const paths = await api.browseServerPaths("/downloads");
    expect(mockClient.get).toHaveBeenCalledWith("/system/paths", {
      params: { path: "/downloads" },
    });
    expect(paths.current_path).toBe("/downloads");
  });

  it("passes skip_checking and auto_tmm on re-seed addMagnet", async () => {
    const payload = {
      magnet_url: "magnet:?xt=urn:btih:reseed",
      save_path: "/home/boxd/Downloads/ubuntu",
      skip_checking: true,
      auto_tmm: false,
    };
    mockClient.post.mockResolvedValueOnce({
      data: { success: true, message: "Queued" },
    });
    await api.addMagnet(payload);
    expect(mockClient.post).toHaveBeenCalledWith(
      "/torrents/add-magnet",
      payload
    );
  });
});

describe("DriveApi client", () => {
  let driveApi: DriveApi;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    driveApi = new DriveApi("https://mild-leaf.nyc.boxd.sh", "/api/v1");
    mockClient = (axios.create as any).mock.results[0].value;
  });

  it("handles drive file delete, rename, and batch delete", async () => {
    mockClient.delete.mockResolvedValueOnce({
      data: { success: true, file_id: "file123" },
    });
    const delRes = await driveApi.deleteDriveFile("file123");
    expect(mockClient.delete).toHaveBeenCalledWith("/drive/files/file123");
    expect(delRes.success).toBe(true);

    mockClient.patch.mockResolvedValueOnce({
      data: { success: true, file: { id: "file123", name: "New Name.iso" } },
    });
    const renRes = await driveApi.renameDriveFile("file123", "New Name.iso");
    expect(mockClient.patch).toHaveBeenCalledWith("/drive/files/file123", {
      name: "New Name.iso",
    });
    expect(renRes.file.name).toBe("New Name.iso");

    mockClient.post.mockResolvedValueOnce({
      data: { success: true, deleted: ["f1", "f2"], errors: [] },
    });
    const batchRes = await driveApi.batchDeleteDriveFiles(["f1", "f2"]);
    expect(mockClient.post).toHaveBeenCalledWith("/drive/files/batch-delete", {
      file_ids: ["f1", "f2"],
    });
    expect(batchRes.deleted).toEqual(["f1", "f2"]);
  });
});

