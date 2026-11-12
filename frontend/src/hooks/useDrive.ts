import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DriveApi } from "@/api/client";
import { useActiveInstance } from "@/hooks/useTorrents";
import { useAppStore } from "@/stores/appStore";
import toast from "react-hot-toast";

export function useDriveApi() {
  const instance = useActiveInstance();
  return useMemo(() => {
    if (!instance) return null;
    return new DriveApi(instance.url, instance.apiPrefix);
  }, [instance]);
}

export function useDriveAuthStatus() {
  const api = useDriveApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["drive-auth-status", instance?.id],
    queryFn: () => api!.getAuthStatus(),
    enabled: !!api,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useDriveFiles(folderId?: string, enabled: boolean = true) {
  const api = useDriveApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["drive-files", instance?.id, folderId],
    queryFn: () => api!.listFiles(folderId),
    enabled: !!api && enabled,
    retry: false,
  });
}

export function useDriveBreadcrumb(folderId?: string) {
  const api = useDriveApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["drive-breadcrumb", instance?.id, folderId],
    queryFn: () => api!.getFolderPath(folderId!),
    enabled: !!api && !!folderId,
    retry: false,
  });
}

export function useDriveFileMeta(fileId?: string) {
  const api = useDriveApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["drive-file-meta", instance?.id || "fallback", fileId],
    queryFn: async () => {
      if (api) {
        return api.getFileMeta(fileId!);
      }
      const resp = await fetch(
        `https://mild-leaf.nyc.boxd.sh/api/v1/drive/files/${encodeURIComponent(fileId!)}/meta`
      );
      if (!resp.ok) throw new Error("Gagal memuat metadata file");
      return resp.json();
    },
    enabled: !!fileId,
    retry: 1,
  });
}

export function useDriveStorageQuota(enabled: boolean = true) {
  const api = useDriveApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["drive-storage", instance?.id],
    queryFn: () => api!.getStorageQuota(),
    enabled: !!api && enabled,
    refetchInterval: enabled ? 30000 : false,
    retry: false,
  });
}

export function useDriveEmptyTrash() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: () => api!.emptyTrash(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["drive-storage", instance?.id] });
      toast.success("Google Drive trash emptied");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Failed to empty Google Drive trash");
    },
  });
}

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
      if (!api) throw new Error("Google Drive API tidak tersedia");
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
          const msg = err.response?.data?.detail || err.message || "Gagal mengunggah";
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
        toast.success(`Berhasil memulai upload ${successes.length} torrent ke Google Drive!`);
      } else if (successes.length > 0) {
        toast.success(`Memulai upload ${successes.length} torrent (${failures.length} gagal)`);
      } else {
        toast.error(`Gagal memulai batch upload: ${failures[0]?.error || "Unknown error"}`);
      }
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Batch upload failed: ${msg}`);
    },
  });
}

export function useCreateDriveFolder() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) =>
      api!.createFolder(name, parentId),
    onSuccess: () => {
      toast.success("Folder created!");
      qc.invalidateQueries({ queryKey: ["drive-files", instance?.id] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to create folder: ${err.message}`);
    },
  });
}

export function useDeleteDriveFile() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: (fileId: string) => api!.deleteDriveFile(fileId),
    onSuccess: () => {
      toast.success("File deleted from Google Drive");
      qc.invalidateQueries({ queryKey: ["drive-files", instance?.id] });
      qc.invalidateQueries({ queryKey: ["drive-storage-quota", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Failed to delete: ${msg}`);
    },
  });
}

export function useRenameDriveFile() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: ({ fileId, newName }: { fileId: string; newName: string }) =>
      api!.renameDriveFile(fileId, newName),
    onSuccess: () => {
      toast.success("File renamed");
      qc.invalidateQueries({ queryKey: ["drive-files", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Failed to rename: ${msg}`);
    },
  });
}

export function useBatchDeleteDriveFiles() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: (fileIds: string[]) => api!.batchDeleteDriveFiles(fileIds),
    onSuccess: (data) => {
      if (data.deleted?.length > 0) {
        toast.success(`${data.deleted.length} item(s) deleted from Drive`);
      }
      if (data.errors?.length > 0) {
        toast.error(`Failed to delete ${data.errors.length} item(s)`);
      }
      qc.invalidateQueries({ queryKey: ["drive-files", instance?.id] });
      qc.invalidateQueries({ queryKey: ["drive-storage-quota", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Batch delete failed: ${msg}`);
    },
  });
}

export function useDriveDefaultPath() {
  const api = useDriveApi();
  const instance = useActiveInstance();
  const qc = useQueryClient();
  const setDriveDefaultFolder = useAppStore((s) => s.setDriveDefaultFolder);

  const query = useQuery({
    queryKey: ["drive-default-path", instance?.id],
    queryFn: () => api!.getDefaultPath(),
    enabled: !!api,
  });

  const mutation = useMutation({
    mutationFn: ({ folderId, folderName }: { folderId: string; folderName: string }) =>
      api!.setDefaultPath(folderId, folderName),
    onSuccess: (_data, { folderId, folderName }) => {
      setDriveDefaultFolder(folderId, folderName);
      toast.success("Default upload path updated!");
      qc.invalidateQueries({ queryKey: ["drive-default-path", instance?.id] });
    },
    onError: (err: Error) => {
      toast.error(`Failed to set default path: ${err.message}`);
    },
  });

  return { query, mutation };
}
