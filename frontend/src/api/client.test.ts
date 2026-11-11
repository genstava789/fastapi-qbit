import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { QbitApi } from "./client";

vi.mock("axios", () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
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

