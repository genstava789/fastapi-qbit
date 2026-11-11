import { describe, it, expect, beforeEach, vi } from "vitest";

const memoryStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, value);
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key);
  },
  clear: () => {
    memoryStorage.clear();
  },
});

import { useAppStore } from "./appStore";

describe("useAppStore", () => {
  beforeEach(() => {
    memoryStorage.clear();
    useAppStore.setState({
      instances: [
        {
          id: "default-vps",
          name: "Production VPS (NYC)",
          url: "https://mild-leaf.nyc.boxd.sh",
          apiPrefix: "/api/v1",
          color: "#6366f1",
        },
      ],
      activeInstanceId: "default-vps",
      selectedTorrents: new Set(),
      deleteConfirmHashes: null,
    });
  });

  it("manages multi-instance additions, updates, and removal", () => {
    const store = useAppStore.getState();
    store.addInstance({
      id: "eu-box",
      name: "EU Seedbox",
      url: "https://eu.example.com",
      apiPrefix: "/api/v1",
    });

    expect(useAppStore.getState().instances).toHaveLength(2);

    store.toggleTorrentSelection("h1");
    expect(useAppStore.getState().selectedTorrents.size).toBe(1);

    store.setActiveInstance("eu-box");
    expect(useAppStore.getState().activeInstanceId).toBe("eu-box");
    expect(useAppStore.getState().selectedTorrents.size).toBe(0);

    store.updateInstance("eu-box", { name: "EU Box 2" });
    expect(
      useAppStore.getState().instances.find((i) => i.id === "eu-box")?.name
    ).toBe("EU Box 2");

    store.removeInstance("eu-box");
    expect(useAppStore.getState().instances).toHaveLength(1);
    expect(useAppStore.getState().activeInstanceId).toBe("default-vps");
  });

  it("toggles batch selections and sets bulk delete hashes", () => {
    const store = useAppStore.getState();
    store.toggleTorrentSelection("h1");
    store.toggleTorrentSelection("h2");
    expect(Array.from(useAppStore.getState().selectedTorrents)).toEqual([
      "h1",
      "h2",
    ]);

    store.toggleTorrentSelection("h1");
    expect(Array.from(useAppStore.getState().selectedTorrents)).toEqual(["h2"]);

    store.selectAllTorrents(["h1", "h2", "h3"]);
    expect(useAppStore.getState().selectedTorrents.size).toBe(3);

    store.setDeleteConfirmHashes(["h1", "h2"]);
    expect(useAppStore.getState().deleteConfirmHashes).toEqual(["h1", "h2"]);

    store.clearSelection();
    expect(useAppStore.getState().selectedTorrents.size).toBe(0);
  });

  it("opens add torrent modal with re-seed prefill and clears on close", () => {
    const store = useAppStore.getState();
    store.openAddTorrentWithPrefill({
      savePath: "/home/boxd/Downloads/complete",
      reseedMode: true,
      skipChecking: true,
      title: "ubuntu.iso",
    });

    expect(useAppStore.getState().addTorrentModalOpen).toBe(true);
    expect(useAppStore.getState().addTorrentPrefill?.savePath).toBe(
      "/home/boxd/Downloads/complete"
    );
    expect(useAppStore.getState().addTorrentPrefill?.reseedMode).toBe(true);

    store.setAddTorrentModalOpen(false);
    expect(useAppStore.getState().addTorrentModalOpen).toBe(false);
    expect(useAppStore.getState().addTorrentPrefill).toBeNull();
  });
});
