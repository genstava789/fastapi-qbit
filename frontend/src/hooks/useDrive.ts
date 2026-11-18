import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DriveApi } from "@/api/client";
import {
  directListFiles,
  directGetFolderPath,
  directGetFileMeta,
  directCreateFolder,
  directRenameFile,
  directDeleteFile,
  directBatchDeleteFiles,
  directGetStorageQuota,
  directEmptyTrash,
  getValidAccessToken,
  directGetAuthUrl,
} from "@/api/gdriveDirect";
import { useActiveInstance } from "@/hooks/useTorrents";
import { useAppStore } from "@/stores/appStore";
import type { DriveFileItem, DriveDownloadToServerItem } from "@/types";
import toast from "react-hot-toast";

/**
 * Backend API client for server-side VPS tasks (e.g. uploading torrent files to Drive from VPS disk)
 */
export function useDriveApi() {
  const instance = useActiveInstance();
  return useMemo(() => {
    if (!instance) return null;
    return new DriveApi(instance.url, instance.apiPrefix);
  }, [instance]);
}

/**
 * Check Google Drive authentication status directly in frontend
 */
export function useDriveAuthStatus() {
  const gdriveAccessToken = useAppStore((s) => s.gdriveAccessToken);
  const gdriveRefreshToken = useAppStore((s) => s.gdriveRefreshToken);

  return useQuery({
    queryKey: ["drive-auth-status", gdriveAccessToken, gdriveRefreshToken],
    queryFn: async () => {
      try {
        const token = await getValidAccessToken();
        if (token) {
          return { authenticated: true, auth_url: null };
        }
      } catch {
        // Not authenticated
      }
      return {
        authenticated: false,
        auth_url: directGetAuthUrl(),
      };
    },
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 10000,
  });
}

/**
 * List files and folders directly from Google Drive API v3 without backend
 */
export function useDriveFiles(folderId?: string, enabled = true) {
  const normalizedFolderId = folderId || "root";
  const gdriveAccessToken = useAppStore((s) => s.gdriveAccessToken);

  return useQuery({
    queryKey: ["drive-files", normalizedFolderId, gdriveAccessToken],
    queryFn: () => directListFiles(normalizedFolderId),
    enabled: enabled,
    retry: false,
    staleTime: 5000,
  });
}

/**
 * Build folder breadcrumbs directly from Google Drive API v3
 */
export function useDriveBreadcrumb(folderId?: string) {
  const gdriveAccessToken = useAppStore((s) => s.gdriveAccessToken);

  return useQuery({
    queryKey: ["drive-breadcrumb", folderId, gdriveAccessToken],
    queryFn: () => directGetFolderPath(folderId!),
    enabled: !!folderId && folderId !== "root",
    retry: false,
    staleTime: 60000,
  });
}

/**
 * Fetch file metadata directly from Google Drive API v3
 */
export function useDriveFileMeta(fileId?: string) {
  const gdriveAccessToken = useAppStore((s) => s.gdriveAccessToken);

  return useQuery<DriveFileItem>({
    queryKey: ["drive-file-meta", fileId, gdriveAccessToken],
    queryFn: () => directGetFileMeta(fileId!),
    enabled: !!fileId,
    retry: 1,
    staleTime: 30000,
  });
}

/**
 * Fetch Google Drive storage quota and user info directly
 */
export function useDriveStorageQuota(enabled = true) {
  const gdriveAccessToken = useAppStore((s) => s.gdriveAccessToken);

  return useQuery({
    queryKey: ["drive-storage", gdriveAccessToken],
    queryFn: () => directGetStorageQuota(),
    enabled: enabled,
    refetchInterval: enabled ? 30000 : false,
    retry: false,
  });
}

/**
 * Empty Google Drive trash directly
 */
export function useDriveEmptyTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => directEmptyTrash(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drive-storage"] });
      toast.success("Google Drive trash emptied");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to empty Google Drive trash");
    },
  });
}

/**
 * Create a new folder directly in Google Drive
 */
export function useCreateDriveFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) =>
      directCreateFolder(name, parentId),
    onSuccess: () => {
      toast.success("Folder created!");
      qc.invalidateQueries({ queryKey: ["drive-files"] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to create folder: ${err.message}`);
    },
  });
}

/**
 * Delete a file or folder directly in Google Drive
 */
export function useDeleteDriveFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => directDeleteFile(fileId),
    onSuccess: () => {
      toast.success("File deleted from Google Drive");
      qc.invalidateQueries({ queryKey: ["drive-files"] });
      qc.invalidateQueries({ queryKey: ["drive-storage"] });
    },
    onError: (err: any) => {
      toast.error(`Failed to delete: ${err?.message || err}`);
    },
  });
}

/**
 * Rename a file or folder directly in Google Drive
 */
export function useRenameDriveFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, newName }: { fileId: string; newName: string }) =>
      directRenameFile(fileId, newName),
    onSuccess: () => {
      toast.success("File renamed");
      qc.invalidateQueries({ queryKey: ["drive-files"] });
    },
    onError: (err: any) => {
      toast.error(`Failed to rename: ${err?.message || err}`);
    },
  });
}

/**
 * Batch delete files directly in Google Drive
 */
export function useBatchDeleteDriveFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileIds: string[]) => directBatchDeleteFiles(fileIds),
    onSuccess: (data) => {
      if (data.deleted?.length > 0) {
        toast.success(`${data.deleted.length} item(s) deleted from Drive`);
      }
      if (data.errors?.length > 0) {
        toast.error(`Failed to delete ${data.errors.length} item(s)`);
      }
      qc.invalidateQueries({ queryKey: ["drive-files"] });
      qc.invalidateQueries({ queryKey: ["drive-storage"] });
    },
    onError: (err: any) => {
      toast.error(`Batch delete failed: ${err?.message || err}`);
    },
  });
}

/**
 * Default upload path configuration stored in frontend appStore
 */
export function useDriveDefaultPath() {
  const qc = useQueryClient();
  const driveDefaultFolderId = useAppStore((s) => s.driveDefaultFolderId);
  const driveDefaultFolderName = useAppStore((s) => s.driveDefaultFolderName);
  const setDriveDefaultFolder = useAppStore((s) => s.setDriveDefaultFolder);

  const query = useQuery({
    queryKey: ["drive-default-path", driveDefaultFolderId, driveDefaultFolderName],
    queryFn: () => ({
      folder_id: driveDefaultFolderId,
      folder_name: driveDefaultFolderName,
    }),
    initialData: {
      folder_id: driveDefaultFolderId,
      folder_name: driveDefaultFolderName,
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ folderId, folderName }: { folderId: string; folderName: string }) => {
      setDriveDefaultFolder(folderId, folderName);
      return { success: true };
    },
    onSuccess: (_data, { folderId, folderName }) => {
      setDriveDefaultFolder(folderId, folderName);
      toast.success("Default upload path updated!");
      qc.invalidateQueries({ queryKey: ["drive-default-path"] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to set default path: ${err.message}`);
    },
  });

  return { query, mutation };
}

// ─────────────────────────────────────────────────────────────────────────────
// VPS Backend Server Actions (For uploading from VPS local disk or downloading to VPS storage)
// ─────────────────────────────────────────────────────────────────────────────

export function useDriveUploads() {
  const api = useDriveApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["drive-uploads", instance?.id],
    queryFn: () => api!.listUploads(),
    enabled: !!api,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && data.length > 0 ? 2000 : false;
    },
  });
}

export function useClearCompletedUploads() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: () => api!.clearCompletedUploads(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drive-uploads", instance?.id] });
    },
  });
}

export function useUploadToDrive() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: ({
      filePath,
      folderId,
      torrentHash,
    }: {
      filePath?: string;
      folderId?: string;
      torrentHash?: string;
    }) => api!.startUpload(filePath, folderId, torrentHash),
    onSuccess: () => {
      toast.success("Upload to Drive started!");
      qc.invalidateQueries({ queryKey: ["drive-uploads", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Upload failed: ${msg}`);
    },
  });
}

export function useBatchUploadToDrive() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: async ({
      items,
      folderId,
    }: {
      items: Array<{ filePath?: string; torrentHash?: string; name: string }>;
      folderId?: string;
    }) => {
      if (!api) throw new Error("Google Drive API is unavailable");
      const results: Array<{
        item: { filePath?: string; torrentHash?: string; name: string };
        upload_id?: string;
        error?: string;
      }> = [];
      for (const item of items) {
        try {
          const res = await api.startUpload(item.filePath, folderId, item.torrentHash);
          results.push({ item, upload_id: res.upload_id });
        } catch (err: any) {
          const msg = err.response?.data?.detail || err.message || "Failed to upload";
          results.push({ item, error: msg });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ["drive-uploads", instance?.id] });
      const successes = results.filter((r) => !r.error);
      const failures = results.filter((r) => r.error);
      if (failures.length === 0) {
        toast.success(`Started uploading ${successes.length} torrent(s) to Google Drive!`);
      } else if (successes.length > 0) {
        toast.success(`Started uploading ${successes.length} torrent(s) (${failures.length} failed)`);
      } else {
        toast.error(`Failed to start batch upload: ${failures[0]?.error || "Unknown error"}`);
      }
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Batch upload failed: ${msg}`);
    },
  });
}

export function useDriveDownloads() {
  const api = useDriveApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["drive-downloads", instance?.id],
    queryFn: () => api!.listDownloadsToServer(),
    enabled: !!api,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasActive = data?.some(
        (d) => d.status === "downloading" || d.status === "pending"
      );
      return hasActive ? 1500 : data && data.length > 0 ? 3000 : false;
    },
  });
}

export function useClearCompletedDownloads() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: () => api!.clearCompletedDownloadsToServer(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drive-downloads", instance?.id] });
    },
  });
}

export function useDownloadToServer() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: async ({
      items,
      destinationPath,
      autoAttachReseed,
    }: {
      items: DriveDownloadToServerItem[];
      destinationPath?: string;
      autoAttachReseed?: boolean;
    }) => {
      let token: string | undefined;
      try {
        token = await getValidAccessToken();
      } catch {
        token = useAppStore.getState().gdriveAccessToken || undefined;
      }
      return api!.startDownloadToServer(items, destinationPath, autoAttachReseed, token);
    },
    onSuccess: (_data, variables) => {
      const count = variables.items.length;
      toast.success(
        count > 1
          ? `Started pulling ${count} items to local server!`
          : `Started pulling '${variables.items[0]?.name || "file"}' to server!`
      );
      qc.invalidateQueries({ queryKey: ["drive-downloads", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Pull to server failed: ${msg}`);
    },
  });
}

export function useCancelDownloadToServer() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: (taskId: string) => api!.cancelDownloadToServer(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drive-downloads", instance?.id] });
      toast.success("Download task cancelled");
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Failed to cancel task: ${msg}`);
    },
  });
}
