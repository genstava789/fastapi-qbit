import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProwlarrApi } from "@/api/client";
import { useActiveInstance } from "@/hooks/useTorrents";
import { isTorrentAddSuccess } from "@/lib/utils";
import type { ProwlarrAddPayload, ProwlarrConfigPayload } from "@/types";
import toast from "react-hot-toast";

export function useProwlarrApi() {
  const instance = useActiveInstance();
  return useMemo(() => {
    if (!instance) return null;
    return new ProwlarrApi(instance.url, instance.apiPrefix);
  }, [instance]);
}

export function useProwlarrConfig() {
  const api = useProwlarrApi();
  const instance = useActiveInstance();
  return useQuery({
    queryKey: ["prowlarr-config", instance?.id],
    queryFn: () => api!.getConfig(),
    enabled: !!api,
    retry: 1,
  });
}

export function useSaveProwlarrConfig() {
  const api = useProwlarrApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: (payload: ProwlarrConfigPayload) => api!.saveConfig(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prowlarr-config", instance?.id] });
      toast.success("Prowlarr configuration saved to backend!");
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail || err?.message || "Failed to save configuration";
      toast.error(msg);
    },
  });
}

export function useTestProwlarrConnection() {
  const api = useProwlarrApi();
  return useMutation({
    mutationFn: (payload?: { url?: string; api_key?: string }) =>
      api!.testConnection(payload),
    onSuccess: (data) => {
      const suffix = data.version ? ` (v${data.version})` : "";
      toast.success(`${data.message}${suffix}`);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail || err?.message || "Prowlarr connection failed";
      toast.error(msg);
    },
  });
}

export function useAddProwlarrResult() {
  const api = useProwlarrApi();
  const qc = useQueryClient();
  const instance = useActiveInstance();
  return useMutation({
    mutationFn: (payload: ProwlarrAddPayload) => api!.addToQbit(payload),
    onSuccess: (data) => {
      if (isTorrentAddSuccess(data)) {
        toast.success(data.message || "Torrent added to qBittorrent!");
      } else {
        toast.error(data.message);
      }
      qc.invalidateQueries({ queryKey: ["torrents", instance?.id] });
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to add torrent";
      toast.error(msg);
    },
  });
}

