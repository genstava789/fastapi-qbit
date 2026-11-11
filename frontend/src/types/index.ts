export interface Instance {
  id: string;
  name: string;
  url: string;
  apiPrefix: string;
  icon?: string;
  color?: string;
}

export interface TorrentItem {
  hash: string;
  name: string;
  state: string;
  progress: number;
  total_size: number;
  downloaded: number;
  uploaded: number;
  download_speed: number;
  upload_speed: number;
  eta: number;
  save_path: string;
  content_path?: string;
}

export interface HealthStatus {
  status: string;
  app_version: string;
  qbittorrent_connected: boolean;
  qbittorrent_version: string | null;
}

export interface TorrentActionResponse {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface AddMagnetRequest {
  magnet_url: string;
  save_path?: string;
  category?: string;
  is_paused?: boolean;
  tags?: string[];
  skip_checking?: boolean;
  auto_tmm?: boolean;
}

export interface SystemStats {
  hostname: string;
  os_name: string;
  architecture: string;
  active_user: string;
  cpu_percent: number;
  cpu_cores: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
  ram_percent: number;
  disk_path: string;
  disk_free_bytes: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  disk_percent: number;
  uptime_seconds: number;
  public_ip: string | null;
}

export interface ServerPathItem {
  name: string;
  path: string;
}

export interface ServerPathsResponse {
  current_path: string;
  parent_path: string | null;
  directories: ServerPathItem[];
}

export interface ProwlarrSearchResult {
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  magnetUrl?: string;
  downloadUrl?: string;
  indexer: string;
  publishDate: string;
  categories: string[];
}

export interface NetworkDiagnostics {
  publicIp: string;
  downloadSpeed?: number;
  uploadSpeed?: number;
  latency?: number;
  isp?: string;
}

export interface FileItem {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  modifiedAt?: string;
  children?: FileItem[];
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  parents: string[] | null;
}

export interface DriveListResponse {
  files: DriveFileItem[];
  nextPageToken: string | null;
}

export interface DriveStorageQuota {
  limit: number;
  usage: number;
  usageInDrive: number;
  usageInTrash: number;
}

export interface DriveUploadProgress {
  upload_id: string;
  filename: string;
  progress_percent: number;
  status: string;
  bytes_uploaded: number;
  total_bytes: number;
}

export interface DriveBreadcrumb {
  id: string;
  name: string;
}

export type SortDirection = "asc" | "desc";
export type TorrentFilter =
  | "all"
  | "downloading"
  | "completed"
  | "paused"
  | "active"
  | "inactive"
  | "stalled"
  | "error";

