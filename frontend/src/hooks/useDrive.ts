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

export function useUploadToDrive() {
  const api = useDriveApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: ({ filePath, folderId }: { filePath: string; folderId?: string }) =>
      api!.startUpload(filePath, folderId),
    onSuccess: () => {
      toast.success("Upload to Drive started!");
      qc.invalidateQueries({ queryKey: ["drive-uploads", instance?.id] });
    },
    onError: (err: Error) => {
      toast.error(`Upload failed: ${err.message}`);
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
