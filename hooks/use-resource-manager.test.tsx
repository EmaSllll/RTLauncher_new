import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useResourceManager } from "./use-resource-manager";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

function callsFor(command: string) {
  return invokeMock.mock.calls.filter(([name]) => name === command);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useResourceManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not re-fetch after the initial instance-file state update", async () => {
    invokeMock
      .mockResolvedValueOnce([
        { name: "installed.zip", is_dir: false, extension: "zip", size: 42 },
      ])
      .mockResolvedValueOnce(["cached.zip"]);

    renderHook(() =>
      useResourceManager(
        "/minecraft/versions/example",
        "resourcepacks",
        "resourcepack",
        "1.21.1",
        undefined,
        ["zip"],
      ),
    );

    await waitFor(() => {
      expect(callsFor("vm_list_dir")).toHaveLength(1);
      expect(callsFor("list_cached_files")).toHaveLength(1);
    });

    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(callsFor("vm_list_dir")).toHaveLength(1);
    expect(callsFor("list_cached_files")).toHaveLength(1);
  });
});
