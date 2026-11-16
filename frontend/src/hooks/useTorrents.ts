import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QbitApi } from "@/api/client";
import { isTorrentAddSuccess, isTorrentsAddedMetadataSuccess } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { AddMagnetRequest } from "@/types";
import toast from "react-hot-toast";

export function useActiveInstance() {
  const instances = useAppStore((s) => s.instances);
  const activeId = useAppStore((s) => s.activeInstanceId);
  return instances.find((i) => i.id === activeId) || null;
}

export function useApi() {
  const instance = useActiveInstance();
  return useMemo(() => {
    if (!instance) return null;
    return new QbitApi(instance.url, instance.apiPrefix);
  }, [instance]);
}

export function useHealth() {
  const api = useApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["health", instance?.id],
    queryFn: () => api!.getHealth(),
    enabled: !!api,
    refetchInterval: 15000,
    retry: 1,
  });
}

export function useTorrents(params?: {
  status_filter?: string;
  category?: string;
  tag?: string;
}) {
  const api = useApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["torrents", instance?.id, params],
    queryFn: () => api!.listTorrents(params),
    enabled: !!api,
    refetchInterval: 3000,
  });
}

export function useTorrentDetail(hash: string | null) {
  const api = useApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["torrent", instance?.id, hash],
    queryFn: () => api!.getTorrent(hash!),
    enabled: !!api && !!hash,
    refetchInterval: 2000,
  });
}

export function useAddMagnet() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: (payload: AddMagnetRequest) => api!.addMagnet(payload),
    onSuccess: (data) => {
      if (isTorrentAddSuccess(data)) {
        toast.success("Magnet link berhasil ditambahkan!");
      } else {
        toast.error(data.message);
      }
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.detail ||
        err?.message ||
        "";
      if (isTorrentsAddedMetadataSuccess(msg)) {
        toast.success("Magnet link berhasil ditambahkan!");
        qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
      } else {
        toast.error(`Gagal menambahkan magnet: ${err.message || msg}`);
      }
    },
  });
}

export function useAddTorrentFile() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: ({
      file,
      options,
    }: {
      file: File;
      options?: {
        save_path?: string;
        category?: string;
        is_paused?: boolean;
        skip_checking?: boolean;
        auto_tmm?: boolean;
      };
    }) => api!.addTorrentFile(file, options),
    onSuccess: (data) => {
      if (isTorrentAddSuccess(data)) {
        toast.success("File torrent berhasil ditambahkan!");
      } else {
        toast.error(data.message);
      }
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.detail ||
        err?.message ||
        "";
      if (isTorrentsAddedMetadataSuccess(msg)) {
        toast.success("File torrent berhasil ditambahkan!");
        qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
      } else {
        toast.error(`Gagal mengunggah torrent: ${err.message || msg}`);
      }
    },
  });
}

export function usePauseTorrent() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: (hash: string) => api!.pauseTorrent(hash),
    onSuccess: () => {
      toast.success("Torrent dijeda");
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    },
    onError: (err: Error) => toast.error(`Gagal menjeda: ${err.message}`),
  });
}

export function useResumeTorrent() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: (hash: string) => api!.resumeTorrent(hash),
    onSuccess: () => {
      toast.success("Torrent dilanjutkan");
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    },
    onError: (err: Error) => toast.error(`Gagal melanjutkan: ${err.message}`),
  });
}

export function useDeleteTorrent() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: ({ hash, deleteFiles }: { hash: string; deleteFiles: boolean }) =>
      api!.deleteTorrent(hash, deleteFiles),
    onSuccess: () => {
      toast.success("Torrent berhasil dihapus");
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    },
    onError: (err: Error) => toast.error(`Gagal menghapus: ${err.message}`),
  });
}

export function useBulkPauseTorrents() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: async (hashes: string[]) => {
      if (!api || hashes.length === 0) return;
      return api.bulkPauseTorrents(hashes);
    },
    onSuccess: (_data, hashes) => {
      toast.success(`${hashes.length} torrent dijeda`);
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Gagal menjeda massal: ${msg}`);
    },
  });
}

export function useBulkResumeTorrents() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: async (hashes: string[]) => {
      if (!api || hashes.length === 0) return;
      return api.bulkResumeTorrents(hashes);
    },
    onSuccess: (_data, hashes) => {
      toast.success(`${hashes.length} torrent dilanjutkan`);
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Gagal melanjutkan massal: ${msg}`);
    },
  });
}

export function useBulkDeleteTorrents() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: async ({
      hashes,
      deleteFiles,
    }: {
      hashes: string[];
      deleteFiles: boolean;
    }) => {
      if (!api || hashes.length === 0) return;
      return api.bulkDeleteTorrents(hashes, deleteFiles);
    },
    onSuccess: (_data, { hashes }) => {
      toast.success(`${hashes.length} torrent berhasil dihapus`);
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
      qc.invalidateQueries({ queryKey: ["local-files", instance?.id] });
      qc.invalidateQueries({ queryKey: ["system-stats", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message;
      toast.error(`Gagal menghapus massal: ${msg}`);
    },
  });
}

export function useSystemStats() {
  const api = useApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["system-stats", instance?.id],
    queryFn: () => api!.getSystemStats(),
    enabled: !!api,
    refetchInterval: 10000,
    retry: false,
  });
}

export function useServerPaths(path: string | undefined, enabled: boolean) {
  const api = useApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["server-paths", instance?.id, path ?? "root"],
    queryFn: () => api!.browseServerPaths(path),
    enabled: !!api && enabled,
    retry: false,
  });
}

export function useLocalFiles(path?: string, enabled: boolean = true) {
  const api = useApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["local-files", instance?.id, path ?? "all"],
    queryFn: () => api!.listLocalFiles(path),
    enabled: !!api && enabled,
    refetchInterval: 5000,
  });
}

export function useDeleteLocalFile() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: (filePath: string) => api!.deleteLocalFile(filePath),
    onSuccess: (data) => {
      toast.success(data?.message || "File deleted from server");
      qc.invalidateQueries({ queryKey: ["local-files", instance?.id] });
      qc.invalidateQueries({ queryKey: ["server-paths", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || err?.message || "Failed to delete file";
      toast.error(msg);
    },
  });
}

export function useRenameLocalFile() {
  const api = useApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: ({ path, newName }: { path: string; newName: string }) =>
      api!.renameLocalFile(path, newName),
    onSuccess: (data) => {
      toast.success(data?.message || "File renamed successfully");
      qc.invalidateQueries({ queryKey: ["local-files", instance?.id] });
      qc.invalidateQueries({ queryKey: ["server-paths", instance?.id] });
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || err?.message || "Failed to rename";
      toast.error(msg);
    },
  });
}
