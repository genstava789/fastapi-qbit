import axios, { type AxiosInstance } from "axios";
import type {
  AddMagnetRequest,
  HealthStatus,
  ServerPathsResponse,
  SystemStats,
  TorrentActionResponse,
  TorrentItem,
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

