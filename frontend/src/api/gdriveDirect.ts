import { useAppStore } from "@/stores/appStore";
import type {
  DriveBreadcrumb,
  DriveFileItem,
  DriveListResponse,
  DriveStorageQuota,
} from "@/types";

const GDRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// In-memory cache for folder names and parent associations to avoid redundant roundtrips
const folderNameCache = new Map<string, { id: string; name: string; parentId?: string | null }>();
folderNameCache.set("root", { id: "root", name: "My Drive", parentId: null });

// Workspace documents export formats
const WORKSPACE_EXPORT_FORMATS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: "pptx",
  },
  "application/vnd.google-apps.drawing": {
    mime: "image/png",
    ext: "png",
  },
};

/**
 * Custom error class for Google Drive API interactions
 */
export class GDriveApiError extends Error {
  status: number;
  details?: any;
  constructor(message: string, status = 500, details?: any) {
    super(message);
    this.name = "GDriveApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Retrieve a valid Google Drive access token directly in the browser.
 * Auto-refreshes if refresh token and credentials exist.
 * Optionally synchronizes once from the backend if frontend state is uninitialized.
 */
export async function getValidAccessToken(forceRefresh = false): Promise<string> {
  const store = useAppStore.getState();
  const now = Date.now();

  const currentToken = store.gdriveAccessToken;
  const expiry = store.gdriveTokenExpiry;
  const refreshToken = store.gdriveRefreshToken;
  const clientId = store.gdriveClientId;
  const clientSecret = store.gdriveClientSecret;

  // 1. Return cached access token if still fresh (more than 60s remaining)
  if (!forceRefresh && currentToken && (!expiry || expiry > now + 60000)) {
    return currentToken;
  }

  // 2. Direct client-side refresh via Google OAuth endpoint if refresh token is available
  if (refreshToken && clientId) {
    try {
      const params = new URLSearchParams({
        client_id: clientId,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      if (clientSecret) {
        params.append("client_secret", clientSecret);
      }

      const res = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (res.ok) {
        const tokenData = await res.json();
        if (tokenData.access_token) {
          const expiresIn = Number(tokenData.expires_in || 3600);
          const newExpiry = now + (expiresIn - 120) * 1000;
          store.setGDriveTokens({
            accessToken: tokenData.access_token,
            expiry: newExpiry,
          });
          return tokenData.access_token;
        }
      }
    } catch (e) {
      console.warn("Direct OAuth refresh failed, trying backend fallback:", e);
    }
  }

  // 3. Fallback: Check if backend holds active token and sync it to frontend storage once
  const activeInstance = store.instances.find((i) => i.id === store.activeInstanceId) || store.instances[0];
  if (activeInstance?.url) {
    try {
      const backendUrl = `${activeInstance.url.replace(/\/+$/, "")}${activeInstance.apiPrefix || "/api/v1"}/drive/token`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const backendRes = await fetch(backendUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (backendRes.ok) {
        const data = await backendRes.json();
        if (data.access_token) {
          const expTime = data.expiry ? new Date(data.expiry).getTime() : now + 3500 * 1000;
          store.setGDriveTokens({
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            clientId: data.client_id || clientId,
            clientSecret: data.client_secret || clientSecret,
            expiry: expTime,
          });
          return data.access_token;
        }
      }
    } catch {
      // Backend unreachable or token not on backend
    }
  }

  // 4. If we have a current token even if close to expiry, use it as last resort
  if (currentToken) {
    return currentToken;
  }

  throw new GDriveApiError("Google Drive is not authenticated. Please connect your account.", 401);
}

/**
 * Execute an authenticated fetch to Google Drive API with automatic 401 retry
 */
async function fetchGDriveApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  let token = await getValidAccessToken();

  const url = endpoint.startsWith("http") ? endpoint : `${GDRIVE_API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  let res = await fetch(url, { ...options, headers });

  // If 401 Unauthorized, refresh token and retry once
  if (res.status === 401) {
    try {
      token = await getValidAccessToken(true);
      headers.set("Authorization", `Bearer ${token}`);
      res = await fetch(url, { ...options, headers });
    } catch (refreshErr) {
      throw new GDriveApiError("Google Drive authorization expired. Please reconnect.", 401, refreshErr);
    }
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message =
      errorBody?.error?.message ||
      errorBody?.detail ||
      `Google Drive API error (${res.status}): ${res.statusText}`;
    throw new GDriveApiError(message, res.status, errorBody);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}

/**
 * List files and folders directly from Google Drive API v3
 */
export async function directListFiles(
  folderId = "root",
  pageToken?: string,
  searchQuery?: string
): Promise<DriveListResponse> {
  const isRoot = !folderId || folderId === "root";
  const effectiveFolderId = isRoot ? "root" : folderId;

  let q: string;
  if (searchQuery && searchQuery.trim()) {
    const escaped = searchQuery.trim().replace(/'/g, "\\'");
    q = `name contains '${escaped}' and trashed = false`;
  } else {
    q = `'${effectiveFolderId}' in parents and trashed = false`;
  }

  const params = new URLSearchParams({
    q,
    pageSize: "100",
    fields:
      "nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, starred, parents, webViewLink, webContentLink, iconLink, thumbnailLink)",
    orderBy: "folder,name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  const data = await fetchGDriveApi<{
    files?: any[];
    nextPageToken?: string;
  }>(`/files?${params.toString()}`);

  const rawFiles = data.files || [];

  // Populate cache with items discovered in this listing
  for (const item of rawFiles) {
    if (item.mimeType === "application/vnd.google-apps.folder") {
      folderNameCache.set(item.id, {
        id: item.id,
        name: item.name,
        parentId: item.parents?.[0] || null,
      });
    }
  }

  // Format file items
  const files: DriveFileItem[] = rawFiles.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size !== undefined ? Number(f.size) : null,
    modifiedTime: f.modifiedTime || null,
    parents: f.parents || null,
    parentId: f.parents?.[0] || null,
    webViewLink: f.webViewLink || null,
    webContentLink: f.webContentLink || null,
    iconLink: f.iconLink || null,
    thumbnailLink: f.thumbnailLink || null,
  }));

  // Build breadcrumbs directly
  let breadcrumbs: DriveBreadcrumb[] = [];
  let currentFolderName = "My Drive";
  let parentId: string | null = null;

  if (!isRoot) {
    breadcrumbs = await directGetFolderPath(effectiveFolderId);
    if (breadcrumbs.length > 0) {
      currentFolderName = breadcrumbs[breadcrumbs.length - 1].name;
      parentId = breadcrumbs.length >= 2 ? breadcrumbs[breadcrumbs.length - 2].id : "root";
    }
  }

  return {
    files,
    nextPageToken: data.nextPageToken || null,
    currentFolderId: effectiveFolderId,
    currentFolderName,
    parentId,
    breadcrumbs,
  };
}

/**
 * Build folder breadcrumbs directly from Google Drive API
 */
export async function directGetFolderPath(folderId: string): Promise<DriveBreadcrumb[]> {
  if (!folderId || folderId === "root") {
    return [{ id: "root", name: "My Drive" }];
  }

  const crumbs: DriveBreadcrumb[] = [];
  let currentId: string | null = folderId;
  const visited = new Set<string>();

  while (currentId && currentId !== "root" && !visited.has(currentId)) {
    visited.add(currentId);

    // Check memory cache first
    let cached = folderNameCache.get(currentId);
    if (!cached) {
      try {
        const item: { id: string; name: string; parents?: string[] } =
          await fetchGDriveApi<{ id: string; name: string; parents?: string[] }>(
            `/files/${encodeURIComponent(currentId)}?fields=id,name,parents&supportsAllDrives=true`
          );
        cached = {
          id: item.id,
          name: item.name,
          parentId: item.parents?.[0] || null,
        };
        folderNameCache.set(item.id, cached);
      } catch (err) {
        console.warn(`Could not resolve folder parent ${currentId}:`, err);
        break;
      }
    }

    crumbs.unshift({ id: cached.id, name: cached.name });
    currentId = cached.parentId || null;
  }

  // Prepend root if not already present
  if (crumbs.length === 0 || crumbs[0].id !== "root") {
    crumbs.unshift({ id: "root", name: "My Drive" });
  }

  return crumbs;
}

/**
 * Fetch metadata for a specific file directly
 */
export async function directGetFileMeta(fileId: string): Promise<DriveFileItem> {
  const item = await fetchGDriveApi<any>(
    `/files/${encodeURIComponent(
      fileId
    )}?fields=id,name,mimeType,size,modifiedTime,createdTime,starred,parents,webViewLink,webContentLink,iconLink,thumbnailLink&supportsAllDrives=true`
  );

  return {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    size: item.size !== undefined ? Number(item.size) : null,
    modifiedTime: item.modifiedTime || null,
    parents: item.parents || null,
    parentId: item.parents?.[0] || null,
    webViewLink: item.webViewLink || null,
    webContentLink: item.webContentLink || null,
    iconLink: item.iconLink || null,
    thumbnailLink: item.thumbnailLink || null,
  };
}

/**
 * Create a new folder directly in Google Drive
 */
export async function directCreateFolder(
  name: string,
  parentId?: string
): Promise<DriveFileItem> {
  const effectiveParent = parentId && parentId !== "root" ? parentId : "root";
  const item = await fetchGDriveApi<any>("/files?supportsAllDrives=true", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [effectiveParent],
    }),
  });

  const created: DriveFileItem = {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    size: null,
    modifiedTime: new Date().toISOString(),
    parents: [effectiveParent],
  };

  folderNameCache.set(created.id, {
    id: created.id,
    name: created.name,
    parentId: effectiveParent,
  });

  return created;
}

/**
 * Rename a file or folder directly in Google Drive
 */
export async function directRenameFile(
  fileId: string,
  newName: string
): Promise<DriveFileItem> {
  const item = await fetchGDriveApi<any>(
    `/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    }
  );

  if (folderNameCache.has(fileId)) {
    const existing = folderNameCache.get(fileId)!;
    folderNameCache.set(fileId, { ...existing, name: newName });
  }

  return {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    size: item.size !== undefined ? Number(item.size) : null,
    modifiedTime: item.modifiedTime || new Date().toISOString(),
    parents: item.parents || null,
  };
}

/**
 * Delete a file or folder directly in Google Drive (moves to trash)
 */
export async function directDeleteFile(
  fileId: string,
  permanent = false
): Promise<{ success: boolean; file_id: string }> {
  if (permanent) {
    await fetchGDriveApi(`/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
      method: "DELETE",
    });
  } else {
    await fetchGDriveApi(`/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }

  folderNameCache.delete(fileId);
  return { success: true, file_id: fileId };
}

/**
 * Batch delete multiple files directly from Google Drive
 */
export async function directBatchDeleteFiles(
  fileIds: string[]
): Promise<{ success: boolean; deleted: string[]; errors: any[] }> {
  const deleted: string[] = [];
  const errors: any[] = [];

  const results = await Promise.allSettled(
    fileIds.map((id) => directDeleteFile(id))
  );

  results.forEach((res, index) => {
    const id = fileIds[index];
    if (res.status === "fulfilled") {
      deleted.push(id);
    } else {
      errors.push({ file_id: id, error: res.reason?.message || "Failed to delete" });
    }
  });

  return { success: errors.length === 0, deleted, errors };
}

/**
 * Fetch Google Drive storage quota and user identity directly
 */
export async function directGetStorageQuota(): Promise<DriveStorageQuota> {
  const data = await fetchGDriveApi<{
    storageQuota?: {
      limit?: string | number;
      usage?: string | number;
      usageInDrive?: string | number;
      usageInTrash?: string | number;
    };
    user?: {
      displayName?: string;
      emailAddress?: string;
      photoLink?: string;
    };
  }>("/about?fields=storageQuota,user");

  const q = data.storageQuota || {};
  const u = data.user || {};

  return {
    limit: Number(q.limit || 0),
    usage: Number(q.usage || 0),
    usageInDrive: Number(q.usageInDrive || 0),
    usageInTrash: Number(q.usageInTrash || 0),
    user_email: u.emailAddress || null,
    user_name: u.displayName || null,
    user_photo: u.photoLink || null,
  };
}

/**
 * Empty trash directly in Google Drive
 */
export async function directEmptyTrash(): Promise<{ success: boolean; message: string }> {
  await fetchGDriveApi("/files/trash", { method: "DELETE" });
  return { success: true, message: "Google Drive trash emptied" };
}

/**
 * Download a file directly from Google Drive API to user's device
 */
export async function directDownloadFile(
  fileId: string,
  fileName: string,
  mimeType = "",
  onProgress?: (p: { percent: number; loaded: number; speed?: string }) => void
): Promise<void> {
  const token = await getValidAccessToken();

  let downloadUrl: string;
  let exportExt = "";

  // Handle Google Workspace documents export
  const exportEntry = WORKSPACE_EXPORT_FORMATS[mimeType];
  if (exportEntry) {
    downloadUrl = `${GDRIVE_API_BASE}/files/${encodeURIComponent(
      fileId
    )}/export?mimeType=${encodeURIComponent(exportEntry.mime)}`;
    exportExt = `.${exportEntry.ext}`;
  } else {
    downloadUrl = `${GDRIVE_API_BASE}/files/${encodeURIComponent(
      fileId
    )}?alt=media&supportsAllDrives=true`;
  }

  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new GDriveApiError(
      `Download failed (${response.status}): ${errText || response.statusText}`,
      response.status
    );
  }

  const contentLength = response.headers.get("Content-Length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  const reader = response.body?.getReader();

  let blob: Blob;

  if (reader && total > 0 && onProgress) {
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    const startTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loaded += value.length;

      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? loaded / elapsed : 0;
      const speedStr =
        speed > 1048576
          ? `${(speed / 1048576).toFixed(1)} MB/s`
          : `${(speed / 1024).toFixed(0)} KB/s`;

      onProgress({
        percent: Math.min(100, Math.round((loaded / total) * 100)),
        loaded,
        speed: speedStr,
      });
    }

    blob = new Blob(chunks as BlobPart[]);
  } else {
    blob = await response.blob();
  }

  const resolvedName = exportExt && !fileName.endsWith(exportExt) ? `${fileName}${exportExt}` : fileName;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = resolvedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}

/**
 * Direct Google OAuth authorization code exchange
 */
export async function directExchangeAuthCode(
  code: string,
  redirectUri: string
): Promise<{ success: boolean; message: string }> {
  const store = useAppStore.getState();
  const clientId = store.gdriveClientId;
  const clientSecret = store.gdriveClientSecret;

  if (clientId && clientSecret) {
    try {
      const params = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });

      const res = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (res.ok) {
        const data = await res.json();
        const expiresIn = Number(data.expires_in || 3600);
        store.setGDriveTokens({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiry: Date.now() + (expiresIn - 120) * 1000,
        });
        return { success: true, message: "Google Drive authenticated successfully." };
      }
    } catch (e) {
      console.warn("Direct code exchange failed, falling back to backend:", e);
    }
  }

  // Fallback to active backend if client secret is hosted there
  const activeInstance = store.instances.find((i) => i.id === store.activeInstanceId) || store.instances[0];
  if (activeInstance?.url) {
    const backendUrl = `${activeInstance.url.replace(/\/+$/, "")}${activeInstance.apiPrefix || "/api/v1"}/drive/auth/callback`;
    const res = await fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    });
    if (res.ok) {
      // Auto-sync token to frontend storage
      await getValidAccessToken(true).catch(() => {});
      return { success: true, message: "Google Drive authenticated successfully." };
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to exchange authorization code.");
  }

  throw new Error("Missing Google OAuth Client ID & Secret for direct authentication.");
}

/**
 * Generate Google OAuth authorization URL
 */
export function directGetAuthUrl(redirectUri?: string): string {
  const store = useAppStore.getState();
  const clientId =
    store.gdriveClientId ||
    "YOUR_CLIENT_ID.apps.googleusercontent.com";

  const effectiveRedirect =
    redirectUri || (typeof window !== "undefined" ? `${window.location.origin}/drive` : "http://localhost:5173/drive");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: effectiveRedirect,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });

  return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
}

/**
 * Test Google Drive connection directly
 */
export async function directTestConnection(): Promise<{ success: boolean; user: string; email: string }> {
  const quota = await directGetStorageQuota();
  return {
    success: true,
    user: quota.user_name || "Google User",
    email: quota.user_email || "Connected",
  };
}
