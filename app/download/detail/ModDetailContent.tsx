<<<<<<< HEAD
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { ArrowLeft, ChevronDown, Shield, FlaskConical, Loader2, Download, CheckCircle2, XCircle, Package, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { invoke } from "@tauri-apps/api/core";
import { useDownloadManager } from "@/components/download/download-provider";
import { useRouter } from "next/navigation";

const openExternalUrl = async (url: string) => {
  try {
    await invoke("open_external", { url });
  } catch (err) {
    console.error("Failed to open URL:", err);
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
};

interface ModFiles {
  [mcVersion: string]: Array<[string[], string]>;
}

interface LiveModDetail {
  slug: string;
  title: string;
  description?: string;
  body?: string;
  iconUrl?: string;
  projectType?: string;
  downloads?: number;
  categories?: string[];
  gameVersions?: string[];
  latestVersions?: string[];
  updated?: string;
  author?: string;
  source: 'modrinth' | 'curseforge' | 'both';
  sources: {
    modrinth: { ok: boolean; url?: string; error?: string };
    curseforge: { ok: boolean; url?: string; error?: string };
  };
  modrinthUrl?: string;
  curseforgeUrl?: string;
  mcmodUrl?: string;
  classId?: number;
}

interface ParsedFile {
  tags: string[];
  cleanTags: string[];
  url: string;
  isRelease: boolean;
  hasForge: boolean;
  hasFabric: boolean;
  hasNeoForge: boolean;
  hasQuilt: boolean;
  hasLiteLoader: boolean;
  hasOrnithe: boolean;
  loaderLabel: string;
  versionLabel: string;
  serverLabel: string;
}

function decodeUriSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** CurseForge classId -> 项目类型（用于推断非 Modrinth 项目的类型） */
function classIdToProjectType(classId: number): string {
  switch (classId) {
    case 6: return "mod";
    case 12: return "resourcepack";
    case 6552: return "shader";
    case 6945: return "datapack";
    case 6949: return "datapack";
    case 17: return "world";
    case 4471: return "modpack";
    case 4473: return "modpack";
    default: return "mod";
  }
}

function cleanFileName(name: string): string {
  if (!name) return name;
  let s = name;
  s = decodeUriSafe(s);
  s = s.replace(/\+/g, " ");
  s = s.replace(/_{2,}/g, " ").replace(/\.{2,}/g, ".");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

function formatDownloads(n?: number): string {
  if (n === undefined || n === null) return "";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function translateProjectType(pt?: string): string {
  if (!pt) return "未知";
  const lower = pt.toLowerCase();
  const map: Record<string, string> = {
    mod: "模组",
    "minecraft mod": "模组",
    modpack: "整合包",
    "mod pack": "整合包",
    resourcepack: "资源包",
    "resource pack": "资源包",
    "texture pack": "资源包",
    shader: "光影包",
    shaders: "光影包",
    "shader pack": "光影包",
    "shaderpack": "光影包",
    datapack: "数据包",
    "data pack": "数据包",
    world: "地图",
    worlds: "地图",
  };
  return map[lower] ?? pt;
}

function translateCategory(cat: string): string {
  const map: Record<string, string> = {
    "forge": "Forge",
    "fabric": "Fabric",
    "neoforge": "NeoForge",
    "quilt": "Quilt",
    "vanilla": "原版",
    "utility": "工具",
    "storage": "存储",
    "decoration": "装饰",
    "library": "前置",
    "library / api": "前置 API",
    "api and library": "前置 API",
    "magic": "魔法",
    "technology": "科技",
    "tech": "科技",
    "adventure": "冒险",
    "adventure and rpg": "冒险 RPG",
    "rpg": "RPG",
    "world gen": "世界生成",
    "world generation": "世界生成",
    "dungeons and dimensions": "地牢与维度",
    "dungeons": "地牢",
    "dimensions": "维度",
    "entities": "实体",
    "mobs": "怪物",
    "food": "食物",
    "farming": "农业",
    "energy": "能源",
    "redstone": "红石",
    "automation": "自动化",
    "transport": "交通",
    "buildcraft": "建筑",
    "combat": "战斗",
    "armor, tools, and weapons": "装备与工具",
    "armor, tools & weapons": "装备与工具",
    "performance": "性能",
    "optimization": "优化",
    "qol": "品质生活",
    "quality of life": "品质生活",
    "information": "信息",
    "tweaks": "微调",
    "cosmetic": "美化",
    "environmental": "环境",
    "biomes": "群系",
    "structures": "结构",
    "miscellaneous": "杂项",
    "misc": "杂项",
  };
  const lower = cat.toLowerCase();
  return map[lower] ?? cat;
}

function formatDateShort(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = Date.now();
    const diffMs = now - d.getTime();
    const day = 24 * 60 * 60 * 1000;
    if (diffMs < day) return "今日";
    if (diffMs < 7 * day) return Math.round(diffMs / day) + " 天前";
    if (diffMs < 30 * day) return Math.round(diffMs / (7 * day)) + " 周前";
    if (diffMs < 365 * day) return Math.round(diffMs / (30 * day)) + " 个月前";
    return Math.round(diffMs / (365 * day)) + " 年前";
  } catch {
    return "";
  }
}

function isReleaseVersion(tags: string[]): boolean {
  const releaseKeywords = ["正式版", "release", "Release", "RELEASE", "稳定版", "正式"];
  const betaKeywords = ["beta", "Beta", "测试", "alpha", "Alpha", "快照", "snapshot", "SNAPSHOT", "实验", "Experimental", "experimental", "dev", "DEV", "Dev"];

  for (const tag of tags) {
    const lowerTag = tag.toLowerCase();
    if (betaKeywords.some(k => lowerTag.includes(k.toLowerCase()))) {
      return false;
    }
  }
  for (const tag of tags) {
    const lowerTag = tag.toLowerCase();
    if (releaseKeywords.some(k => lowerTag.includes(k.toLowerCase()))) {
      return true;
    }
  }
  return true;
}

function extractLoaderInfo(tags: string[]) {
  let hasForge = false;
  let hasFabric = false;
  let hasNeoForge = false;
  let hasQuilt = false;
  let hasLiteLoader = false;
  let hasOrnithe = false;
  let loaderLabel = "";
  let isServer = false;
  let isClient = false;

  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower === "server" || lower === "server-1" || lower.includes("server")) {
      isServer = true;
    } else if (lower.includes("neoforge") || lower.includes("neo")) {
      hasNeoForge = true;
      if (!loaderLabel) loaderLabel = "NeoForge";
    } else if (lower.includes("forge") && !lower.includes("neo")) {
      hasForge = true;
      if (!loaderLabel) loaderLabel = "Forge";
    } else if (lower.includes("fabric")) {
      hasFabric = true;
      if (!loaderLabel) loaderLabel = "Fabric";
    } else if (lower.includes("quilt")) {
      hasQuilt = true;
      if (!loaderLabel) loaderLabel = "Quilt";
    } else if (lower.includes("liteloader") || lower.includes("lite") || lower.includes("litemod")) {
      hasLiteLoader = true;
      if (!loaderLabel) loaderLabel = "LiteLoader";
    } else if (lower.includes("ornithe")) {
      hasOrnithe = true;
      if (!loaderLabel) loaderLabel = "Ornithe";
    } else if (lower === "client") {
      isClient = true;
    }
  }

  if (!loaderLabel) loaderLabel = "通用";

  let serverLabel = "";
  if (isServer && isClient) {
    serverLabel = "服务端 + 客户端";
  } else if (isServer) {
    serverLabel = "服务端";
  } else if (isClient) {
    serverLabel = "客户端";
  }

  return { hasForge, hasFabric, hasNeoForge, hasQuilt, hasLiteLoader, hasOrnithe, loaderLabel, serverLabel };
}

function extractVersionLabel(url: string, tags: string[]): string {
  // 排除纯 MC 版本号格式：如 1.21, 1.21.1, 1.20.4 等
  const isMcVersion = (s: string): boolean => {
    const trimmed = s.trim();
    // 纯数字点分格式：1.x 或 1.x.x
    return /^\d+\.\d+(\.\d+)?$/.test(trimmed);
  };

  // 1) 优先从 tags 找真正的模组版本号（不是纯 MC 版本号，且带版本特征）
  for (const tag of tags) {
    const clean = cleanFileName(tag);
    if (!clean || clean.length > 40) continue;
    // 接受：v1.2.3 / 2.0.1+mc1.21 / 模组名-1.2.3 等
    // 拒绝：纯 MC 版本号（如 1.21, 1.20.4）
    if (/v?\d+\.\d+/.test(clean) && !isMcVersion(clean)) {
      return clean;
    }
  }

  // 2) 从 URL 文件名提取
  try {
    const parts = url.split("/");
    const fileName = parts[parts.length - 1].split("?")[0];
    if (fileName.length > 0) {
      const simpleName = cleanFileName(fileName).replace(/\.[^.]+$/, "");
      if (simpleName.length > 0) {
        return simpleName.length > 60 ? simpleName.substring(0, 57) + "..." : simpleName;
      }
    }
  } catch {
    // ignore
  }

  // 3) 最后兜底：从 tags 里找第一个非纯 MC 版本的数字标签
  for (const tag of tags) {
    const clean = cleanFileName(tag);
    if (!clean) continue;
    if (!isMcVersion(clean) && clean.length < 40) {
      return clean;
    }
  }

  return "未知版本";
}

function cleanTags(tags: string[], mcVersion: string, loaderLabel: string, serverLabel: string): string[] {
  const skip = new Set<string>();
  skip.add(mcVersion.toLowerCase());
  skip.add("java");
  const loaders = ["forge", "fabric", "neoforge", "neo", "quilt", loaderLabel.toLowerCase()];
  for (const l of loaders) skip.add(l);
  const releases = ["release", "beta", "alpha", "snapshot", "正式版", "测试版", "正式", "稳定版", "实验", "实验性"];
  for (const r of releases) skip.add(r);
  skip.add("server");
  skip.add("client");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = cleanFileName(raw);
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    if (!t || t.length === 0) continue;
    if (skip.has(lower)) continue;
    if (lower.startsWith("java") || /^java\s*\d+/i.test(t)) continue;
    if (/^\d+\.\d+(\.\d+)?$/.test(t.trim())) continue;
    if (t.length > 40) continue;
    result.push(t);
    seen.add(lower);
  }
  return result;
}

export default function ModDetailContent({ modId }: { modId: string }) {
  const router = useRouter();
  const [liveInfo, setLiveInfo] = useState<LiveModDetail | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [modFiles, setModFiles] = useState<ModFiles | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [downloadingUrlToTaskId, setDownloadingUrlToTaskId] = useState<Map<string, number>>(new Map());
  const [filesError, setFilesError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const { startModDownload, startResourceDownload, tasks } = useDownloadManager();

  // 根据 URL 获取下载状态（用 taskId 精确匹配）
  const getDownloadStatus = (url: string) => {
    const taskId = downloadingUrlToTaskId.get(url);
    if (taskId !== undefined) {
      if (taskId === -1) {
        // 正在等待后端返回 taskId，显示"下载中"
        return "downloading";
      }
      const task = tasks.find(t => t.taskId === taskId);
      if (task) {
        if (task.status === "success" || task.status === "warning") return "success";
        if (task.status === "error") return "error";
        if (task.status === "downloading" || task.status === "queued") return "downloading";
        if (task.status === "cancelled") return "idle";
      } else {
        // task 可能已被清除（clearFinished / removeTask），视为已完成
        return "success";
      }
    }
    // 降级：通过 label 模糊匹配
    const fallbackTask = tasks.find(t => {
      return t.label.includes(modId) || t.label.includes(liveInfo?.slug || modId);
    });
    if (fallbackTask?.status === "success" || fallbackTask?.status === "warning") return "success";
    return "idle";
  };

  const parsedFiles = useMemo(() => {
    if (!modFiles) return new Map<string, ParsedFile[]>();

    const result = new Map<string, ParsedFile[]>();
    for (const [mcVersion, files] of Object.entries(modFiles)) {
      const parsed: ParsedFile[] = files.map(([tags, url]) => {
        const isRelease = isReleaseVersion(tags);
        const loaderInfo = extractLoaderInfo(tags);
        const versionLabel = extractVersionLabel(url, tags);
        const clean = cleanTags(tags, mcVersion, loaderInfo.loaderLabel, loaderInfo.serverLabel);
        return {
          tags,
          cleanTags: clean,
          url,
          isRelease,
          ...loaderInfo,
          versionLabel,
        };
      });
      parsed.sort((a, b) => {
        if (a.isRelease !== b.isRelease) return a.isRelease ? -1 : 1;
        return 0;
      });
      result.set(mcVersion, parsed);
    }
    return result;
  }, [modFiles]);

  useEffect(() => {
    loadModData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modId]);

  const loadLiveInfo = async () => {
    try {
      setLiveError(null);

      // 并行查询：Modrinth 直接请求（CORS 友好），CurseForge 通过后端代理访问（更可靠且避免前端暴露 API key）
      const mrPromise = fetch(
        `https://api.modrinth.com/v2/project/${encodeURIComponent(modId)}`,
        { headers: { 'User-Agent': 'RTLauncher', 'x-modrinth-api-version': 'v2' } }
      )
        .then(async (r) => {
          if (!r.ok) {
            const text = await r.text().catch(() => '');
            return { ok: false as const, data: null, error: `HTTP ${r.status} ${text}` };
          }
          try {
            return { ok: true as const, data: await r.json(), error: undefined };
          } catch (err) {
            return { ok: false as const, data: null, error: `JSON parse: ${String(err)}` };
          }
        })
        .catch((err) => ({ ok: false as const, data: null, error: String(err) }));

      // CurseForge 通过后端代理搜索（slug 精确匹配）
      const cfPromise = invoke('search_curseforge_projects', {
        query: modId,
        category: 'mod',
        pageSize: 20,
      })
        .then((result) => {
          if (typeof result === 'string') {
            try {
              return { ok: true as const, data: JSON.parse(result), error: undefined };
            } catch (err) {
              return { ok: false as const, data: null, error: `JSON parse: ${String(err)}` };
            }
          }
          return { ok: true as const, data: result as any, error: undefined };
        })
        .catch((err) => ({ ok: false as const, data: null, error: String(err) }));

      const [mrResp, cfResp, mcmodData] = await Promise.all([
        mrPromise,
        cfPromise,
        invoke<string>("search_moddata", { keyword: modId }).then(result => {
          try {
            const parsed = JSON.parse(result) as { slug: string; chinese_name: string; mcmod_id?: number }[];
            return parsed.find(r => r.slug.toLowerCase() === modId.toLowerCase()) || null;
          } catch {
            return null;
          }
        }).catch(() => null)
      ]);

      const mrData = mrResp.ok ? mrResp.data : null;
      const cfDataRaw = cfResp.ok ? cfResp.data : null;

      let mrTitle = '';
      let mrDescription = '';
      let mrDownloads: number | undefined;
      let mrIconUrl: string | undefined;
      let mrAuthor: string | undefined;
      let mrUpdated: string | undefined;
      let mrCategories: string[] = [];
      let mrLoaders: string[] = [];
      let mrProjectType: string | undefined;
      let mrOk = false;

      if (mrData && typeof mrData === 'object') {
        mrOk = true;
        mrTitle = mrData.title || mrData.name || modId;
        mrDescription = mrData.description || '';
        mrDownloads = typeof mrData.downloads === 'number' ? mrData.downloads : undefined;
        mrIconUrl = mrData.icon_url || undefined;
        mrAuthor = mrData.team
          ? undefined
          : mrData.author || undefined;
        mrUpdated = mrData.updated || mrData.date_modified || mrData.published || undefined;
        mrCategories = Array.isArray(mrData.categories) ? mrData.categories : [];
        mrLoaders = Array.isArray(mrData.loaders) ? mrData.loaders : [];
        mrProjectType = mrData.project_type || 'mod';

        // Modrinth 把 datapack / world 的 project_type 也标记为 "mod"。
        // 需要通过 loaders / categories 进一步判断类型。
        const loadersLower = mrLoaders.map((l) => (l || '').toLowerCase());
        const categoriesLower = mrCategories.map((c) => (c || '').toLowerCase());

        if (
          loadersLower.includes('datapack') ||
          categoriesLower.includes('datapack') ||
          categoriesLower.includes('data pack') ||
          categoriesLower.includes('data-pack')
        ) {
          mrProjectType = 'datapack';
        } else if (
          loadersLower.includes('minecraft') ||
          categoriesLower.includes('world') ||
          categoriesLower.includes('map')
        ) {
          // 存档/地图类型（通过 categories 中的 "world", "map" 标签判断）
          mrProjectType = 'world';
        } else if (
          categoriesLower.includes('modpack') ||
          categoriesLower.includes('mod pack') ||
          categoriesLower.includes('modpacks')
        ) {
          // 整合包（通过 categories 中的 "modpack" 标签判断）
          mrProjectType = 'modpack';
        }
      }

      let cfTitle = '';
      let cfDescription = '';
      let cfDownloads: number | undefined;
      let cfIconUrl: string | undefined;
      let cfAuthor: string | undefined;
      let cfUpdated: string | undefined;
      let cfOk = false;
      let cfId: number | undefined;
      let cfClassId: number | undefined;

      if (
        cfDataRaw &&
        typeof cfDataRaw === 'object' &&
        Array.isArray(cfDataRaw.data) &&
        cfDataRaw.data.length > 0
      ) {
        cfOk = true;
        const exact =
          cfDataRaw.data.find(
            (d: any) => (d.slug || '').toLowerCase() === modId.toLowerCase()
          ) || cfDataRaw.data[0];
        cfTitle = exact.name || '';
        cfDescription = exact.summary || '';
        cfDownloads = typeof exact.downloadCount === 'number' ? exact.downloadCount : undefined;
        cfIconUrl = exact.logo?.thumbnailUrl || exact.logo?.url || undefined;
        cfAuthor = exact.authors?.[0]?.name || undefined;
        cfUpdated = exact.dateModified || exact.dateReleased || undefined;
        cfId = typeof exact.id === 'number' ? exact.id : undefined;
        cfClassId = typeof exact.classId === 'number' ? exact.classId : undefined;
      }

      const title = mrTitle || cfTitle || modId;
      const description = mrDescription || cfDescription || '';
      const downloads = mrDownloads ?? cfDownloads;
      const iconUrl = mrIconUrl || cfIconUrl;
      const author = mrAuthor || cfAuthor;
      const updated = mrUpdated || cfUpdated;
      const categories = mrCategories.length > 0 ? mrCategories : [];
      // 项目类型选择逻辑：
      // 1. 如果 Modrinth 的 project_type 不是 "mod"（明确是 resourcepack/shader/modpack），优先使用它
      // 2. 否则如果 CurseForge 有 classId，使用 classId 推断的类型
      // 3. 否则使用 Modrinth 的 project_type
      // 4. 最后 fallback 到 "mod"
      // 这样做的原因：Modrinth 把 datapack/world 的 project_type 也标记为 "mod"，
      // 需要通过 CurseForge 的 classId 或 loaders/categories 来进一步识别
      let projectType: string = 'mod';
      const cfProjectType = cfClassId ? classIdToProjectType(cfClassId) : undefined;
      if (mrProjectType && mrProjectType !== 'mod') {
        projectType = mrProjectType;
      } else if (cfProjectType) {
        projectType = cfProjectType;
      } else if (mrProjectType) {
        projectType = mrProjectType;
      }

      const source: 'modrinth' | 'curseforge' | 'both' =
        mrOk && cfOk ? 'both' : mrOk ? 'modrinth' : cfOk ? 'curseforge' : 'both';

      const modrinthUrl = mrOk ? `https://modrinth.com/${projectType}/${modId}` : undefined;
      // 根据 projectType 推断正确的 CurseForge URL 路径
      const cfPath = (() => {
        const pt = projectType.toLowerCase();
        if (pt.includes("modpack")) return "modpacks";
        if (pt.includes("resourcepack") || pt.includes("texture")) return "texture-packs";
        if (pt.includes("shader")) return "shaders";
        if (pt.includes("datapack")) return "data-packs";
        if (pt.includes("world")) return "worlds";
        return "mc-mods";
      })();
      const curseforgeUrl = cfOk
        ? `https://www.curseforge.com/minecraft/${cfPath}/${modId}`
        : undefined;

      const mcmodUrl = mcmodData?.mcmod_id ? `https://www.mcmod.cn/class/${mcmodData.mcmod_id}.html` : undefined;

      setLiveInfo({
        slug: modId,
        title,
        description,
        iconUrl,
        projectType,
        downloads,
        categories,
        updated,
        author,
        source,
        sources: {
          modrinth: {
            ok: mrOk,
            url: modrinthUrl,
            error: mrResp.ok ? undefined : (mrResp as any).error,
          },
          curseforge: {
            ok: cfOk,
            url: curseforgeUrl,
            error: cfResp.ok ? undefined : (cfResp as any).error,
          },
        },
        modrinthUrl,
        curseforgeUrl,
        mcmodUrl,
        classId: cfId,
      });

      // 两个外部来源都失败时，在 UI 上提示一次，而不是掩盖
      if (!mrOk && !cfOk && !liveError) {
        const errMsg = [
          mrResp.ok ? undefined : (mrResp as any).error,
          cfResp.ok ? undefined : (cfResp as any).error,
        ].filter(Boolean).join(' | ') || '未能从 Modrinth / CurseForge 获取项目信息';
        setLiveError(errMsg);
      }
    } catch (err) {
      console.error('获取项目在线信息失败:', err);
      setLiveError(String(err));
      // 失败后至少保留基本 URL 信息
      setLiveInfo({
        slug: modId,
        title: modId,
        source: 'both',
        sources: {
          modrinth: { ok: true, url: `https://modrinth.com/mod/${modId}` },
          curseforge: { ok: true, url: `https://www.curseforge.com/minecraft/mc-mods/${modId}` },
        },
        modrinthUrl: `https://modrinth.com/mod/${modId}`,
        curseforgeUrl: `https://www.curseforge.com/minecraft/mc-mods/${modId}`,
      });
    }
  };

  const loadModData = async () => {
    setLoading(true);

    const infoPromise = loadLiveInfo();

    const filesPromise = (async () => {
      try {
        setLoadingFiles(true);
        setFilesError(null);

        const cfPromise = invoke<string>("get_mod_files_by_slug", { slug: modId })
          .then((r) => ({ ok: true as const, source: "CurseForge", data: r }))
          .catch((e) => ({ ok: false as const, source: "CurseForge", error: String(e) }));
        const mrPromise = invoke<string>("get_modrinth_mod_files", { slug: modId })
          .then((r) => ({ ok: true as const, source: "Modrinth", data: r }))
          .catch((e) => ({ ok: false as const, source: "Modrinth", error: String(e) }));

        const [cfResult, mrResult] = await Promise.all([cfPromise, mrPromise]);

        let merged: ModFiles = {};
        let firstNonEmpty: string | null = null;

        // 从 URL 中提取文件名（去除查询参数和路径）
        const extractFilename = (url: string): string => {
          try {
            const withoutQuery = url.split('?')[0];
            const parts = withoutQuery.split('/');
            return decodeURIComponent(parts[parts.length - 1] || url);
          } catch {
            return url;
          }
        };

        // 生成文件的指纹（用于跨平台去重）
        // 优先级：文件名 > 版本号+loader组合
        const getFileFingerprint = (tags: string[], url: string): string => {
          const filename = extractFilename(url);
          if (filename && filename.length > 3) {
            // 使用小写文件名作为指纹（忽略扩展名差异，如 .jar vs .zip 也应去重）
            const lower = filename.toLowerCase();
            // 去除扩展名
            const withoutExt = lower.replace(/\.(jar|zip|mrpack|rar|7z)$/i, '');
            return `fn:${withoutExt}`;
          }
          // fallback：用 tags 的前几项组合
          const sigParts = tags.slice(0, 3).join('|').toLowerCase();
          return `tg:${sigParts}`;
        };

        for (const result of [cfResult, mrResult]) {
          if (!result.ok) continue;
          try {
            const parsed = JSON.parse(result.data) as ModFiles;
            if (!parsed || Object.keys(parsed).length === 0) continue;
            if (firstNonEmpty === null) firstNonEmpty = result.source;
            for (const [mcVersion, files] of Object.entries(parsed)) {
              if (!merged[mcVersion]) {
                merged[mcVersion] = [];
              }
              // 已存在文件的指纹集合
              const existingFingerprints = new Set(
                merged[mcVersion].map(([t, u]) => getFileFingerprint(t, u))
              );
              // 已存在 URL 集合（兜底）
              const existingUrls = new Set(merged[mcVersion].map(([, url]) => url));

              for (const f of files) {
                const fp = getFileFingerprint(f[0], f[1]);
                if (existingFingerprints.has(fp)) continue;
                if (existingUrls.has(f[1])) continue;
                merged[mcVersion].push(f);
                existingFingerprints.add(fp);
                existingUrls.add(f[1]);
              }
            }
          } catch (err) {
            console.warn("解析 " + result.source + " 文件数据失败", err);
          }
        }

        if (Object.keys(merged).length > 0) {
          setModFiles(merged);
          setDataSource(firstNonEmpty || "CurseForge");
          const firstKey = Object.keys(merged)[0];
          if (firstKey) {
            setExpandedVersions(new Set([firstKey]));
          }
        } else {
          throw new Error("所有数据来源均未返回有效文件");
        }
      } catch (error) {
        console.error("获取模组文件失败:", error);
        setFilesError(String(error));
      } finally {
        setLoadingFiles(false);
      }
    })();

    await Promise.all([infoPromise, filesPromise]);

    setLoading(false);
  };

  const toggleVersion = (mcVersion: string) => {
    setExpandedVersions(prev => {
      const next = new Set(prev);
      if (next.has(mcVersion)) {
        next.delete(mcVersion);
      } else {
        next.add(mcVersion);
      }
      return next;
    });
  };

  const handleDownload = async (file: ParsedFile, mcVersion: string) => {
    const status = getDownloadStatus(file.url);
    if (status === "downloading") return;
    if (status === "success") return;

    const modName = liveInfo?.title || liveInfo?.slug || modId;
    const modSlug = liveInfo?.slug || modId;

    // 从文件信息推断 mod loader（统一按 tags 解析，不看文件后缀）
    // 优先级：1. UI 小标题 loaderLabel（如 "Ornithe"、"NeoForge"）
    //        2. 退回到 hasXxx 标记推断
    let modLoader = "通用";
    if (file.loaderLabel && file.loaderLabel !== "通用") {
      modLoader = file.loaderLabel;
    } else {
      if (file.hasNeoForge) modLoader = "neoforge";
      else if (file.hasFabric) modLoader = "fabric";
      else if (file.hasQuilt) modLoader = "quilt";
      else if (file.hasLiteLoader) modLoader = "liteloader";
      else if (file.hasOrnithe) modLoader = "ornithe";
      else if (file.hasForge) modLoader = "forge";
    }

    // 根据项目类型确定资源 kind（影响缓存目录）
    // - mod / minecraft mod -> "mod"
    // - resourcepack / texture pack -> "resourcepack"
    // - shader -> "shaderpack"
    // - datapack -> "datapack"
    // - world / map -> "world"
    // - modpack / mod pack -> "modpack"
    const projectType = (liveInfo?.projectType || "mod").toLowerCase();
    let resourceKind = "mod";
    if (projectType.includes("resourcepack") || projectType.includes("resource pack") || projectType.includes("texture pack")) {
      resourceKind = "resourcepack";
    } else if (projectType.includes("shader")) {
      resourceKind = "shaderpack";
    } else if (projectType.includes("datapack") || projectType.includes("data pack")) {
      resourceKind = "datapack";
    } else if (projectType.includes("modpack") || projectType.includes("mod pack")) {
      resourceKind = "modpack";
    } else if (projectType.includes("world") || projectType.includes("map")) {
      resourceKind = "world";
    }

    try {
      // 先占位下载中状态（在 taskId 返回之前显示加载）
      setDownloadingUrlToTaskId(prev => {
        const next = new Map(prev);
        if (!next.has(file.url)) {
          next.set(file.url, -1);  // -1 表示正在等待后端返回 taskId
        }
        return next;
      });

      const taskId = await startResourceDownload(
        resourceKind,
        modSlug,
        modName,
        mcVersion,
        modLoader,
        file.url
      );

      // 更新为真实的 taskId
      setDownloadingUrlToTaskId(prev => {
        const next = new Map(prev);
        next.set(file.url, taskId);
        return next;
      });
    } catch (err) {
      console.error("下载失败:", err);
      setDownloadingUrlToTaskId(prev => {
        const next = new Map(prev);
        next.delete(file.url);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-8 animate-spin" />
        <p className="text-sm">正在加载项目信息...</p>
      </div>
    );
  }

  const displayTitle = liveInfo?.title || modId;
  const displaySlug = liveInfo?.slug || modId;
  const totalFiles = parsedFiles.size;
  const totalVersions = Array.from(parsedFiles.values()).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="flex h-full flex-col p-4">
      <Button variant="ghost" size="sm" className="w-fit mb-4" onClick={() => router.push("/download")}>
        <ArrowLeft className="mr-2 size-4" />
        返回搜索
      </Button>

      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex gap-5 items-start flex-col md:flex-row">
            <div className={"shrink-0 w-20 h-20 " + (liveInfo?.iconUrl ? "" : "bg-gradient-to-br from-primary/20 to-primary/5") + " rounded-xl flex items-center justify-center border border-border overflow-hidden"}>
              {liveInfo?.iconUrl ? (
                <img
                  src={liveInfo.iconUrl}
                  alt=""
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (target.parentElement) {
                      target.style.display = 'none';
                    }
                  }}
                />
              ) : (
                <Package className="size-8 text-primary" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">{displayTitle}</h1>
              <div className="flex flex-wrap gap-2 mt-2 items-center">
                <Badge variant="secondary" className="text-xs font-mono">
                  {displaySlug}
                </Badge>

                {liveInfo?.source === 'both' && (
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                    Modrinth + CurseForge
                  </Badge>
                )}
                {liveInfo?.source === 'modrinth' && (
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                    Modrinth
                  </Badge>
                )}
                {liveInfo?.source === 'curseforge' && (
                  <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30">
                    CurseForge
                  </Badge>
                )}

                {dataSource && (
                  <Badge variant="outline" className="text-xs">
                    文件来自 {dataSource}
                  </Badge>
                )}

                <Badge variant="outline" className="text-xs">
                  {totalFiles} MC 版本 · {totalVersions} 文件
                </Badge>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-3">
                {liveInfo?.downloads != null && (
                  <span>⬇ 总下载 {formatDownloads(liveInfo.downloads)}</span>
                )}
                {liveInfo?.author && (
                  <span>作者: <span className="text-foreground font-medium">{liveInfo.author}</span></span>
                )}
                {liveInfo?.updated && (
                  <span>更新于 {formatDateShort(liveInfo.updated)}</span>
                )}
                {liveInfo?.projectType && (
                  <span>类型: {translateProjectType(liveInfo.projectType)}</span>
                )}
              </div>

              {liveInfo?.description && (
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                  {liveInfo.description}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-4">
                {liveInfo?.modrinthUrl && (
                  <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.modrinthUrl!)}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    在 Modrinth 上查看
                  </Button>
                )}
                {liveInfo?.curseforgeUrl && (
                  <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.curseforgeUrl!)}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    在 CurseForge 上查看
                  </Button>
                )}
                {liveInfo?.mcmodUrl && (
                  <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.mcmodUrl!)}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    在 MC百科 上查看
                  </Button>
                )}
                {liveError && (
                  <span className="text-[11px] text-destructive">在线信息加载失败: {liveError}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {modFiles && totalVersions > 0 ? (
          <div className="flex-1 min-h-0 space-y-2">
            {loadingFiles && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground py-4">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm">正在获取文件列表...</span>
              </div>
            )}

            {Array.from(parsedFiles.entries()).map(([mcVersion, files]) => {
              const isExpanded = expandedVersions.has(mcVersion);
              const releaseCount = files.filter(f => f.isRelease).length;
              const nonReleaseCount = files.length - releaseCount;

              return (
                <div key={mcVersion} className="rounded-xl border border-border bg-card overflow-hidden">
                  <button onClick={() => toggleVersion(mcVersion)} className="w-full flex items-center justify-between p-4 hover:bg-accent/40 transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <div className={"transition-transform duration-300 " + (isExpanded ? "rotate-180" : "")}>
                        <ChevronDown className="size-5 text-muted-foreground" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold text-base">MC {mcVersion}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {files.length} 个文件
                          {releaseCount > 0 && (<span className="ml-2">· {releaseCount} 个正式版</span>)}
                          {nonReleaseCount > 0 && (<span className="ml-2">· {nonReleaseCount} 个测试版</span>)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {releaseCount > 0 && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                          <Shield className="size-5" />
                        </span>
                      )}
                      {nonReleaseCount > 0 && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                          <FlaskConical className="size-5" />
                        </span>
                      )}
                    </div>
                  </button>

                  <div className={"grid transition-all duration-300 ease-out " + (isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="overflow-hidden">
                      <div className="border-t border-border divide-y divide-border/60 bg-muted/10">
                        {files.map((file, index) => {
                          const status = getDownloadStatus(file.url);
                          return (
                            <div key={index} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors">
                              <div className="flex items-center gap-2 shrink-0 w-16 justify-center">
                                {file.isRelease ? (
                                  <Shield className="size-7 text-emerald-500" aria-label="正式版" />
                                ) : (
                                  <FlaskConical className="size-7 text-amber-500" aria-label="测试版" />
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate">
                                  {file.versionLabel}
                                  {file.loaderLabel === "通用" && (
                                    <span className="text-muted-foreground/70 ml-1" aria-label="加载器未识别">:</span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  <Badge variant={file.isRelease ? "secondary" : "outline"} className="text-[10px] h-4">{file.loaderLabel}</Badge>
                                  <Badge variant={file.isRelease ? "default" : "outline"} className={"text-[10px] h-4 " + (file.isRelease ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "text-amber-600 dark:text-amber-400 border-amber-500/30")}>{file.isRelease ? "正式版" : "测试版"}</Badge>
                                  {file.serverLabel && (
                                    <Badge variant="outline" className="text-[10px] h-4 text-sky-600 dark:text-sky-400 border-sky-500/30">{file.serverLabel}</Badge>
                                  )}
                                  {file.cleanTags.slice(0, 2).map((tag, i) => (
                                    <span key={i} className="text-[10px] text-muted-foreground">{tag}</span>
                                  ))}
                                </div>
                              </div>

                              <Button size="sm" variant={status === "success" ? "secondary" : status === "error" ? "destructive" : "default"} disabled={status === "downloading" || status === "success"} onClick={() => handleDownload(file, mcVersion)} className="shrink-0">
                                {status === "downloading" && (<><Loader2 className="mr-1.5 size-3.5 animate-spin" /> 下载中</>)}
                                {status === "success" && (<><CheckCircle2 className="mr-1.5 size-3.5" /> 已下载</>)}
                                {status === "error" && (<><XCircle className="mr-1.5 size-3.5" /> 重试</>)}
                                {status === "idle" && (<><Download className="mr-1.5 size-3.5" /> 下载</>)}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground rounded-xl border border-dashed border-border bg-card/50 p-8">
            {filesError ? (
              <>
                <div className="size-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <span className="text-destructive text-lg">!</span>
                </div>
                <p className="text-sm font-medium text-foreground">无法连接到数据源</p>
                <p className="text-xs text-muted-foreground text-center max-w-sm leading-relaxed">
                  获取文件列表时发生网络错误。海外数据源访问时可能出现连接中断、超时等问题。
                </p>
                <div className="mt-2 max-w-md w-full p-3 rounded-lg bg-muted/50 text-xs font-mono break-all text-muted-foreground">{filesError}</div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button variant="default" size="sm" onClick={loadModData}>重试</Button>
                  {liveInfo?.modrinthUrl && (
                    <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.modrinthUrl!)}>
                      <ExternalLink className="mr-1.5 size-3.5" />
                      在 Modrinth 上查看
                    </Button>
                  )}
                  {liveInfo?.curseforgeUrl && (
                    <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.curseforgeUrl!)}>
                      <ExternalLink className="mr-1.5 size-3.5" />
                      在 CurseForge 上查看
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <Package className="size-10 opacity-40" />
                <p className="text-sm">暂无可用的模组文件</p>
                <p className="text-xs text-muted-foreground">请检查模组slug是否正确，或稍后重试</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={loadModData}>重新加载</Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
=======
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { ArrowLeft, ChevronDown, Shield, FlaskConical, Loader2, Download, CheckCircle2, XCircle, Package, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { invoke } from "@tauri-apps/api/core";
import { useDownloadManager } from "@/components/download/download-provider";
import { useRouter } from "next/navigation";

const openExternalUrl = async (url: string) => {
  try {
    await invoke("open_external", { url });
  } catch (err) {
    console.error("Failed to open URL:", err);
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
};

interface ModFiles {
  [mcVersion: string]: Array<[string[], string]>;
}

interface LiveModDetail {
  slug: string;
  title: string;
  description?: string;
  body?: string;
  iconUrl?: string;
  projectType?: string;
  downloads?: number;
  categories?: string[];
  gameVersions?: string[];
  latestVersions?: string[];
  updated?: string;
  author?: string;
  source: 'modrinth' | 'curseforge' | 'both';
  sources: {
    modrinth: { ok: boolean; url?: string; error?: string };
    curseforge: { ok: boolean; url?: string; error?: string };
  };
  modrinthUrl?: string;
  curseforgeUrl?: string;
  mcmodUrl?: string;
  classId?: number;
}

interface ParsedFile {
  tags: string[];
  cleanTags: string[];
  url: string;
  isRelease: boolean;
  hasForge: boolean;
  hasFabric: boolean;
  hasNeoForge: boolean;
  hasQuilt: boolean;
  hasLiteLoader: boolean;
  hasOrnithe: boolean;
  loaderLabel: string;
  versionLabel: string;
  serverLabel: string;
}

function decodeUriSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** CurseForge classId -> 项目类型（用于推断非 Modrinth 项目的类型） */
function classIdToProjectType(classId: number): string {
  switch (classId) {
    case 6: return "mod";
    case 12: return "resourcepack";
    case 6552: return "shader";
    case 6945: return "datapack";
    case 6949: return "datapack";
    case 17: return "world";
    case 4471: return "modpack";
    case 4473: return "modpack";
    default: return "mod";
  }
}

function cleanFileName(name: string): string {
  if (!name) return name;
  let s = name;
  s = decodeUriSafe(s);
  s = s.replace(/\+/g, " ");
  s = s.replace(/_{2,}/g, " ").replace(/\.{2,}/g, ".");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

function formatDownloads(n?: number): string {
  if (n === undefined || n === null) return "";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function translateProjectType(pt?: string): string {
  if (!pt) return "未知";
  const lower = pt.toLowerCase();
  const map: Record<string, string> = {
    mod: "模组",
    "minecraft mod": "模组",
    modpack: "整合包",
    "mod pack": "整合包",
    resourcepack: "资源包",
    "resource pack": "资源包",
    "texture pack": "资源包",
    shader: "光影",
    shaders: "光影",
    "shader pack": "光影",
    datapack: "数据包",
    "data pack": "数据包",
    world: "地图",
    worlds: "地图",
  };
  return map[lower] ?? pt;
}

function translateCategory(cat: string): string {
  const map: Record<string, string> = {
    "forge": "Forge",
    "fabric": "Fabric",
    "neoforge": "NeoForge",
    "quilt": "Quilt",
    "vanilla": "原版",
    "utility": "工具",
    "storage": "存储",
    "decoration": "装饰",
    "library": "前置",
    "library / api": "前置 API",
    "api and library": "前置 API",
    "magic": "魔法",
    "technology": "科技",
    "tech": "科技",
    "adventure": "冒险",
    "adventure and rpg": "冒险 RPG",
    "rpg": "RPG",
    "world gen": "世界生成",
    "world generation": "世界生成",
    "dungeons and dimensions": "地牢与维度",
    "dungeons": "地牢",
    "dimensions": "维度",
    "entities": "实体",
    "mobs": "怪物",
    "food": "食物",
    "farming": "农业",
    "energy": "能源",
    "redstone": "红石",
    "automation": "自动化",
    "transport": "交通",
    "buildcraft": "建筑",
    "combat": "战斗",
    "armor, tools, and weapons": "装备与工具",
    "armor, tools & weapons": "装备与工具",
    "performance": "性能",
    "optimization": "优化",
    "qol": "品质生活",
    "quality of life": "品质生活",
    "information": "信息",
    "tweaks": "微调",
    "cosmetic": "美化",
    "environmental": "环境",
    "biomes": "群系",
    "structures": "结构",
    "miscellaneous": "杂项",
    "misc": "杂项",
  };
  const lower = cat.toLowerCase();
  return map[lower] ?? cat;
}

function formatDateShort(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = Date.now();
    const diffMs = now - d.getTime();
    const day = 24 * 60 * 60 * 1000;
    if (diffMs < day) return "今日";
    if (diffMs < 7 * day) return Math.round(diffMs / day) + " 天前";
    if (diffMs < 30 * day) return Math.round(diffMs / (7 * day)) + " 周前";
    if (diffMs < 365 * day) return Math.round(diffMs / (30 * day)) + " 个月前";
    return Math.round(diffMs / (365 * day)) + " 年前";
  } catch {
    return "";
  }
}

function isReleaseVersion(tags: string[]): boolean {
  const releaseKeywords = ["正式版", "release", "Release", "RELEASE", "稳定版", "正式"];
  const betaKeywords = ["beta", "Beta", "测试", "alpha", "Alpha", "快照", "snapshot", "SNAPSHOT", "实验", "Experimental", "experimental", "dev", "DEV", "Dev"];

  for (const tag of tags) {
    const lowerTag = tag.toLowerCase();
    if (betaKeywords.some(k => lowerTag.includes(k.toLowerCase()))) {
      return false;
    }
  }
  for (const tag of tags) {
    const lowerTag = tag.toLowerCase();
    if (releaseKeywords.some(k => lowerTag.includes(k.toLowerCase()))) {
      return true;
    }
  }
  return true;
}

function extractLoaderInfo(tags: string[]) {
  let hasForge = false;
  let hasFabric = false;
  let hasNeoForge = false;
  let hasQuilt = false;
  let hasLiteLoader = false;
  let hasOrnithe = false;
  let loaderLabel = "";
  let isServer = false;
  let isClient = false;

  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower === "server" || lower === "server-1" || lower.includes("server")) {
      isServer = true;
    } else if (lower.includes("neoforge") || lower.includes("neo")) {
      hasNeoForge = true;
      if (!loaderLabel) loaderLabel = "NeoForge";
    } else if (lower.includes("forge") && !lower.includes("neo")) {
      hasForge = true;
      if (!loaderLabel) loaderLabel = "Forge";
    } else if (lower.includes("fabric")) {
      hasFabric = true;
      if (!loaderLabel) loaderLabel = "Fabric";
    } else if (lower.includes("quilt")) {
      hasQuilt = true;
      if (!loaderLabel) loaderLabel = "Quilt";
    } else if (lower.includes("liteloader") || lower.includes("lite") || lower.includes("litemod")) {
      hasLiteLoader = true;
      if (!loaderLabel) loaderLabel = "LiteLoader";
    } else if (lower.includes("ornithe")) {
      hasOrnithe = true;
      if (!loaderLabel) loaderLabel = "Ornithe";
    } else if (lower === "client") {
      isClient = true;
    }
  }

  if (!loaderLabel) loaderLabel = "通用";

  let serverLabel = "";
  if (isServer && isClient) {
    serverLabel = "服务端 + 客户端";
  } else if (isServer) {
    serverLabel = "服务端";
  } else if (isClient) {
    serverLabel = "客户端";
  }

  return { hasForge, hasFabric, hasNeoForge, hasQuilt, hasLiteLoader, hasOrnithe, loaderLabel, serverLabel };
}

function extractVersionLabel(url: string, tags: string[]): string {
  // 排除纯 MC 版本号格式：如 1.21, 1.21.1, 1.20.4 等
  const isMcVersion = (s: string): boolean => {
    const trimmed = s.trim();
    // 纯数字点分格式：1.x 或 1.x.x
    return /^\d+\.\d+(\.\d+)?$/.test(trimmed);
  };

  // 1) 优先从 tags 找真正的模组版本号（不是纯 MC 版本号，且带版本特征）
  for (const tag of tags) {
    const clean = cleanFileName(tag);
    if (!clean || clean.length > 40) continue;
    // 接受：v1.2.3 / 2.0.1+mc1.21 / 模组名-1.2.3 等
    // 拒绝：纯 MC 版本号（如 1.21, 1.20.4）
    if (/v?\d+\.\d+/.test(clean) && !isMcVersion(clean)) {
      return clean;
    }
  }

  // 2) 从 URL 文件名提取
  try {
    const parts = url.split("/");
    const fileName = parts[parts.length - 1].split("?")[0];
    if (fileName.length > 0) {
      const simpleName = cleanFileName(fileName).replace(/\.[^.]+$/, "");
      if (simpleName.length > 0) {
        return simpleName.length > 60 ? simpleName.substring(0, 57) + "..." : simpleName;
      }
    }
  } catch {
    // ignore
  }

  // 3) 最后兜底：从 tags 里找第一个非纯 MC 版本的数字标签
  for (const tag of tags) {
    const clean = cleanFileName(tag);
    if (!clean) continue;
    if (!isMcVersion(clean) && clean.length < 40) {
      return clean;
    }
  }

  return "未知版本";
}

function cleanTags(tags: string[], mcVersion: string, loaderLabel: string, serverLabel: string): string[] {
  const skip = new Set<string>();
  skip.add(mcVersion.toLowerCase());
  skip.add("java");
  const loaders = ["forge", "fabric", "neoforge", "neo", "quilt", loaderLabel.toLowerCase()];
  for (const l of loaders) skip.add(l);
  const releases = ["release", "beta", "alpha", "snapshot", "正式版", "测试版", "正式", "稳定版", "实验", "实验性"];
  for (const r of releases) skip.add(r);
  skip.add("server");
  skip.add("client");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = cleanFileName(raw);
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    if (!t || t.length === 0) continue;
    if (skip.has(lower)) continue;
    if (lower.startsWith("java") || /^java\s*\d+/i.test(t)) continue;
    if (/^\d+\.\d+(\.\d+)?$/.test(t.trim())) continue;
    if (t.length > 40) continue;
    result.push(t);
    seen.add(lower);
  }
  return result;
}

export default function ModDetailContent({ modId }: { modId: string }) {
  const router = useRouter();
  const [liveInfo, setLiveInfo] = useState<LiveModDetail | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [modFiles, setModFiles] = useState<ModFiles | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [downloadingUrlToTaskId, setDownloadingUrlToTaskId] = useState<Map<string, number>>(new Map());
  const [filesError, setFilesError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const { startModDownload, startResourceDownload, tasks } = useDownloadManager();

  // 根据 URL 获取下载状态（用 taskId 精确匹配）
  const getDownloadStatus = (url: string) => {
    const taskId = downloadingUrlToTaskId.get(url);
    if (taskId !== undefined) {
      if (taskId === -1) {
        // 正在等待后端返回 taskId，显示"下载中"
        return "downloading";
      }
      const task = tasks.find(t => t.taskId === taskId);
      if (task) {
        if (task.status === "success" || task.status === "warning") return "success";
        if (task.status === "error") return "error";
        if (task.status === "downloading" || task.status === "queued") return "downloading";
        if (task.status === "cancelled") return "idle";
      } else {
        // task 可能已被清除（clearFinished / removeTask），视为已完成
        return "success";
      }
    }
    // 降级：通过 label 模糊匹配
    const fallbackTask = tasks.find(t => {
      return t.label.includes(modId) || t.label.includes(liveInfo?.slug || modId);
    });
    if (fallbackTask?.status === "success" || fallbackTask?.status === "warning") return "success";
    return "idle";
  };

  const parsedFiles = useMemo(() => {
    if (!modFiles) return new Map<string, ParsedFile[]>();

    const result = new Map<string, ParsedFile[]>();
    for (const [mcVersion, files] of Object.entries(modFiles)) {
      const parsed: ParsedFile[] = files.map(([tags, url]) => {
        const isRelease = isReleaseVersion(tags);
        const loaderInfo = extractLoaderInfo(tags);
        const versionLabel = extractVersionLabel(url, tags);
        const clean = cleanTags(tags, mcVersion, loaderInfo.loaderLabel, loaderInfo.serverLabel);
        return {
          tags,
          cleanTags: clean,
          url,
          isRelease,
          ...loaderInfo,
          versionLabel,
        };
      });
      parsed.sort((a, b) => {
        if (a.isRelease !== b.isRelease) return a.isRelease ? -1 : 1;
        return 0;
      });
      result.set(mcVersion, parsed);
    }
    return result;
  }, [modFiles]);

  useEffect(() => {
    loadModData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modId]);

  const loadLiveInfo = async () => {
    try {
      setLiveError(null);

      // 并行查询 Modrinth 和 CurseForge 以获取项目完整信息
      const mrPromise = fetch(
        `https://api.modrinth.com/v2/project/${encodeURIComponent(modId)}`,
        { headers: { 'User-Agent': 'RTLauncher', 'x-modrinth-api-version': 'v2' } }
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      const cfUrl = `https://api.curseforge.com/v1/mods/search?slug=${encodeURIComponent(modId)}&gameId=432`;
      const cfPromise = fetch(cfUrl, {
        headers: {
          'x-api-key': '$2a$10$VTAFCxje5a1Jkqv0aGWjQ.fULedAEPctDqppOkNMRVv.edVnG7KQ6',
          Accept: 'application/json',
          'User-Agent': 'RTLauncher',
        },
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      const [mrData, cfData, mcmodData] = await Promise.all([
        mrPromise,
        cfPromise,
        invoke<string>("search_moddata", { keyword: modId }).then(result => {
          try {
            const parsed = JSON.parse(result) as { slug: string; chinese_name: string; mcmod_id?: number }[];
            return parsed.find(r => r.slug.toLowerCase() === modId.toLowerCase()) || null;
          } catch {
            return null;
          }
        }).catch(() => null)
      ]);

      let mrTitle = '';
      let mrDescription = '';
      let mrDownloads: number | undefined;
      let mrIconUrl: string | undefined;
      let mrAuthor: string | undefined;
      let mrUpdated: string | undefined;
      let mrCategories: string[] = [];
      let mrLoaders: string[] = [];
      let mrProjectType: string | undefined;
      let mrOk = false;

      if (mrData && typeof mrData === 'object') {
        mrOk = true;
        mrTitle = mrData.title || mrData.name || modId;
        mrDescription = mrData.description || '';
        mrDownloads = typeof mrData.downloads === 'number' ? mrData.downloads : undefined;
        mrIconUrl = mrData.icon_url || undefined;
        mrAuthor = mrData.team
          ? undefined
          : mrData.author || undefined;
        mrUpdated = mrData.updated || mrData.date_modified || mrData.published || undefined;
        mrCategories = Array.isArray(mrData.categories) ? mrData.categories : [];
        mrLoaders = Array.isArray(mrData.loaders) ? mrData.loaders : [];
        mrProjectType = mrData.project_type || 'mod';

        // Modrinth 把 datapack / world 的 project_type 也标记为 "mod"。
        // 需要通过 loaders / categories 进一步判断类型。
        const loadersLower = mrLoaders.map((l) => (l || '').toLowerCase());
        const categoriesLower = mrCategories.map((c) => (c || '').toLowerCase());

        if (
          loadersLower.includes('datapack') ||
          categoriesLower.includes('datapack') ||
          categoriesLower.includes('data pack') ||
          categoriesLower.includes('data-pack')
        ) {
          mrProjectType = 'datapack';
        } else if (
          loadersLower.includes('minecraft') ||
          categoriesLower.includes('world') ||
          categoriesLower.includes('map')
        ) {
          // 存档/地图类型（通过 categories 中的 "world", "map" 标签判断）
          mrProjectType = 'world';
        } else if (
          categoriesLower.includes('modpack') ||
          categoriesLower.includes('mod pack') ||
          categoriesLower.includes('modpacks')
        ) {
          // 整合包（通过 categories 中的 "modpack" 标签判断）
          mrProjectType = 'modpack';
        }
      }

      let cfTitle = '';
      let cfDescription = '';
      let cfDownloads: number | undefined;
      let cfIconUrl: string | undefined;
      let cfAuthor: string | undefined;
      let cfUpdated: string | undefined;
      let cfOk = false;
      let cfId: number | undefined;
      let cfClassId: number | undefined;

      if (
        cfData &&
        typeof cfData === 'object' &&
        Array.isArray(cfData.data) &&
        cfData.data.length > 0
      ) {
        cfOk = true;
        const exact =
          cfData.data.find(
            (d: any) => (d.slug || '').toLowerCase() === modId.toLowerCase()
          ) || cfData.data[0];
        cfTitle = exact.name || '';
        cfDescription = exact.summary || '';
        cfDownloads = typeof exact.downloadCount === 'number' ? exact.downloadCount : undefined;
        cfIconUrl = exact.logo?.thumbnailUrl || exact.logo?.url || undefined;
        cfAuthor = exact.authors?.[0]?.name || undefined;
        cfUpdated = exact.dateModified || exact.dateReleased || undefined;
        cfId = typeof exact.id === 'number' ? exact.id : undefined;
        cfClassId = typeof exact.classId === 'number' ? exact.classId : undefined;
      }

      const title = mrTitle || cfTitle || modId;
      const description = mrDescription || cfDescription || '';
      const downloads = mrDownloads ?? cfDownloads;
      const iconUrl = mrIconUrl || cfIconUrl;
      const author = mrAuthor || cfAuthor;
      const updated = mrUpdated || cfUpdated;
      const categories = mrCategories.length > 0 ? mrCategories : [];
      // 项目类型选择逻辑：
      // 1. 如果 Modrinth 的 project_type 不是 "mod"（明确是 resourcepack/shader/modpack），优先使用它
      // 2. 否则如果 CurseForge 有 classId，使用 classId 推断的类型
      // 3. 否则使用 Modrinth 的 project_type
      // 4. 最后 fallback 到 "mod"
      // 这样做的原因：Modrinth 把 datapack/world 的 project_type 也标记为 "mod"，
      // 需要通过 CurseForge 的 classId 或 loaders/categories 来进一步识别
      let projectType: string = 'mod';
      const cfProjectType = cfClassId ? classIdToProjectType(cfClassId) : undefined;
      if (mrProjectType && mrProjectType !== 'mod') {
        projectType = mrProjectType;
      } else if (cfProjectType) {
        projectType = cfProjectType;
      } else if (mrProjectType) {
        projectType = mrProjectType;
      }

      const source: 'modrinth' | 'curseforge' | 'both' =
        mrOk && cfOk ? 'both' : mrOk ? 'modrinth' : cfOk ? 'curseforge' : 'both';

      const modrinthUrl = mrOk ? `https://modrinth.com/${projectType}/${modId}` : undefined;
      // 根据 projectType 推断正确的 CurseForge URL 路径
      const cfPath = (() => {
        const pt = projectType.toLowerCase();
        if (pt.includes("modpack")) return "modpacks";
        if (pt.includes("resourcepack") || pt.includes("texture")) return "texture-packs";
        if (pt.includes("shader")) return "shaders";
        if (pt.includes("datapack")) return "data-packs";
        if (pt.includes("world")) return "worlds";
        return "mc-mods";
      })();
      const curseforgeUrl = cfOk
        ? `https://www.curseforge.com/minecraft/${cfPath}/${modId}`
        : undefined;

      const mcmodUrl = mcmodData?.mcmod_id ? `https://www.mcmod.cn/class/${mcmodData.mcmod_id}.html` : undefined;

      setLiveInfo({
        slug: modId,
        title,
        description,
        iconUrl,
        projectType,
        downloads,
        categories,
        updated,
        author,
        source,
        sources: {
          modrinth: { ok: mrOk, url: modrinthUrl },
          curseforge: { ok: cfOk, url: curseforgeUrl },
        },
        modrinthUrl,
        curseforgeUrl,
        mcmodUrl,
        classId: cfId,
      });
    } catch (err) {
      console.error('获取项目在线信息失败:', err);
      setLiveError(String(err));
      // 失败后至少保留基本 URL 信息
      setLiveInfo({
        slug: modId,
        title: modId,
        source: 'both',
        sources: {
          modrinth: { ok: true, url: `https://modrinth.com/mod/${modId}` },
          curseforge: { ok: true, url: `https://www.curseforge.com/minecraft/mc-mods/${modId}` },
        },
        modrinthUrl: `https://modrinth.com/mod/${modId}`,
        curseforgeUrl: `https://www.curseforge.com/minecraft/mc-mods/${modId}`,
      });
    }
  };

  const loadModData = async () => {
    setLoading(true);

    const infoPromise = loadLiveInfo();

    const filesPromise = (async () => {
      try {
        setLoadingFiles(true);
        setFilesError(null);

        const cfPromise = invoke<string>("get_mod_files_by_slug", { slug: modId })
          .then((r) => ({ ok: true as const, source: "CurseForge", data: r }))
          .catch((e) => ({ ok: false as const, source: "CurseForge", error: String(e) }));
        const mrPromise = invoke<string>("get_modrinth_mod_files", { slug: modId })
          .then((r) => ({ ok: true as const, source: "Modrinth", data: r }))
          .catch((e) => ({ ok: false as const, source: "Modrinth", error: String(e) }));

        const [cfResult, mrResult] = await Promise.all([cfPromise, mrPromise]);

        let merged: ModFiles = {};
        let firstNonEmpty: string | null = null;

        // 从 URL 中提取文件名（去除查询参数和路径）
        const extractFilename = (url: string): string => {
          try {
            const withoutQuery = url.split('?')[0];
            const parts = withoutQuery.split('/');
            return decodeURIComponent(parts[parts.length - 1] || url);
          } catch {
            return url;
          }
        };

        // 生成文件的指纹（用于跨平台去重）
        // 优先级：文件名 > 版本号+loader组合
        const getFileFingerprint = (tags: string[], url: string): string => {
          const filename = extractFilename(url);
          if (filename && filename.length > 3) {
            // 使用小写文件名作为指纹（忽略扩展名差异，如 .jar vs .zip 也应去重）
            const lower = filename.toLowerCase();
            // 去除扩展名
            const withoutExt = lower.replace(/\.(jar|zip|mrpack|rar|7z)$/i, '');
            return `fn:${withoutExt}`;
          }
          // fallback：用 tags 的前几项组合
          const sigParts = tags.slice(0, 3).join('|').toLowerCase();
          return `tg:${sigParts}`;
        };

        for (const result of [cfResult, mrResult]) {
          if (!result.ok) continue;
          try {
            const parsed = JSON.parse(result.data) as ModFiles;
            if (!parsed || Object.keys(parsed).length === 0) continue;
            if (firstNonEmpty === null) firstNonEmpty = result.source;
            for (const [mcVersion, files] of Object.entries(parsed)) {
              if (!merged[mcVersion]) {
                merged[mcVersion] = [];
              }
              // 已存在文件的指纹集合
              const existingFingerprints = new Set(
                merged[mcVersion].map(([t, u]) => getFileFingerprint(t, u))
              );
              // 已存在 URL 集合（兜底）
              const existingUrls = new Set(merged[mcVersion].map(([, url]) => url));

              for (const f of files) {
                const fp = getFileFingerprint(f[0], f[1]);
                if (existingFingerprints.has(fp)) continue;
                if (existingUrls.has(f[1])) continue;
                merged[mcVersion].push(f);
                existingFingerprints.add(fp);
                existingUrls.add(f[1]);
              }
            }
          } catch (err) {
            console.warn("解析 " + result.source + " 文件数据失败", err);
          }
        }

        if (Object.keys(merged).length > 0) {
          setModFiles(merged);
          setDataSource(firstNonEmpty || "CurseForge");
          const firstKey = Object.keys(merged)[0];
          if (firstKey) {
            setExpandedVersions(new Set([firstKey]));
          }
        } else {
          throw new Error("所有数据来源均未返回有效文件");
        }
      } catch (error) {
        console.error("获取模组文件失败:", error);
        setFilesError(String(error));
      } finally {
        setLoadingFiles(false);
      }
    })();

    await Promise.all([infoPromise, filesPromise]);

    setLoading(false);
  };

  const toggleVersion = (mcVersion: string) => {
    setExpandedVersions(prev => {
      const next = new Set(prev);
      if (next.has(mcVersion)) {
        next.delete(mcVersion);
      } else {
        next.add(mcVersion);
      }
      return next;
    });
  };

  const handleDownload = async (file: ParsedFile, mcVersion: string) => {
    const status = getDownloadStatus(file.url);
    if (status === "downloading") return;
    if (status === "success") return;

    const modName = liveInfo?.title || liveInfo?.slug || modId;
    const modSlug = liveInfo?.slug || modId;

    // 从文件信息推断 mod loader（统一按 tags 解析，不看文件后缀）
    // 优先级：1. UI 小标题 loaderLabel（如 "Ornithe"、"NeoForge"）
    //        2. 退回到 hasXxx 标记推断
    let modLoader = "通用";
    if (file.loaderLabel && file.loaderLabel !== "通用") {
      modLoader = file.loaderLabel;
    } else {
      if (file.hasNeoForge) modLoader = "neoforge";
      else if (file.hasFabric) modLoader = "fabric";
      else if (file.hasQuilt) modLoader = "quilt";
      else if (file.hasLiteLoader) modLoader = "liteloader";
      else if (file.hasOrnithe) modLoader = "ornithe";
      else if (file.hasForge) modLoader = "forge";
    }

    // 根据项目类型确定资源 kind（影响缓存目录）
    // - mod / minecraft mod -> "mod"
    // - resourcepack / texture pack -> "resourcepack"
    // - shader -> "shaderpack"
    // - datapack -> "datapack"
    // - world / map -> "world"
    // - modpack / mod pack -> "modpack"
    const projectType = (liveInfo?.projectType || "mod").toLowerCase();
    let resourceKind = "mod";
    if (projectType.includes("resourcepack") || projectType.includes("resource pack") || projectType.includes("texture pack")) {
      resourceKind = "resourcepack";
    } else if (projectType.includes("shader")) {
      resourceKind = "shaderpack";
    } else if (projectType.includes("datapack") || projectType.includes("data pack")) {
      resourceKind = "datapack";
    } else if (projectType.includes("modpack") || projectType.includes("mod pack")) {
      resourceKind = "modpack";
    } else if (projectType.includes("world") || projectType.includes("map")) {
      resourceKind = "world";
    }

    try {
      // 先占位下载中状态（在 taskId 返回之前显示加载）
      setDownloadingUrlToTaskId(prev => {
        const next = new Map(prev);
        if (!next.has(file.url)) {
          next.set(file.url, -1);  // -1 表示正在等待后端返回 taskId
        }
        return next;
      });

      const taskId = await startResourceDownload(
        resourceKind,
        modSlug,
        modName,
        mcVersion,
        modLoader,
        file.url
      );

      // 更新为真实的 taskId
      setDownloadingUrlToTaskId(prev => {
        const next = new Map(prev);
        next.set(file.url, taskId);
        return next;
      });
    } catch (err) {
      console.error("下载失败:", err);
      setDownloadingUrlToTaskId(prev => {
        const next = new Map(prev);
        next.delete(file.url);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-8 animate-spin" />
        <p className="text-sm">正在加载项目信息...</p>
      </div>
    );
  }

  const displayTitle = liveInfo?.title || modId;
  const displaySlug = liveInfo?.slug || modId;
  const totalFiles = parsedFiles.size;
  const totalVersions = Array.from(parsedFiles.values()).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="flex h-full flex-col p-4">
      <Button variant="ghost" size="sm" className="w-fit mb-4" onClick={() => router.push("/download")}>
        <ArrowLeft className="mr-2 size-4" />
        返回搜索
      </Button>

      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex gap-5 items-start flex-col md:flex-row">
            <div className={"shrink-0 w-20 h-20 " + (liveInfo?.iconUrl ? "" : "bg-gradient-to-br from-primary/20 to-primary/5") + " rounded-xl flex items-center justify-center border border-border overflow-hidden"}>
              {liveInfo?.iconUrl ? (
                <img
                  src={liveInfo.iconUrl}
                  alt=""
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (target.parentElement) {
                      target.style.display = 'none';
                    }
                  }}
                />
              ) : (
                <Package className="size-8 text-primary" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">{displayTitle}</h1>
              <div className="flex flex-wrap gap-2 mt-2 items-center">
                <Badge variant="secondary" className="text-xs font-mono">
                  {displaySlug}
                </Badge>

                {liveInfo?.source === 'both' && (
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                    Modrinth + CurseForge
                  </Badge>
                )}
                {liveInfo?.source === 'modrinth' && (
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                    Modrinth
                  </Badge>
                )}
                {liveInfo?.source === 'curseforge' && (
                  <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30">
                    CurseForge
                  </Badge>
                )}

                {dataSource && (
                  <Badge variant="outline" className="text-xs">
                    文件来自 {dataSource}
                  </Badge>
                )}

                <Badge variant="outline" className="text-xs">
                  {totalFiles} MC 版本 · {totalVersions} 文件
                </Badge>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-3">
                {liveInfo?.downloads != null && (
                  <span>⬇ 总下载 {formatDownloads(liveInfo.downloads)}</span>
                )}
                {liveInfo?.author && (
                  <span>作者: <span className="text-foreground font-medium">{liveInfo.author}</span></span>
                )}
                {liveInfo?.updated && (
                  <span>更新于 {formatDateShort(liveInfo.updated)}</span>
                )}
                {liveInfo?.projectType && (
                  <span>类型: {translateProjectType(liveInfo.projectType)}</span>
                )}
              </div>

              {liveInfo?.description && (
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                  {liveInfo.description}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-4">
                {liveInfo?.modrinthUrl && (
                  <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.modrinthUrl!)}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    在 Modrinth 上查看
                  </Button>
                )}
                {liveInfo?.curseforgeUrl && (
                  <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.curseforgeUrl!)}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    在 CurseForge 上查看
                  </Button>
                )}
                {liveInfo?.mcmodUrl && (
                  <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.mcmodUrl!)}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    在 MC百科 上查看
                  </Button>
                )}
                {liveError && (
                  <span className="text-[11px] text-destructive">在线信息加载失败: {liveError}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {modFiles && totalVersions > 0 ? (
          <div className="flex-1 min-h-0 space-y-2">
            {loadingFiles && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground py-4">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm">正在获取文件列表...</span>
              </div>
            )}

            {Array.from(parsedFiles.entries()).map(([mcVersion, files]) => {
              const isExpanded = expandedVersions.has(mcVersion);
              const releaseCount = files.filter(f => f.isRelease).length;
              const nonReleaseCount = files.length - releaseCount;

              return (
                <div key={mcVersion} className="rounded-xl border border-border bg-card overflow-hidden">
                  <button onClick={() => toggleVersion(mcVersion)} className="w-full flex items-center justify-between p-4 hover:bg-accent/40 transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <div className={"transition-transform duration-300 " + (isExpanded ? "rotate-180" : "")}>
                        <ChevronDown className="size-5 text-muted-foreground" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-semibold text-base">MC {mcVersion}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {files.length} 个文件
                          {releaseCount > 0 && (<span className="ml-2">· {releaseCount} 个正式版</span>)}
                          {nonReleaseCount > 0 && (<span className="ml-2">· {nonReleaseCount} 个测试版</span>)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {releaseCount > 0 && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                          <Shield className="size-5" />
                        </span>
                      )}
                      {nonReleaseCount > 0 && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                          <FlaskConical className="size-5" />
                        </span>
                      )}
                    </div>
                  </button>

                  <div className={"grid transition-all duration-300 ease-out " + (isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="overflow-hidden">
                      <div className="border-t border-border divide-y divide-border/60 bg-muted/10">
                        {files.map((file, index) => {
                          const status = getDownloadStatus(file.url);
                          return (
                            <div key={index} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors">
                              <div className="flex items-center gap-2 shrink-0 w-16 justify-center">
                                {file.isRelease ? (
                                  <Shield className="size-7 text-emerald-500" aria-label="正式版" />
                                ) : (
                                  <FlaskConical className="size-7 text-amber-500" aria-label="测试版" />
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold truncate">
                                  {file.versionLabel}
                                  {file.loaderLabel === "通用" && (
                                    <span className="text-muted-foreground/70 ml-1" aria-label="加载器未识别">:</span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  <Badge variant={file.isRelease ? "secondary" : "outline"} className="text-[10px] h-4">{file.loaderLabel}</Badge>
                                  <Badge variant={file.isRelease ? "default" : "outline"} className={"text-[10px] h-4 " + (file.isRelease ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "text-amber-600 dark:text-amber-400 border-amber-500/30")}>{file.isRelease ? "正式版" : "测试版"}</Badge>
                                  {file.serverLabel && (
                                    <Badge variant="outline" className="text-[10px] h-4 text-sky-600 dark:text-sky-400 border-sky-500/30">{file.serverLabel}</Badge>
                                  )}
                                  {file.cleanTags.slice(0, 2).map((tag, i) => (
                                    <span key={i} className="text-[10px] text-muted-foreground">{tag}</span>
                                  ))}
                                </div>
                              </div>

                              <Button size="sm" variant={status === "success" ? "secondary" : status === "error" ? "destructive" : "default"} disabled={status === "downloading" || status === "success"} onClick={() => handleDownload(file, mcVersion)} className="shrink-0">
                                {status === "downloading" && (<><Loader2 className="mr-1.5 size-3.5 animate-spin" /> 下载中</>)}
                                {status === "success" && (<><CheckCircle2 className="mr-1.5 size-3.5" /> 已下载</>)}
                                {status === "error" && (<><XCircle className="mr-1.5 size-3.5" /> 重试</>)}
                                {status === "idle" && (<><Download className="mr-1.5 size-3.5" /> 下载</>)}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground rounded-xl border border-dashed border-border bg-card/50 p-8">
            {filesError ? (
              <>
                <div className="size-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <span className="text-destructive text-lg">!</span>
                </div>
                <p className="text-sm font-medium text-foreground">无法连接到数据源</p>
                <p className="text-xs text-muted-foreground text-center max-w-sm leading-relaxed">
                  获取文件列表时发生网络错误。海外数据源访问时可能出现连接中断、超时等问题。
                </p>
                <div className="mt-2 max-w-md w-full p-3 rounded-lg bg-muted/50 text-xs font-mono break-all text-muted-foreground">{filesError}</div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button variant="default" size="sm" onClick={loadModData}>重试</Button>
                  {liveInfo?.modrinthUrl && (
                    <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.modrinthUrl!)}>
                      <ExternalLink className="mr-1.5 size-3.5" />
                      在 Modrinth 上查看
                    </Button>
                  )}
                  {liveInfo?.curseforgeUrl && (
                    <Button variant="outline" size="sm" onClick={() => openExternalUrl(liveInfo.curseforgeUrl!)}>
                      <ExternalLink className="mr-1.5 size-3.5" />
                      在 CurseForge 上查看
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <>
                <Package className="size-10 opacity-40" />
                <p className="text-sm">暂无可用的模组文件</p>
                <p className="text-xs text-muted-foreground">请检查模组slug是否正确，或稍后重试</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={loadModData}>重新加载</Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
>>>>>>> 7e94b3d5fae96299a238ed4f26231cdffc1ac040
}