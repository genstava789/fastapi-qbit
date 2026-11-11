import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Instance, TorrentFilter } from "@/types";

const DEFAULT_INSTANCES: Instance[] = [
  {
    id: "default-vps",
    name: "Production VPS (NYC)",
    url: "https://mild-leaf.nyc.boxd.sh",
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
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: "qbit-ui-storage",
      partialize: (state) => ({
        instances: state.instances.length > 0 ? state.instances : DEFAULT_INSTANCES,
        activeInstanceId: state.activeInstanceId || "default-vps",
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);
