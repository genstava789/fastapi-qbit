import axios, { type AxiosInstance } from "axios";
import type {
  AddMagnetRequest,
  HealthStatus,
  ServerPathsResponse,
  SystemStats,
  TorrentActionResponse,
  TorrentItem,
  DriveBreadcrumb,
  DriveFileItem,
  DriveListResponse,
  DriveStorageQuota,
  DriveUploadProgress,
} from "@/types";

export function createApiClient(baseUrl: string, apiPrefix = "/api/v1"): AxiosInstance {
  return axios.create({
    baseURL: `${baseUrl}${apiPrefix}`,
    timeout: 30000,
    headers: { "Content-Type": "application/json" },
  });
}

export class QbitApi {
  private client: AxiosInstance;

  constructor(baseUrl: string, apiPrefix = "/api/v1") {
    this.client = createApiClient(baseUrl, apiPrefix);
  }

  async getHealth(): Promise<HealthStatus> {
    const { data } = await this.client.get<HealthStatus>("/health");
    return data;
  }

  async listTorrents(params?: {
    status_filter?: string;
    category?: string;
    tag?: string;
  }): Promise<TorrentItem[]> {
    const { data } = await this.client.get<TorrentItem[]>("/torrents", { params });
    return data;
  }

  async getTorrent(hash: string): Promise<TorrentItem> {
    const { data } = await this.client.get<TorrentItem>(`/torrents/${hash}`);
    return data;
  }

  async addMagnet(payload: AddMagnetRequest): Promise<TorrentActionResponse> {
    const { data } = await this.client.post<TorrentActionResponse>(
      "/torrents/add-magnet",
      payload
    );
    return data;
  }

  async addTorrentFile(
    file: File,
    options?: {
      save_path?: string;
      category?: string;
      is_paused?: boolean;
      skip_checking?: boolean;
      auto_tmm?: boolean;
    }
  ): Promise<TorrentActionResponse> {
    const formData = new FormData();
    formData.append("file", file);
    if (options?.save_path) formData.append("save_path", options.save_path);
    if (options?.category) formData.append("category", options.category);
    if (options?.is_paused !== undefined)
      formData.append("is_paused", String(options.is_paused));
    if (options?.skip_checking !== undefined)
      formData.append("skip_checking", String(options.skip_checking));
    if (options?.auto_tmm !== undefined)
      formData.append("auto_tmm", String(options.auto_tmm));

    const { data } = await this.client.post<TorrentActionResponse>(
      "/torrents/add-file",
      formData,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return data;
  }

  async getSystemStats(): Promise<SystemStats> {
    const { data } = await this.client.get<SystemStats>("/system/stats");
    return data;
  }

  async browseServerPaths(path?: string): Promise<ServerPathsResponse> {
    const { data } = await this.client.get<ServerPathsResponse>("/system/paths", {
      params: path ? { path } : undefined,
    });
    return data;
  }

  async pauseTorrent(hash: string): Promise<TorrentActionResponse> {
    const { data } = await this.client.post<TorrentActionResponse>(
      `/torrents/${hash}/pause`
    );
    return data;
  }

  async resumeTorrent(hash: string): Promise<TorrentActionResponse> {
    const { data } = await this.client.post<TorrentActionResponse>(
      `/torrents/${hash}/resume`
    );
    return data;
  }

  async deleteTorrent(
    hash: string,
    deleteFiles = false
  ): Promise<TorrentActionResponse> {
    const { data } = await this.client.delete<TorrentActionResponse>(
      `/torrents/${hash}`,
      { params: { delete_files: deleteFiles } }
    );
    return data;
  }

  getExportUrl(hash: string): string {
    return `${this.client.defaults.baseURL}/torrents/${hash}/export`;
  }
}

export class DriveApi {
  private client: AxiosInstance;

  constructor(baseUrl: string, apiPrefix = "/api/v1") {
    this.client = createApiClient(baseUrl, apiPrefix);
  }

  async getAuthStatus(): Promise<{ authenticated: boolean; auth_url?: string | null }> {
    const { data } = await this.client.get<{ authenticated: boolean; auth_url?: string | null }>("/drive/auth/status");
    return data;
  }

  async getAuthUrl(redirectUri?: string): Promise<{ url: string; auth_url: string }> {
    const { data } = await this.client.get<{ auth_url?: string; url?: string }>("/drive/auth/url", {
      params: redirectUri ? { redirect_uri: redirectUri } : undefined,
    });
    const url = data.auth_url || data.url || "";
    return { url, auth_url: url };
  }

  async exchangeAuthCode(
    code: string,
    redirectUri?: string
  ): Promise<{ success: boolean; message: string }> {
    const { data } = await this.client.post<{ success: boolean; message: string }>(
      "/drive/auth/callback",
      { code, redirect_uri: redirectUri }
    );
    return data;
  }

  async logout(): Promise<{ success: boolean }> {
    const { data } = await this.client.post<{ success: boolean }>("/drive/auth/logout");
    return data;
  }

  async listFiles(folderId?: string, pageToken?: string): Promise<DriveListResponse> {
    const { data } = await this.client.get<DriveListResponse>("/drive/files", {
      params: { folder_id: folderId, page_token: pageToken },
    });
    return data;
  }

  async getFolderPath(fileId: string): Promise<DriveBreadcrumb[]> {
    const { data } = await this.client.get<DriveBreadcrumb[]>(
      `/drive/files/${fileId}/path`
    );
    return data;
  }

  async getStorageQuota(): Promise<DriveStorageQuota> {
    const { data } = await this.client.get<DriveStorageQuota>("/drive/storage");
    return data;
  }

  async createFolder(
    name: string,
    parentId?: string
  ): Promise<DriveFileItem> {
    const { data } = await this.client.post<DriveFileItem>("/drive/folders", {
      name,
      parent_id: parentId,
    });
    return data;
  }

  async startUpload(
    filePath?: string,
    folderId?: string,
    torrentHash?: string
  ): Promise<{ upload_id: string }> {
    const payload: { file_path?: string; folder_id?: string; torrent_hash?: string } = {};
    if (filePath) payload.file_path = filePath;
    if (folderId) payload.folder_id = folderId;
    if (torrentHash) payload.torrent_hash = torrentHash;

    const { data } = await this.client.post<{ upload_id: string }>("/drive/upload", payload);
    return data;
  }

  async uploadFileDirect(
    file: File,
    folderId?: string
  ): Promise<{ upload_id: string }> {
    const formData = new FormData();
    formData.append("file", file);
    if (folderId) formData.append("folder_id", folderId);

    const { data } = await this.client.post<{ upload_id: string }>(
      "/drive/upload-file",
      formData,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return data;
  }

  async getUploadProgress(uploadId: string): Promise<DriveUploadProgress> {
    const { data } = await this.client.get<DriveUploadProgress>(
      `/drive/upload/${uploadId}/progress`
    );
    return data;
  }

  async listUploads(): Promise<DriveUploadProgress[]> {
    const { data } = await this.client.get<DriveUploadProgress[]>("/drive/uploads");
    return data;
  }

  async getDownloadUrl(fileId: string): Promise<{ url: string; download_url: string }> {
    const { data } = await this.client.get<{ download_url?: string; url?: string }>(
      `/drive/download/${fileId}`
    );
    const url = data.download_url || data.url || "";
    return { url, download_url: url };
  }

  async getDefaultPath(): Promise<{ folder_id: string | null; folder_name: string | null }> {
    const { data } = await this.client.get<{
      folder_id: string | null;
      folder_name: string | null;
    }>("/drive/default-path");
    return data;
  }

  async setDefaultPath(
    folderId: string,
    folderName: string
  ): Promise<{ success: boolean }> {
    const { data } = await this.client.post<{ success: boolean }>(
      "/drive/default-path",
      { folder_id: folderId, folder_name: folderName }
    );
    return data;
  }
}

