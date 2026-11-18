import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Instance, TorrentFilter } from "@/types";
import { DEFAULT_GDRIVE_CLIENT_ID, DEFAULT_GDRIVE_CLIENT_SECRET } from "@/api/gdriveDirect";

const DEFAULT_INSTANCES: Instance[] = [
  {
    id: "default-vps",
    name: "Production VPS (NYC)",
    url: "https://keen-shore.nyc.boxd.sh",
    apiPrefix: "/api/v1",
    color: "#6366f1",
  },
];

interface AppState {
  // Multi-instance
  instances: Instance[];
  activeInstanceId: string | null;
  addInstance: (instance: Instance) => void;
  removeInstance: (id: string) => void;
  updateInstance: (id: string, updates: Partial<Instance>) => void;
  setActiveInstance: (id: string) => void;

  // UI State
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  torrentFilter: TorrentFilter;
  setTorrentFilter: (filter: TorrentFilter) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedTorrents: Set<string>;
  toggleTorrentSelection: (hash: string) => void;
  selectAllTorrents: (hashes: string[]) => void;
  clearSelection: () => void;

  // Modals
  addTorrentModalOpen: boolean;
  setAddTorrentModalOpen: (open: boolean) => void;
  addTorrentPrefill: {
    savePath?: string;
    reseedMode?: boolean;
    skipChecking?: boolean;
    title?: string;
  } | null;
  openAddTorrentWithPrefill: (prefill: {
    savePath?: string;
    reseedMode?: boolean;
    skipChecking?: boolean;
    title?: string;
  }) => void;
  clearAddTorrentPrefill: () => void;
  deleteConfirmHashes: string[] | null;
  setDeleteConfirmHash: (hash: string | null) => void;
  setDeleteConfirmHashes: (hashes: string[] | null) => void;

  // Drive defaults
  driveDefaultFolderId: string | null;
  driveDefaultFolderName: string | null;
  setDriveDefaultFolder: (id: string | null, name: string | null) => void;
  driveDefaultLocalPath: string | null;
  setDriveDefaultLocalPath: (path: string | null) => void;

  // Direct Google Drive OAuth & API Credentials (Direct client-side fetch)
  gdriveAccessToken: string | null;
  gdriveRefreshToken: string | null;
  gdriveTokenExpiry: number | null;
  gdriveClientId: string | null;
  gdriveClientSecret: string | null;
  gdriveApiKey: string | null;
  setGDriveTokens: (tokens: {
    accessToken?: string | null;
    refreshToken?: string | null;
    expiry?: number | null;
    clientId?: string | null;
    clientSecret?: string | null;
    apiKey?: string | null;
  }) => void;
  clearGDriveTokens: () => void;

  // Reseed ratio tracking
  reseedRatios: Record<string, number>;
  saveTorrentRatio: (hash: string, name: string, ratio: number) => void;
  getTorrentRatio: (hash?: string, name?: string) => number | undefined;

  // Completed Google Drive uploads tracking
  completedDriveUploads: Record<
    string,
    {
      filename: string;
      drive_file_id?: string;
      completed_at: number;
    }
  >;
  markDriveUploadCompleted: (upload: {
    torrent_hash?: string;
    filename: string;
    drive_file_id?: string;
  }) => void;
}

function sanitizeInstances(instances: Instance[]): Instance[] {
  if (!Array.isArray(instances) || instances.length === 0) {
    return DEFAULT_INSTANCES;
  }
  return instances.map((inst) => {
    // If instance points to decommissioned boxd host, update to current production VPS
    if (inst.url?.includes("mild-leaf") || inst.id === "default-vps") {
      return {
        ...inst,
        url: "https://keen-shore.nyc.boxd.sh",
        name: inst.name || "Production VPS (NYC)",
      };
    }
    return inst;
  });
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Multi-instance with Default VPS loaded
      instances: DEFAULT_INSTANCES,
      activeInstanceId: "default-vps",
      addInstance: (instance) =>
        set((state) => {
          const newInstances = [...state.instances, instance];
          return {
            instances: newInstances,
            activeInstanceId: state.activeInstanceId || instance.id,
          };
        }),
      removeInstance: (id) =>
        set((state) => {
          const filtered = state.instances.filter((i) => i.id !== id);
          return {
            instances: filtered,
            activeInstanceId:
              state.activeInstanceId === id
                ? filtered[0]?.id || null
                : state.activeInstanceId,
          };
        }),
      updateInstance: (id, updates) =>
        set((state) => ({
          instances: state.instances.map((i) =>
            i.id === id ? { ...i, ...updates } : i
          ),
        })),
      setActiveInstance: (id) =>
        set({ activeInstanceId: id, selectedTorrents: new Set() }),

      // UI State
      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      mobileMenuOpen: false,
      setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
      torrentFilter: "all",
      setTorrentFilter: (filter) => set({ torrentFilter: filter }),
      searchQuery: "",
      setSearchQuery: (query) => set({ searchQuery: query }),
      selectedTorrents: new Set(),
      toggleTorrentSelection: (hash) =>
        set((state) => {
          const next = new Set(state.selectedTorrents);
          if (next.has(hash)) next.delete(hash);
          else next.add(hash);
          return { selectedTorrents: next };
        }),
      selectAllTorrents: (hashes) =>
        set({ selectedTorrents: new Set(hashes) }),
      clearSelection: () => set({ selectedTorrents: new Set() }),

      // Modals
      addTorrentModalOpen: false,
      setAddTorrentModalOpen: (open) =>
        set((state) => ({
          addTorrentModalOpen: open,
          addTorrentPrefill: open ? state.addTorrentPrefill : null,
        })),
      addTorrentPrefill: null,
      openAddTorrentWithPrefill: (prefill) =>
        set({ addTorrentModalOpen: true, addTorrentPrefill: prefill }),
      clearAddTorrentPrefill: () => set({ addTorrentPrefill: null }),
      deleteConfirmHashes: null,
      setDeleteConfirmHash: (hash) =>
        set({ deleteConfirmHashes: hash ? [hash] : null }),
      setDeleteConfirmHashes: (hashes) =>
        set({ deleteConfirmHashes: hashes && hashes.length > 0 ? hashes : null }),

      // Drive defaults
      driveDefaultFolderId: null,
      driveDefaultFolderName: null,
      setDriveDefaultFolder: (id, name) =>
        set({ driveDefaultFolderId: id, driveDefaultFolderName: name }),
      driveDefaultLocalPath: null,
      setDriveDefaultLocalPath: (path) =>
        set({ driveDefaultLocalPath: path }),

      // Direct Google Drive OAuth & API Credentials
      gdriveAccessToken: null,
      gdriveRefreshToken: null,
      gdriveTokenExpiry: null,
      gdriveClientId: DEFAULT_GDRIVE_CLIENT_ID || null,
      gdriveClientSecret: DEFAULT_GDRIVE_CLIENT_SECRET || null,
      gdriveApiKey: null,
      setGDriveTokens: (tokens) =>
        set((state) => ({
          gdriveAccessToken: tokens.accessToken !== undefined ? tokens.accessToken : state.gdriveAccessToken,
          gdriveRefreshToken: tokens.refreshToken !== undefined ? tokens.refreshToken : state.gdriveRefreshToken,
          gdriveTokenExpiry: tokens.expiry !== undefined ? tokens.expiry : state.gdriveTokenExpiry,
          gdriveClientId: tokens.clientId !== undefined ? tokens.clientId : state.gdriveClientId,
          gdriveClientSecret: tokens.clientSecret !== undefined ? tokens.clientSecret : state.gdriveClientSecret,
          gdriveApiKey: tokens.apiKey !== undefined ? tokens.apiKey : state.gdriveApiKey,
        })),
      clearGDriveTokens: () =>
        set({
          gdriveAccessToken: null,
          gdriveRefreshToken: null,
          gdriveTokenExpiry: null,
        }),

      // Reseed ratio tracking
      reseedRatios: {},
      saveTorrentRatio: (hash, name, ratio) => {
        if (!ratio || ratio <= 0 || isNaN(ratio)) return;
        set((state) => {
          const current = state.reseedRatios || {};
          const next = { ...current };
          if (hash) next[hash] = ratio;
          if (name) next[name] = ratio;
          return { reseedRatios: next };
        });
      },
      getTorrentRatio: (hash, name) => {
        const ratios = get().reseedRatios || {};
        const byHash = hash ? ratios[hash] : undefined;
        const byName = name ? ratios[name] : undefined;
        const val = Math.max(byHash || 0, byName || 0);
        return val > 0 ? val : undefined;
      },

      // Completed Google Drive uploads tracking
      completedDriveUploads: {},
      markDriveUploadCompleted: (upload) => {
        set((state) => {
          const current = state.completedDriveUploads || {};
          const next = { ...current };
          const entry = {
            filename: upload.filename,
            drive_file_id: upload.drive_file_id,
            completed_at: Date.now(),
          };
          if (upload.torrent_hash) {
            next[upload.torrent_hash] = entry;
          }
          if (upload.filename) {
            next[upload.filename] = entry;
          }
          return { completedDriveUploads: next };
        });
      },
    }),
    {
      name: "qbit-ui-storage",
      version: 1,
      migrate: (persistedState: any, _version: number) => {
        if (persistedState && typeof persistedState === "object") {
          const state = persistedState as any;
          if (Array.isArray(state.instances)) {
            state.instances = sanitizeInstances(state.instances);
          } else {
            state.instances = DEFAULT_INSTANCES;
          }
          if (!state.gdriveClientId || state.gdriveClientId.includes("YOUR_CLIENT_ID")) {
            state.gdriveClientId = DEFAULT_GDRIVE_CLIENT_ID || null;
          }
          if (!state.gdriveClientSecret || state.gdriveClientSecret.includes("YOUR_CLIENT_SECRET")) {
            state.gdriveClientSecret = DEFAULT_GDRIVE_CLIENT_SECRET || null;
          }
        }
        return persistedState;
      },
      onRehydrateStorage: () => (state) => {
        if (state && Array.isArray(state.instances)) {
          state.instances = sanitizeInstances(state.instances);
          if (!state.activeInstanceId || !state.instances.some((i) => i.id === state.activeInstanceId)) {
            state.activeInstanceId = state.instances[0]?.id || "default-vps";
          }
        }
        if (state) {
          if (!state.gdriveClientId || state.gdriveClientId.includes("YOUR_CLIENT_ID")) {
            state.gdriveClientId = DEFAULT_GDRIVE_CLIENT_ID || null;
          }
          if (!state.gdriveClientSecret || state.gdriveClientSecret.includes("YOUR_CLIENT_SECRET")) {
            state.gdriveClientSecret = DEFAULT_GDRIVE_CLIENT_SECRET || null;
          }
        }
      },
      partialize: (state) => ({
        instances: sanitizeInstances(state.instances),
        activeInstanceId: state.activeInstanceId || "default-vps",
        sidebarOpen: state.sidebarOpen,
        driveDefaultFolderId: state.driveDefaultFolderId,
        driveDefaultFolderName: state.driveDefaultFolderName,
        driveDefaultLocalPath: state.driveDefaultLocalPath,
        gdriveAccessToken: state.gdriveAccessToken,
        gdriveRefreshToken: state.gdriveRefreshToken,
        gdriveTokenExpiry: state.gdriveTokenExpiry,
        gdriveClientId: state.gdriveClientId,
        gdriveClientSecret: state.gdriveClientSecret,
        gdriveApiKey: state.gdriveApiKey,
        reseedRatios: state.reseedRatios,
        completedDriveUploads: state.completedDriveUploads,
      }),
    }
  )
);
