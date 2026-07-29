"use client";

import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Search,
  Box,
  Package,
  Plus,
  Trash2,
  Save,
  Folder,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Server,
  Monitor,
  ChevronDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import {
  ModrinthFileEntry,
  CurseforgeFileEntry,
  getModpackDir,
  saveInstance,
  formatTimestamp,
} from "@/components/modpack/modpack-api";
import { useMinecraftVersions } from "@/hooks/use-minecraft-versions";

// =============================================================================
// 搜索结果数据结构
// =============================================================================

type CategoryId = "mod" | "modpack" | "resourcepack" | "shaders" | "datapack" | "worlds";

interface SearchHit {
  slug: string;
  title: string;
  description?: string;
  iconUrl?: string;
  downloads?: number;
  categories?: string[];
  game_versions?: string[];
  updated?: string;
  author?: string;
  source: "modrinth" | "curseforge";
  project_type?: string;
  external_url?: string;
}

// =============================================================================
// CurseForge API Key
// =============================================================================

const CURSEFORGE_API_KEY = "$2a$10$VTAFCxje5a1Jkqv0aGWjQ.fULedAEPctDqppOkNMRVv.edVnG7KQ6";
const CURSEFORGE_HEADERS = {
  "x-api-key": CURSEFORGE_API_KEY,
  Accept: "application/json",
  "User-Agent": "RTLauncher/1.0",
};
const MODRINTH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "RTLauncher/1.0",
};

interface ParsedModrinthVersion {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: Array<{
    url: string;
    filename: string;
    primary: boolean;
    size: number;
    hashes: { sha1: string; sha512: string; sha256?: string };
  }>;
  date_published: string;
  version_type: string;
}

function pickPrimaryFile(v: any): ParsedModrinthVersion["files"][number] | null {
  if (!v || !Array.isArray(v.files) || v.files.length === 0) return null;
  const primary = v.files.find((f: any) => f.primary === true);
  return primary || v.files[0];
}

function defaultSubfolderForCategory(cat: CategoryId, projectType?: string): string {
  const t = (projectType || cat).toLowerCase();
  if (t.startsWith("modpack")) return "";
  if (t.startsWith("resourcepack") || t === "resource pack") return "resourcepacks";
  if (t.startsWith("shader")) return "shaderpacks";
  if (t.startsWith("datapack") || t === "data pack") return "datapacks";
  if (t.startsWith("world")) return "saves";
  return "mods";
}

// =============================================================================
// MC 版本：模糊匹配
// =============================================================================

function findBestMatchingVersion(
  query: string,
  versions: { id: string; type: string; releaseDate: string }[],
): { id: string; type: string; releaseDate: string } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  // 1) 精确匹配
  const exact = versions.find((v) => v.id.toLowerCase() === q);
  if (exact) return exact;
  // 2) 前缀匹配（优先 release）
  const prefixMatches = versions.filter((v) => v.id.toLowerCase().startsWith(q));
  if (prefixMatches.length > 0) {
    const release = prefixMatches.find((v) => v.type === "release");
    return release || prefixMatches[0];
  }
  // 3) 包含匹配
  const contains = versions.filter((v) => v.id.toLowerCase().includes(q));
  if (contains.length > 0) {
    const release = contains.find((v) => v.type === "release");
    return release || contains[0];
  }
  return null;
}

// =============================================================================
// 主组件
// =============================================================================

export function ModpackBuilder({
  format,
  initialName,
  gameVersion,
  existingFiles,
  initialLoader,
  initialOptifine,
  initialOptifineVersion,
  initialCrossLoader,
}: {
  format: "modrinth" | "curseforge";
  initialName?: string;
  gameVersion?: string;
  existingFiles?: (ModrinthFileEntry | CurseforgeFileEntry)[];
  initialLoader?: string;
  initialOptifine?: boolean;
  initialOptifineVersion?: string;
  initialCrossLoader?: boolean;
}) {
  const router = useRouter();
  // 顶部元数据
  const [name, setName] = useState(initialName || "");
  const [gameVer, setGameVer] = useState(gameVersion || "");
  const [category, setCategory] = useState<CategoryId>("mod");
  const [query, setQuery] = useState("");
  const [dir, setDir] = useState("");

  // 加载器
  const ALL_LOADERS = ["forge", "neoforge", "fabric", "quilt", "liteloader"] as const;
  const [selectedLoader, setSelectedLoader] = useState<string>(
    initialLoader && ALL_LOADERS.includes(initialLoader as any)
      ? initialLoader
      : "forge",
  );

  // OptiFine
  const [useOptifine, setUseOptifine] = useState<boolean>(initialOptifine || false);
  // 信雅互联模式：开启后 mod 搜索同时覆盖 forge + fabric，解除 loader 限制
  const [crossLoader, setCrossLoader] = useState<boolean>(initialCrossLoader || false);
  const [optifineVersions, setOptifineVersions] = useState<
    { id: string; type_: string; mcversion: string; patch: string; filename: string; forge: string }[]
  >([]);
  const [optifineLoading, setOptifineLoading] = useState(false);
  const [selectedOptifineVersion, setSelectedOptifineVersion] = useState<string>(
    initialOptifineVersion || "",
  );

  // MC 版本列表 + 下拉
  const { versions: mcVersions, loading: mcLoading, error: mcError } =
    useMinecraftVersions();
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false);

  // 搜索状态
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // 当前正在查看的项目
  const [activeHit, setActiveHit] = useState<SearchHit | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [modrinthVersions, setModrinthVersions] = useState<ParsedModrinthVersion[]>([]);
  const [curseforgeFiles, setCurseforgeFiles] = useState<any[]>([]);
  const [curseforgeProjectId, setCurseforgeProjectId] = useState<number | null>(null);
  const [curseforgeDisplayName, setCurseforgeDisplayName] = useState<string>("");

  // 已选文件（兼容旧格式：client/server 顶层字段 → env 嵌套字段）
  const [selectedModrinth, setSelectedModrinth] = useState<ModrinthFileEntry[]>(
    ((existingFiles as ModrinthFileEntry[] | undefined)?.filter((f) => (f as any).hashes) || []).map(
      (f) => {
        const old = f as any;
        return {
          path: f.path,
          hashes: f.hashes,
          env: old.env
            ? f.env
            : {
                client: (old.client as "required" | "optional" | "unsupported") || "required",
                server: (old.server as "required" | "optional" | "unsupported") || "required",
              },
          downloads: f.downloads,
          fileSize: f.fileSize,
          display_name: f.display_name,
        };
      },
    ),
  );
  const [selectedCurseforge, setSelectedCurseforge] = useState<CurseforgeFileEntry[]>(
    (existingFiles as CurseforgeFileEntry[] | undefined)?.filter(
      (f) => (f as any).projectID !== undefined,
    ) || [],
  );

  // 保存状态
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");

  // 选中的 MC 版本（显示为"已选 X"）
  const matchedVersion = useMemo(() => {
    if (!gameVer.trim() || mcVersions.length === 0) return null;
    return findBestMatchingVersion(gameVer, mcVersions);
  }, [gameVer, mcVersions]);

  const mcVersionValid = matchedVersion !== null;

  useEffect(() => {
    getModpackDir().then(setDir);
  }, []);

  // MC 版本变化时，如果勾选了 OptiFine，自动获取对应版本的 OptiFine 列表
  useEffect(() => {
    if (!useOptifine || !matchedVersion) {
      setOptifineVersions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setOptifineLoading(true);
      try {
        const data = await invoke<
          { id: string; type_: string; mcversion: string; patch: string; filename: string; forge: string }[]
        >("get_optifine_versions", { mcVersion: matchedVersion.id });
        if (!cancelled) {
          setOptifineVersions(data || []);
          if (selectedOptifineVersion && !(data || []).some((v) => v.filename === selectedOptifineVersion)) {
            setSelectedOptifineVersion("");
          }
        }
      } catch (err) {
        console.error("获取 OptiFine 版本失败:", err);
        if (!cancelled) setOptifineVersions([]);
      } finally {
        if (!cancelled) setOptifineLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [useOptifine, matchedVersion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSelection =
    (format === "modrinth" ? selectedModrinth.length : selectedCurseforge.length) > 0;

  // ===========================================================================
  // 搜索（带 MC 版本 + 加载器过滤）
  // ===========================================================================
  const doSearch = async () => {
    const q = query.trim();
    if (!q) {
      setSearchError("请输入搜索关键词");
      return;
    }
    if (!mcVersionValid) {
      setSearchError("请先输入有效的 Minecraft 版本");
      return;
    }
    const targetMcVersion = matchedVersion!.id;

    setSearchLoading(true);
    setSearchError(null);
    setResults(null);
    setActiveHit(null);
    setModrinthVersions([]);
    setCurseforgeFiles([]);

    try {
      const hits: SearchHit[] = [];

      // Modrinth
      if (format === "modrinth") {
        const modrinthProjectType =
          category === "shaders" ? "shader" : category === "worlds" ? "world" : category;
        // 仅对 mod 类别做加载器过滤；其余类别（shader/resourcepack/datapack/worlds/modpack）一律不过滤 loader
        // 若开启信雅互联，则 mod 类别也解除 loader 限制（同时搜索 forge+fabric+neoforge+quilt+liteloader）
        const needLoaderFilter = category === "mod" && !crossLoader;
        const facetsBase = `[["project_type:${modrinthProjectType}"],["versions:${targetMcVersion}"]`;
        const facets = encodeURIComponent(
          needLoaderFilter
            ? `${facetsBase},["categories:${selectedLoader}"]]`
            : `${facetsBase}]`,
        );
        const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(q)}&limit=30&facets=${facets}`;
        const res = await fetch(url, { headers: MODRINTH_HEADERS, cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          for (const hit of data?.hits || []) {
            hits.push({
              slug: hit.slug,
              title: hit.title,
              description: hit.description,
              iconUrl: hit.icon_url,
              downloads: hit.downloads,
              categories: hit.categories,
              game_versions: hit.game_versions,
              updated: hit.date_modified || hit.date_updated,
              author: hit.author,
              source: "modrinth",
              project_type: hit.project_type,
              external_url: `https://modrinth.com/${hit.project_type || "mod"}/${hit.slug}`,
            });
          }
        }
      }

      // CurseForge
      if (format === "curseforge") {
        const classIdMap: Record<CategoryId, number> = {
          mod: 6,
          modpack: 4473,
          resourcepack: 12,
          shaders: 6552,
          datapack: 6949,
          worlds: 17,
        };
        // CurseForge: modLoaderType 只对 mod 类别有用
        // 0=Forge 1=Fabric 2=Rift 3=LiteLoader 4=ModLoader 5=Quilt 6=NeoForge 7=Optifine
        const loaderToCf: Record<string, number> = {
          forge: 0,
          fabric: 1,
          liteloader: 3,
          quilt: 5,
          neoforge: 6,
        };
        // 仅对 mod 类别做加载器过滤；信雅互联模式下解除限制
        const needLoaderFilter = category === "mod" && !crossLoader;
        const modLoaderType =
          needLoaderFilter ? loaderToCf[selectedLoader] : undefined;
        const url =
          `https://api.curseforge.com/v1/mods/search?gameId=432&searchFilter=${encodeURIComponent(q)}&pageSize=30&sortField=5&sortOrder=desc&classId=${classIdMap[category]}&gameVersion=${encodeURIComponent(targetMcVersion)}` +
          (modLoaderType !== undefined ? `&modLoaderType=${modLoaderType}` : "");
        const res = await fetch(url, { headers: CURSEFORGE_HEADERS, cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          for (const item of data?.data || []) {
            hits.push({
              slug: item.slug || String(item.id),
              title: item.name,
              description: item.summary,
              iconUrl: item.logo?.thumbnailUrl || item.logo?.url,
              downloads: item.downloadCount,
              categories: (item.categories || []).map((c: any) => c.name),
              game_versions: (item.latestFilesIndexes || [])
                .map((f: any) => f.gameVersion)
                .filter(Boolean),
              updated: item.dateModified || item.dateReleased,
              author: (item.authors || []).map((a: any) => a.name).join(", "),
              source: "curseforge",
              project_type: category,
              external_url:
                item.links?.websiteUrl ||
                `https://www.curseforge.com/minecraft/mc-mods/${item.slug || item.id}`,
            });
          }
        }
      }

      hits.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
      setResults(hits);
      if (hits.length === 0) {
        const filterDesc =
          category === "mod"
            ? crossLoader
              ? `${targetMcVersion}（已解除加载器限制）`
              : `${targetMcVersion} + ${selectedLoader}`
            : targetMcVersion;
        setSearchError(`未找到匹配 ${filterDesc} 的项目`);
      }
    } catch (e: any) {
      setSearchError(`搜索失败: ${e?.message || e}`);
    } finally {
      setSearchLoading(false);
    }
  };

  // ===========================================================================
  // 展开项目 + 获取版本/文件（过滤 MC 版本 + 加载器）
  // ===========================================================================
  const openHit = async (hit: SearchHit) => {
    setActiveHit(hit);
    setActiveLoading(true);
    setActiveError(null);
    setModrinthVersions([]);
    setCurseforgeFiles([]);

    const targetMcVersion = matchedVersion?.id;

    try {
      if (format === "modrinth") {
        const data = await fetch(
          `https://api.modrinth.com/v2/project/${encodeURIComponent(hit.slug)}/version`,
          { headers: MODRINTH_HEADERS, cache: "no-store" },
        );
        if (!data.ok) {
          throw new Error(`Modrinth API 失败 (${data.status})`);
        }
        const json = await data.json();
        const list: ParsedModrinthVersion[] = [];
        if (Array.isArray(json)) {
          for (const v of json) {
            if (targetMcVersion) {
              const gv: string[] = Array.isArray(v.game_versions) ? v.game_versions : [];
              if (!gv.includes(targetMcVersion)) continue;
            }
            // 仅对 mod 类别做加载器过滤；其余类别不过滤 loader
            // 若开启信雅互联，则 mod 类别也不过滤（同时展示 forge fabric neoforge quilt liteloader）
            const needLoaderFilter = category === "mod" && !crossLoader;
            if (needLoaderFilter) {
              const loaders: string[] = Array.isArray(v.loaders) ? v.loaders : [];
              if (!loaders.includes(selectedLoader)) continue;
            }
            const primary = pickPrimaryFile(v);
            if (!primary) continue;
            list.push({
              id: v.id,
              version_number: v.version_number || "",
              game_versions: v.game_versions || [],
              loaders: v.loaders || [],
              files: [primary],
              date_published: v.date_published || "",
              version_type: v.version_type || "release",
            });
          }
        }
        setModrinthVersions(list);
      } else {
        // CurseForge
        let proj = await fetchCurseforgeProjectId(hit.slug);
        if (!proj) {
          const asNum = parseInt(hit.slug, 10);
          if (!isNaN(asNum)) {
            proj = { projectId: asNum, projectName: hit.title };
          }
        }
        if (!proj) {
          throw new Error("无法在 CurseForge 找到该项目");
        }
        setCurseforgeProjectId(proj.projectId);
        setCurseforgeDisplayName(proj.projectName);
        const rawFiles = await fetchCurseforgeFiles(proj.projectId);
        let filtered = rawFiles;
        if (targetMcVersion) {
          filtered = rawFiles.filter((f: any) => {
            const gv: string[] = Array.isArray(f.game_versions) ? f.game_versions : [];
            return gv.includes(targetMcVersion);
          });
          if (filtered.length === 0) {
            filtered = rawFiles;
          }
        }
        // CurseForge: 仅对 mod 类别按 modLoaderType 过滤；信雅互联模式下解除限制
        if (category === "mod" && !crossLoader) {
          const loaderToCf: Record<string, number> = {
            forge: 0,
            fabric: 1,
            liteloader: 3,
            quilt: 5,
            neoforge: 6,
          };
          const wantType = loaderToCf[selectedLoader];
          if (wantType !== undefined) {
            const byLoader = filtered.filter(
              (f: any) => f.modLoaderType === wantType,
            );
            if (byLoader.length > 0) filtered = byLoader;
          }
        }
        setCurseforgeFiles(filtered);
      }
    } catch (e: any) {
      setActiveError(e?.message || String(e));
    } finally {
      setActiveLoading(false);
    }
  };

  async function fetchCurseforgeProjectId(
    slug: string,
  ): Promise<{ projectId: number; projectName: string } | null> {
    const url = `https://api.curseforge.com/v1/mods/search?gameId=432&slug=${encodeURIComponent(slug)}&pageSize=1`;
    const res = await fetch(url, { headers: CURSEFORGE_HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const first = data?.data?.[0];
    if (!first) return null;
    return { projectId: first.id, projectName: first.name || slug };
  }

  async function fetchCurseforgeFiles(projectId: number): Promise<any[]> {
    const url = `https://api.curseforge.com/v1/mods/${projectId}/files?pageSize=50`;
    const res = await fetch(url, { headers: CURSEFORGE_HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data || [];
  }

  // ===========================================================================
  // 加入已选
  // ===========================================================================
  const addModrinthFile = (hit: SearchHit, v: ParsedModrinthVersion) => {
    const primary = v.files[0];
    if (!primary) return;
    const subfolder = defaultSubfolderForCategory(category, hit.project_type);
    const path = subfolder ? `${subfolder}/${primary.filename}` : primary.filename;
    const entry: ModrinthFileEntry = {
      path,
      hashes: {
        sha1: primary.hashes.sha1,
        sha512: primary.hashes.sha512 || "",
        sha256: primary.hashes.sha256,
      },
      env: {
        client: "required",
        server: "required",
      },
      downloads: [primary.url],
      fileSize: primary.size || 0,
      display_name: `${hit.title} — ${v.version_number}`,
    };
    setSelectedModrinth((prev) => {
      const exists = prev.some(
        (p) => p.path === entry.path && p.hashes.sha1 === entry.hashes.sha1,
      );
      if (exists) return prev;
      return [...prev, entry];
    });
  };

  const addCurseforgeFile = (f: any) => {
    if (!curseforgeProjectId) return;
    const entry: CurseforgeFileEntry = {
      projectID: curseforgeProjectId,
      fileID: f.id,
      display_name: `${curseforgeDisplayName || activeHit?.title} — ${f.displayName || f.fileName || f.id}`,
      required: true,
    };
    setSelectedCurseforge((prev) => {
      const exists = prev.some(
        (p) => p.projectID === entry.projectID && p.fileID === entry.fileID,
      );
      if (exists) return prev;
      return [...prev, entry];
    });
  };

  // 修改 Modrinth 侧/端状态
  const updateModrinthSide = (
    idx: number,
    side: "client" | "server",
    value: string,
  ) => {
    setSelectedModrinth((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        env: {
          ...next[idx].env,
          [side]: value as "required" | "optional" | "unsupported",
        },
      };
      return next;
    });
  };

  const toggleCurseforgeRequired = (idx: number) => {
    setSelectedCurseforge((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], required: !next[idx].required };
      return next;
    });
  };

  // 移除
  const removeModrinth = (idx: number) => {
    setSelectedModrinth((prev) => prev.filter((_, i) => i !== idx));
  };
  const removeCurseforge = (idx: number) => {
    setSelectedCurseforge((prev) => prev.filter((_, i) => i !== idx));
  };

  // ===========================================================================
  // 保存
  // ===========================================================================
  const handleSave = async (silent = false) => {
    const trimmed = name.trim();
    if (!trimmed) {
      if (!silent) {
        setSaveStatus("error");
        setSaveMessage("请先填写整合包名称");
      }
      return false;
    }
    if (!mcVersionValid) {
      if (!silent) {
        setSaveStatus("error");
        setSaveMessage("Minecraft 版本无效，无法保存");
      }
      return false;
    }

    setSaveStatus("saving");
    setSaveMessage("正在保存...");
    try {
      if (format === "modrinth") {
        const deps: {
          minecraft: string;
          "fabric-loader"?: string;
          forge?: string;
          "neoforge-loader"?: string;
          "quilt-loader"?: string;
        } = { minecraft: matchedVersion!.id };
        if (selectedLoader === "fabric") deps["fabric-loader"] = "latest";
        else if (selectedLoader === "forge") deps.forge = "latest";
        else if (selectedLoader === "neoforge") deps["neoforge-loader"] = "latest";
        else if (selectedLoader === "quilt") deps["quilt-loader"] = "latest";

        await saveInstance({
          formatVersion: 1,
          game: "minecraft",
          versionId: matchedVersion!.id,
          name: trimmed,
          summary: `RTLauncher Modrinth 整合包 - ${matchedVersion!.id}`,
          format: "modrinth",
          files: selectedModrinth.map((f) => ({
            path: f.path,
            hashes: f.hashes,
            env: f.env,
            downloads: f.downloads,
            fileSize: f.fileSize,
            display_name: f.display_name,
          })),
          dependencies: deps,
          loader: selectedLoader,
          optifine: useOptifine,
          optifine_version: useOptifine ? selectedOptifineVersion || null : null,
          cross_loader: crossLoader,
          created_at: 0,
          updated_at: 0,
        });
      } else {
        await saveInstance({
          format: "curseforge",
          name: trimmed,
          game_version: matchedVersion!.id,
          loader: selectedLoader,
          optifine: useOptifine,
          optifine_version: useOptifine ? selectedOptifineVersion || null : null,
          cross_loader: crossLoader,
          created_at: 0,
          updated_at: 0,
          files: selectedCurseforge.map((f) => ({
            ...f,
            required: f.required !== undefined ? f.required : true,
          })),
        });
      }
      setSaveStatus("saved");
      setSaveMessage(`已保存：${dir || "<minecraft>/modpack"}/${trimmed}.json`);
      setTimeout(() => {
        setSaveStatus((s) => (s === "saved" ? "idle" : s));
      }, 4000);
      return true;
    } catch (e: any) {
      setSaveStatus("error");
      setSaveMessage(`保存失败: ${e?.message || e}`);
      return false;
    }
  };

  // 点击"返回"按钮：先自动保存再跳转
  const handleBack = async () => {
    if (name.trim() && mcVersionValid) {
      await handleSave(true);
    }
    router.push("/tools");
  };

  // ===========================================================================
  // 版本下拉候选（当用户输入时）
  // ===========================================================================
  const versionCandidates = useMemo(() => {
    if (!gameVer.trim()) {
      // 没输入时，显示最新的 12 个 release
      return mcVersions.filter((v) => v.type === "release").slice(0, 12);
    }
    const q = gameVer.trim().toLowerCase();
    return mcVersions
      .filter((v) => v.id.toLowerCase().includes(q))
      .slice(0, 16);
  }, [gameVer, mcVersions]);

  // ===========================================================================
  // 渲染
  // ===========================================================================

  const formatLabel = format === "modrinth" ? "Modrinth mrpack" : "CurseForge 整合包";
  const total =
    format === "modrinth" ? selectedModrinth.length : selectedCurseforge.length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* 顶部标题栏 */}
      <div className="shrink-0 border-b border-border p-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBack}
            className="gap-1"
          >
            <ArrowLeft className="size-4" />
            返回
          </Button>
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
            {format === "modrinth" ? (
              <Package className="size-5 text-primary" />
            ) : (
              <Box className="size-5 text-primary" />
            )}
          </div>
          <div className="flex-1">
            <div className="text-lg font-semibold leading-none">
              制作 {formatLabel}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              已添加 {total} 个文件，点击"返回"自动保存为实例
            </div>
          </div>
        </div>

        {/* 元数据输入 */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">整合包名称 *</label>
            <Input
              placeholder="如：My Fantastic Pack"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* MC 版本：输入框 + 下拉候选 */}
          <div className="flex flex-col gap-1 relative">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              Minecraft 版本 *
              {mcLoading && <Loader2 className="size-3 animate-spin" />}
              {mcError && <span className="text-red-500">· 加载失败</span>}
            </label>
            <div className="relative">
              <Input
                placeholder={mcLoading ? "加载版本列表..." : "如：1.21.1、24w10a"}
                value={gameVer}
                onChange={(e) => {
                  setGameVer(e.target.value);
                  setVersionDropdownOpen(true);
                }}
                onFocus={() => setVersionDropdownOpen(true)}
                onBlur={() => {
                  // 延迟关闭，允许点击候选
                  setTimeout(() => setVersionDropdownOpen(false), 180);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setVersionDropdownOpen(false);
                  if (e.key === "Enter") setVersionDropdownOpen(false);
                }}
                className={`pr-10 ${
                  gameVer.trim() && !mcVersionValid
                    ? "border-red-400 focus-visible:ring-red-400"
                    : ""
                }`}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setVersionDropdownOpen((v) => !v)}
                tabIndex={-1}
              >
                {gameVer.trim() && !mcVersionValid ? (
                  <X className="size-4 text-red-400" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>

              {versionDropdownOpen && versionCandidates.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-xl z-40 max-h-64 overflow-y-auto">
                  {versionCandidates.map((v) => (
                    <button
                      type="button"
                      key={v.id}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-accent/60 flex items-center justify-between ${
                        matchedVersion?.id === v.id ? "bg-primary/10" : ""
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setGameVer(v.id);
                        setVersionDropdownOpen(false);
                      }}
                    >
                      <span className="font-mono">{v.id}</span>
                      <span className="flex items-center gap-2">
                        <Badge
                          variant={v.type === "release" ? "default" : "outline"}
                          className="text-[9px] py-0"
                        >
                          {v.type === "release"
                            ? "正式版"
                            : v.type === "snapshot"
                              ? "快照"
                              : v.type === "april_fools"
                                ? "愚人节"
                                : "远古"}
                        </Badge>
                        <span className="text-muted-foreground">{v.releaseDate}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {gameVer.trim() && !mcVersionValid && (
              <span className="text-[11px] text-red-500">
                未匹配到任何 Minecraft 版本，请从下拉中选择或修改输入
              </span>
            )}
            {mcVersionValid && (
              <span className="text-[11px] text-green-600 flex items-center gap-1">
                <CheckCircle2 className="size-3" />
                已匹配：{matchedVersion!.id}（{matchedVersion!.type}）
              </span>
            )}
          </div>

          {/* 加载器：forge / neoforge / fabric / quilt / liteloader */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              模组加载器 *
              {crossLoader && (
                <Badge variant="outline" className="text-[9px] py-0 text-amber-600 border-amber-400">
                  互联
                </Badge>
              )}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {["forge", "neoforge", "fabric", "quilt", "liteloader"].map((loader) => (
                <Badge
                  key={loader}
                  onClick={() => setSelectedLoader(loader)}
                  variant={selectedLoader === loader ? "default" : "outline"}
                  className={`cursor-pointer text-[11px] py-0.5 px-2 capitalize select-none ${crossLoader ? "opacity-60" : "hover:brightness-110"}`}
                >
                  {loader === "neoforge"
                    ? "NeoForge"
                    : loader.charAt(0).toUpperCase() + loader.slice(1)}
                </Badge>
              ))}
            </div>
            <label className="text-[11px] text-muted-foreground flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                checked={crossLoader}
                onChange={(e) => setCrossLoader(e.target.checked)}
                className="size-3 accent-primary"
              />
              <span>
                开启信雅互联模式
              </span>
              <span className="text-[10px] text-amber-600">
                · 同时搜索 Fabric + Forge 模组，解除加载器限制
              </span>
            </label>
          </div>

          {/* OptiFine 勾选 + 版本选择 */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              <input
                type="checkbox"
                checked={useOptifine}
                onChange={(e) => {
                  setUseOptifine(e.target.checked);
                  if (!e.target.checked) setSelectedOptifineVersion("");
                }}
                className="size-3 accent-primary"
              />
              <span>启用 OptiFine</span>
              {optifineLoading && useOptifine && (
                <Loader2 className="size-3 animate-spin" />
              )}
            </label>
            {useOptifine && (
              <div className="flex flex-col gap-1">
                {optifineVersions.length === 0 && (
                  <span className="text-[11px] text-amber-600">
                    对应 {matchedVersion?.id} 的 OptiFine 版本暂不可用
                  </span>
                )}
                {optifineVersions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {optifineVersions.map((v) => (
                      <Badge
                        key={v.filename}
                        onClick={() => setSelectedOptifineVersion(v.filename)}
                        variant={selectedOptifineVersion === v.filename ? "default" : "outline"}
                        className="cursor-pointer text-[11px] py-0.5 px-2 hover:brightness-110"
                        title={`${v.id} · 类型：${v.type_}`}
                      >
                        {v.patch || v.id}
                      </Badge>
                    ))}
                  </div>
                )}
                {useOptifine && optifineVersions.length > 0 && !selectedOptifineVersion && (
                  <span className="text-[11px] text-amber-600">请选择一个 OptiFine 版本</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-end justify-end gap-2">
            <Button
              size="sm"
              onClick={() => handleSave(false)}
              disabled={
                !name.trim() ||
                !mcVersionValid ||
                saveStatus === "saving" ||
                (useOptifine && optifineVersions.length > 0 && !selectedOptifineVersion)
              }
              className="gap-1"
            >
              {saveStatus === "saving" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : saveStatus === "saved" ? (
                <CheckCircle2 className="size-4 text-green-500" />
              ) : saveStatus === "error" ? (
                <AlertCircle className="size-4 text-red-500" />
              ) : (
                <Save className="size-4" />
              )}
              手动保存
            </Button>
          </div>
        </div>

        {/* 保存状态 */}
        {saveStatus !== "idle" && (
          <div
            className={`mt-2 text-xs ${
              saveStatus === "error"
                ? "text-red-500"
                : saveStatus === "saved"
                  ? "text-green-600"
                  : "text-muted-foreground"
            }`}
          >
            {saveMessage}
          </div>
        )}

        {dir && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            <Folder className="size-3" />
            保存至：<span className="font-mono">{dir}</span>
          </div>
        )}
      </div>

      {/* 主体内容 */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-5 gap-0">
        {/* 左：搜索 + 项目详情 */}
        <div className="lg:col-span-3 overflow-y-auto border-r border-border p-4 space-y-4">
          {/* 搜索栏 */}
          <div>
            <div className="text-xs text-muted-foreground mb-2">选择资源分类</div>
            <div className="flex flex-wrap gap-2 mb-3">
              {(
                [
                  ["mod", "Mods"],
                  ["modpack", "Modpacks"],
                  ["resourcepack", "Resource Packs"],
                  ["shaders", "Shaders"],
                  ["datapack", "Data Packs"],
                  ["worlds", "Worlds"],
                ] as [CategoryId, string][]
              ).map(([id, label]) => (
                <Button
                  key={id}
                  variant={category === id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCategory(id)}
                >
                  {label}
                </Button>
              ))}
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={
                    !mcVersionValid
                      ? "请先在上方输入 Minecraft 版本"
                      : format === "modrinth"
                        ? `搜索 Modrinth 项目（MC ${matchedVersion?.id || "?"}）`
                        : `搜索 CurseForge 项目（MC ${matchedVersion?.id || "?"}）`
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  disabled={!mcVersionValid}
                  className="pl-9"
                />
              </div>
              <Button onClick={doSearch} disabled={searchLoading || !mcVersionValid}>
                {searchLoading ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
                搜索
              </Button>
            </div>
            {searchError && (
              <div className="mt-2 text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="size-3" /> {searchError}
              </div>
            )}
          </div>

          {/* 搜索结果列表 */}
          {results !== null && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2 border-b bg-muted/30 text-xs text-muted-foreground">
                {results.length} 个结果（MC {matchedVersion?.id}）
              </div>
              <div className="divide-y divide-border max-h-[35vh] overflow-y-auto">
                {results.map((hit, idx) => (
                  <button
                    key={idx}
                    onClick={() => openHit(hit)}
                    className={`w-full text-left p-3 hover:bg-accent/50 transition-colors flex items-center gap-3 ${
                      activeHit?.slug === hit.slug && activeHit?.source === hit.source
                        ? "bg-accent/40"
                        : ""
                    }`}
                  >
                    {hit.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={hit.iconUrl}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover bg-muted shrink-0"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-muted shrink-0 flex items-center justify-center">
                        <Box className="size-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{hit.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {hit.description || "—"}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <Badge
                          variant={hit.source === "modrinth" ? "default" : "outline"}
                          className="text-[10px] py-0"
                        >
                          {hit.source}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] py-0">
                          MC {matchedVersion?.id}
                        </Badge>
                        <span>{hit.downloads?.toLocaleString()} 下载</span>
                        {hit.author && <span>· {hit.author}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 项目详情 + 文件选择 */}
          {activeHit && (
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-medium text-sm flex items-center gap-2">
                  <Package className="size-4 text-primary" /> {activeHit.title}
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {activeHit.source}
                </Badge>
              </div>

              {activeLoading ? (
                <div className="py-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> 正在加载文件信息...
                </div>
              ) : activeError ? (
                <div className="py-2 text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="size-3" /> {activeError}
                </div>
              ) : format === "modrinth" ? (
                <div className="space-y-2 max-h-[38vh] overflow-y-auto">
                  {modrinthVersions.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2">
                      无可用版本（该项目没有适配 MC {matchedVersion?.id}）
                    </div>
                  ) : (
                    modrinthVersions.map((v) => {
                      const primary = v.files[0];
                      const already = selectedModrinth.some(
                        (f) => f.hashes.sha1 === primary?.hashes.sha1,
                      );
                      return (
                        <div
                          key={v.id}
                          className="border border-border rounded-lg p-3 hover:border-primary/50 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">
                                {v.version_number || v.id}
                              </div>
                              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1">
                                {v.loaders.length > 0 && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {v.loaders.join(", ")}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-[10px]">
                                  MC {matchedVersion?.id}
                                </Badge>
                                <span className="text-[10px]">
                                  {(primary?.size || 0) > 0
                                    ? `${(primary!.size / 1024).toFixed(1)} KB`
                                    : ""}
                                </span>
                                <span className="text-[10px]">· {v.version_type}</span>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => addModrinthFile(activeHit, v)}
                              disabled={already}
                            >
                              {already ? (
                                <>
                                  <CheckCircle2 className="size-4 mr-1 text-green-500" />
                                  已添加
                                </>
                              ) : (
                                <>
                                  <Plus className="size-4 mr-1" /> 添加
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="space-y-2 max-h-[38vh] overflow-y-auto">
                  {curseforgeFiles.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2">
                      无可用文件（该项目没有适配 MC {matchedVersion?.id}）
                    </div>
                  ) : (
                    curseforgeFiles.map((f) => {
                      const already = selectedCurseforge.some(
                        (p) =>
                          p.projectID === curseforgeProjectId && p.fileID === f.id,
                      );
                      return (
                        <div
                          key={f.id}
                          className="border border-border rounded-lg p-3 hover:border-primary/50 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">
                                {f.displayName || f.fileName || `File #${f.id}`}
                              </div>
                              <div className="text-xs text-muted-foreground flex flex-wrap gap-1">
                                <Badge variant="outline" className="text-[10px]">
                                  MC {matchedVersion?.id}
                                </Badge>
                                <Badge variant="outline" className="text-[10px]">
                                  {f.releaseType === 1
                                    ? "正式版"
                                    : f.releaseType === 2
                                      ? "Beta"
                                      : "Alpha"}
                                </Badge>
                                {f.fileDate && (
                                  <span className="text-[10px]">
                                    · {formatTimestamp(Math.floor(new Date(f.fileDate).getTime() / 1000))}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => addCurseforgeFile(f)}
                              disabled={already}
                            >
                              {already ? (
                                <>
                                  <CheckCircle2 className="size-4 mr-1 text-green-500" />
                                  已添加
                                </>
                              ) : (
                                <>
                                  <Plus className="size-4 mr-1" /> 添加
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右：已选文件 */}
        <div className="lg:col-span-2 overflow-y-auto p-4 bg-muted/20">
          <div className="font-medium text-sm mb-2 flex items-center gap-2">
            <Box className="size-4 text-primary" />
            已添加 ({total})
          </div>
          <div className="space-y-2">
            {format === "modrinth" ? (
              selectedModrinth.length === 0 ? (
                <div className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded-xl">
                  还没有文件，从左侧搜索并添加
                </div>
              ) : (
                selectedModrinth.map((f, idx) => (
                  <div
                    key={`${f.path}-${f.hashes.sha1}`}
                    className="bg-card border border-border rounded-xl p-3"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">
                          {f.display_name || f.path.split("/").pop()}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          {f.path}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeModrinth(idx)}
                      >
                        <Trash2 className="size-3.5 text-red-500" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <Monitor className="size-3 text-muted-foreground" />
                        <select
                          className="flex-1 bg-background border border-border rounded-md px-1.5 py-1 text-xs"
                          value={f.env.client}
                          onChange={(e) =>
                            updateModrinthSide(idx, "client", e.target.value)
                          }
                        >
                          <option value="required">客户端：必须</option>
                          <option value="optional">客户端：可选</option>
                          <option value="unsupported">客户端：不支持</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-1">
                        <Server className="size-3 text-muted-foreground" />
                        <select
                          className="flex-1 bg-background border border-border rounded-md px-1.5 py-1 text-xs"
                          value={f.env.server}
                          onChange={(e) =>
                            updateModrinthSide(idx, "server", e.target.value)
                          }
                        >
                          <option value="required">服务端：必须</option>
                          <option value="optional">服务端：可选</option>
                          <option value="unsupported">服务端：不支持</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground font-mono truncate">
                      sha1: {f.hashes.sha1.slice(0, 16)}...
                    </div>
                  </div>
                ))
              )
            ) : selectedCurseforge.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded-xl">
                还没有文件，从左侧搜索并添加
              </div>
            ) : (
              selectedCurseforge.map((f, idx) => (
                <div
                  key={`${f.projectID}-${f.fileID}`}
                  className="bg-card border border-border rounded-xl p-3"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">
                        {f.display_name || `Project #${f.projectID} File #${f.fileID}`}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        projectID: {f.projectID} · fileID: {f.fileID}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCurseforge(idx)}
                    >
                      <Trash2 className="size-3.5 text-red-500" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={f.required !== false}
                        onChange={() => toggleCurseforgeRequired(idx)}
                      />
                      <span>
                        {f.required !== false ? "✅ 必须安装" : "⚙️ 可选安装"}
                      </span>
                    </label>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}