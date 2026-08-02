import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ClassifiedVersions,
  MinecraftVersion,
  MinecraftVersionType,
} from "@/types";

/**
 * 从后端获取 Minecraft 版本列表的 Hook
 * 调用 Tauri 命令 classify_minecraft_versions 获取真实数据
 */
export function useMinecraftVersions() {
  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let data: ClassifiedVersions;
      try {
        data = await invoke<ClassifiedVersions>("classify_minecraft_versions");
      } catch (invokeError) {
        // 浏览器预览中没有 Tauri IPC，直接读取与后端相同的 Mojang 清单。
        // 这样开发界面和桌面软件都能正常选择 Minecraft 版本。
        const response = await fetch(
          "https://launchermeta.mojang.com/mc/game/version_manifest.json",
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error(
            `Minecraft 版本清单请求失败 (${response.status})：${String(invokeError)}`,
          );
        }
        const manifest = (await response.json()) as {
          versions?: Array<{ id: string; type: string; time: string }>;
        };
        const releases: ClassifiedVersions[0] = [];
        const snapshots: ClassifiedVersions[1] = [];
        const aprilFools: ClassifiedVersions[2] = [];
        const oldVersions: ClassifiedVersions[3] = [];

        for (const entry of manifest.versions || []) {
          const item = { id: entry.id, releaseTime: entry.time };
          if (entry.type === "old_alpha" || entry.type === "old_beta") {
            oldVersions.push(item);
          } else if (entry.time.includes("-04-01")) {
            aprilFools.push(item);
          } else if (entry.type === "release") {
            releases.push(item);
          } else if (entry.type === "snapshot") {
            snapshots.push(item);
          }
        }
        data = [releases, snapshots, aprilFools, oldVersions];
      }

      const [releases, snapshots, aprilFools, oldVersions] = data;

      const mapVersions = (
        items: { id: string; releaseTime: string }[],
        type: MinecraftVersionType
      ): MinecraftVersion[] =>
        items.map((v) => ({
          id: v.id,
          type,
          releaseDate: v.releaseTime.split("T")[0],
        }));

      const allVersions: MinecraftVersion[] = [
        ...mapVersions(releases, "release"),
        ...mapVersions(snapshots, "snapshot"),
        ...mapVersions(aprilFools, "april_fools"),
        ...mapVersions(oldVersions, "old_version"),
      ];

      // 按发布日期降序排列
      allVersions.sort(
        (a, b) =>
          new Date(b.releaseDate).getTime() -
          new Date(a.releaseDate).getTime()
      );

      // 标记最新正式版
      const latestRelease = allVersions.find((v) => v.type === "release");
      if (latestRelease) {
        latestRelease.isLatest = true;
      }

      setVersions(allVersions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  return { versions, loading, error, refetch: fetchVersions };
}
