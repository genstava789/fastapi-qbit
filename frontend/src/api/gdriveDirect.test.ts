import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useAppStore } from "@/stores/appStore";
import {
  directListFiles,
  directGetFolderPath,
  directGetFileMeta,
  directCreateFolder,
  directRenameFile,
  directDeleteFile,
  directGetStorageQuota,
  directEmptyTrash,
  getValidAccessToken,
  directTestConnection,
  directDownloadFile,
} from "./gdriveDirect";

describe("gdriveDirect", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    useAppStore.setState({
      gdriveAccessToken: "test-valid-token",
      gdriveTokenExpiry: Date.now() + 3600 * 1000,
      gdriveRefreshToken: "test-refresh-token",
      gdriveClientId: "test-client-id",
      gdriveClientSecret: "test-client-secret",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("retrieves valid access token from appStore directly", async () => {
    const token = await getValidAccessToken();
    expect(token).toBe("test-valid-token");
  });

  it("fetches file list directly from Google Drive API v3 without backend", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        files: [
          {
            id: "f1",
            name: "Movies",
            mimeType: "application/vnd.google-apps.folder",
            parents: ["root"],
          },
          {
            id: "f2",
            name: "sample.mkv",
            mimeType: "video/x-matroska",
            size: "104857600",
            modifiedTime: "2026-01-01T00:00:00Z",
            parents: ["root"],
            webContentLink: "https://drive.google.com/uc?id=f2&export=download",
          },
        ],
        nextPageToken: null,
      }),
    });

    const res = await directListFiles("root");
    expect(res.files).toHaveLength(2);
    expect(res.files[0].id).toBe("f1");
    expect(res.files[0].name).toBe("Movies");
    expect(res.files[1].name).toBe("sample.mkv");
    expect(res.files[1].size).toBe(104857600);
    expect(res.currentFolderId).toBe("root");
    expect(res.currentFolderName).toBe("My Drive");

    // Verify called Google Drive API v3 directly
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain("https://www.googleapis.com/drive/v3/files");
    expect(decodeURIComponent(calledUrl).replace(/\+/g, " ")).toContain("'root' in parents");

    const calledHeaders = (globalThis.fetch as any).mock.calls[0][1].headers;
    expect(calledHeaders.get("Authorization")).toBe("Bearer test-valid-token");
  });

  it("builds folder breadcrumbs directly from Google Drive API", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("sub-folder-id")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: "sub-folder-id",
            name: "Anime",
            parents: ["parent-folder-id"],
          }),
        });
      }
      if (url.includes("parent-folder-id")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: "parent-folder-id",
            name: "Media",
            parents: ["root"],
          }),
        });
      }
      return Promise.reject(new Error("Not found"));
    });

    const crumbs = await directGetFolderPath("sub-folder-id");
    expect(crumbs).toHaveLength(3);
    expect(crumbs[0]).toEqual({ id: "root", name: "My Drive" });
    expect(crumbs[1]).toEqual({ id: "parent-folder-id", name: "Media" });
    expect(crumbs[2]).toEqual({ id: "sub-folder-id", name: "Anime" });
  });

  it("fetches single file metadata directly", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "doc-123",
        name: "Notes.pdf",
        mimeType: "application/pdf",
        size: "2048",
        modifiedTime: "2026-03-01T12:00:00Z",
        parents: ["root"],
        webContentLink: "https://drive.google.com/uc?id=doc-123&export=download",
      }),
    });

    const meta = await directGetFileMeta("doc-123");
    expect(meta.id).toBe("doc-123");
    expect(meta.name).toBe("Notes.pdf");
    expect(meta.mimeType).toBe("application/pdf");
    expect(meta.size).toBe(2048);
  });

  it("creates a folder directly in Google Drive", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "new-folder-99",
        name: "New Project",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
      }),
    });

    const created = await directCreateFolder("New Project", "root");
    expect(created.id).toBe("new-folder-99");
    expect(created.name).toBe("New Project");

    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({
      name: "New Project",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root"],
    });
  });

  it("renames a file directly in Google Drive", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "file-55",
        name: "Renamed.txt",
        mimeType: "text/plain",
      }),
    });

    const renamed = await directRenameFile("file-55", "Renamed.txt");
    expect(renamed.id).toBe("file-55");
    expect(renamed.name).toBe("Renamed.txt");

    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ name: "Renamed.txt" });
  });

  it("deletes a file directly in Google Drive by moving to trash", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "file-del",
        trashed: true,
      }),
    });

    const res = await directDeleteFile("file-del");
    expect(res.success).toBe(true);
    expect(res.file_id).toBe("file-del");

    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ trashed: true });
  });

  it("retrieves storage quota and user info directly from about endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        storageQuota: {
          limit: "107374182400",
          usage: "53687091200",
          usageInDrive: "50000000000",
          usageInTrash: "3687091200",
        },
        user: {
          displayName: "Alex Boxd",
          emailAddress: "alex@example.com",
          photoLink: "https://example.com/avatar.jpg",
        },
      }),
    });

    const quota = await directGetStorageQuota();
    expect(quota.limit).toBe(107374182400);
    expect(quota.usage).toBe(53687091200);
    expect(quota.user_name).toBe("Alex Boxd");
    expect(quota.user_email).toBe("alex@example.com");
    expect(quota.user_photo).toBe("https://example.com/avatar.jpg");
  });

  it("empties trash directly via Google Drive API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });

    const res = await directEmptyTrash();
    expect(res.success).toBe(true);
    expect(res.message).toBe("Google Drive trash emptied");

    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe("DELETE");
    expect(call[0]).toContain("/files/trash");
  });

  it("tests connection directly and returns user details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        storageQuota: { limit: "1000", usage: "500" },
        user: {
          displayName: "Tester User",
          emailAddress: "test@gmail.com",
        },
      }),
    });

    const res = await directTestConnection();
    expect(res.success).toBe(true);
    expect(res.user).toBe("Tester User");
    expect(res.email).toBe("test@gmail.com");
  });
});
