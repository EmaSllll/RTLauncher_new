"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ModDependency {
  mod_id: string;
  version_range?: string | null;
  mandatory: boolean;
  ordering?: string | null;
  side?: string | null;
}

export interface ModInfo {
  file_name: string;
  mod_id: string;
  name: string;
  version: string;
  description?: string | null;
  authors: string[];
  license?: string | null;
  icon?: string | null;
  source?: string | null;
  homepage?: string | null;
  issues?: string | null;
  minecraft_version?: string | null;
  mod_loader?: string | null;
  dependencies: ModDependency[];
  optional_dependencies: ModDependency[];
  incompatible_dependencies: ModDependency[];
}

/**
 * 通用的资源管理 hook - 管理两列资源
 *
 * 左列：当前实例中的文件
 * 右列：cache 中对应版本/加载器的文件（未加入实例）
 *
 * @param instanceDir 实例目录绝对路径
 * @param instanceSubdir 实例子目录名（如 "mods"、"resourcepacks"）
 * @param cacheKind cache 资源类型标识（如 "mod"、"resourcepack"、"shaderpack"、"world"、"datapack"）
 * @param mcVersion 当前实例的 Minecraft 版本
 * @param modLoader 当 cacheKind === "mod" 时需要传加载器类型
 * @param extensions 文件扩展名过滤（小写，不含点）
 */
export function useResourceManager(
  instanceDir: string | undefined,
  instanceSubdir: string,
  cacheKind: string,
  mcVersion: string | undefined,
  modLoader: string | undefined,
  extensions: string[] = [],
): {
  // 实例中的文件
  instanceFiles: { name: string; size: number }[];
  instanceLoading: boolean;
  instanceError: string | null;

  // cache 中的文件（对应当前版本/加载器）
  cacheFiles: { name: string; size: number }[];
  cacheLoading: boolean;
  cacheError: string | null;

  // 模组元数据缓存（文件名 -> ModInfo）
  instanceModInfo: Map<string, ModInfo>;
  cacheModInfo: Map<string, ModInfo>;
  modsParsing: boolean;

  // 操作
  addToInstance: (fileName: string) => Promise<void>;
  removeFromInstance: (fileName: string) => Promise<void>;
  deleteFromInstance: (fileName: string) => Promise<void>;
  deleteFromCache: (fileName: string) => Promise<void>;
  renameInInstance: (oldName: string, newName: string) => Promise<void>;
  uploadFiles: () => Promise<void>;
  refresh: () => void;

  // 搜索
  instanceSearch: string;
  setInstanceSearch: (s: string) => void;
  cacheSearch: string;
  setCacheSearch: (s: string) => void;

  // 过滤后的结果
  filteredInstanceFiles: { name: string; size: number }[];
  filteredCacheFiles: { name: string; size: number }[];
} {
  // 实例中的文件 - 使用 vm_list_dir
  const [instanceFiles, setInstanceFiles] = useState<{ name: string; size: number }[]>([]);
  const [instanceLoading, setInstanceLoading] = useState(false);
  const [instanceError, setInstanceError] = useState<string | null>(null);

  // cache 中的文件
  const [cacheFiles, setCacheFiles] = useState<{ name: string; size: number }[]>([]);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);

  // 模组元数据缓存
  const [instanceModInfo, setInstanceModInfo] = useState<Map<string, ModInfo>>(new Map());
  const [cacheModInfo, setCacheModInfo] = useState<Map<string, ModInfo>>(new Map());
  const [modsParsing, setModsParsing] = useState(false);

  // 搜索
  const [instanceSearch, setInstanceSearch] = useState("");
  const [cacheSearch, setCacheSearch] = useState("");

  const parseModMetadata = useCallback(
    async (
      fileNames: string[],
      dirBase: string,
    ): Promise<Map<string, ModInfo>> => {
      if (!cacheKind || fileNames.length === 0) {
        return new Map();
      }
      try {
        const paths = fileNames.map((n) => `${dirBase}/${n}`);
        const results: [string, ModInfo | null][] = await invoke("parse_mods", {
          files: paths,
        });
        const map = new Map<string, ModInfo>();
        for (const [path, info] of results) {
          if (info) {
            // 从完整路径提取文件名作为 key
            const fileName = path.split(/[\\/]/).pop() || path;
            map.set(fileName, info);
          }
        }
        return map;
      } catch (e) {
        console.warn("解析模组元数据失败:", e);
        return new Map();
      }
    },
    [cacheKind],
  );

  const fetchInstanceFiles = useCallback(async () => {
    if (!instanceDir) return;
    setInstanceLoading(true);
    setInstanceError(null);
    try {
      const dir = `${instanceDir}/${instanceSubdir}`;
      const entries: { name: string; is_dir: boolean; extension: string; size: number }[] =
        await invoke("vm_list_dir", { dirPath: dir, extensionsFilter: extensions });
      // world 类型保留目录（存档是目录），其他类型仅保留文件
      const filtered = cacheKind === "world"
        ? entries
        : entries.filter((e) => !e.is_dir);
      const sorted = filtered
        .map((e) => ({ name: e.name, size: e.size }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setInstanceFiles(sorted);

      // 当是模组目录时，批量解析元数据（任何 ZIP 格式的文件都能解析：.jar / .litemod / .zip）
      if (cacheKind === "mod" && sorted.length > 0) {
        setModsParsing(true);
        try {
          const modFiles = sorted.filter((f) => {
            const lower = f.name.toLowerCase();
            return lower.endsWith(".jar") || lower.endsWith(".litemod") || lower.endsWith(".zip");
          });
          const infoMap = await parseModMetadata(
            modFiles.map((f) => f.name),
            dir.replace(/\\/g, "/"),
          );
          setInstanceModInfo(infoMap);
        } finally {
          setModsParsing(false);
        }
      }
    } catch (e: any) {
      if (String(e).toLowerCase().includes("not found") || String(e).toLowerCase().includes("系统找不到")) {
        setInstanceFiles([]);
      } else {
        setInstanceError(String(e));
        setInstanceFiles([]);
      }
    } finally {
      setInstanceLoading(false);
    }
  }, [instanceDir, instanceSubdir, JSON.stringify(extensions), cacheKind, parseModMetadata]);

  const fetchCacheFiles = useCallback(async () => {
    if (!mcVersion) {
      setCacheFiles([]);
      return;
    }
    setCacheLoading(true);
    setCacheError(null);
    try {
      let names: string[] = [];
      let cacheDirBase: string | null = null;

      if (cacheKind === "mod") {
        const loader = modLoader || "forge";
        names = await invoke("list_cached_mods", {
          mcVersion: mcVersion,
          modLoader: loader,
        });
        // 通过命令获取 cache 根目录
        try {
          const root: string = await invoke("get_mod_cache_dir_cmd", {
            mcVersion: mcVersion,
            modLoader: loader,
          });
          cacheDirBase = root.replace(/\\/g, "/");
        } catch {
          cacheDirBase = null;
        }
      } else {
        names = await invoke("list_cached_files", {
          kind: cacheKind,
          mcVersion: mcVersion,
        });
      }

      // 过滤掉已存在于实例中的文件
      const instanceNames = new Set(instanceFiles.map((f) => f.name));
      const unique = names.filter((n) => !instanceNames.has(n));
      const sorted = unique
        .map((n) => ({ name: n, size: 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCacheFiles(sorted);

      // 当是模组目录时，批量解析元数据（任何 ZIP 格式的文件都能解析：.jar / .litemod / .zip）
      if (cacheKind === "mod" && sorted.length > 0 && cacheDirBase) {
        setModsParsing(true);
        try {
          const modFiles = sorted.filter((f) => {
            const lower = f.name.toLowerCase();
            return lower.endsWith(".jar") || lower.endsWith(".litemod") || lower.endsWith(".zip");
          });
          const infoMap = await parseModMetadata(
            modFiles.map((f) => f.name),
            cacheDirBase,
          );
          setCacheModInfo(infoMap);
        } finally {
          setModsParsing(false);
        }
      }
    } catch (e: any) {
      if (String(e).toLowerCase().includes("not found") || String(e).toLowerCase().includes("系统找不到")) {
        setCacheFiles([]);
      } else {
        setCacheError(String(e));
        setCacheFiles([]);
      }
    } finally {
      setCacheLoading(false);
    }
  }, [cacheKind, mcVersion, modLoader, JSON.stringify(instanceFiles), parseModMetadata]);

  const addToInstance = useCallback(
    async (fileName: string) => {
      if (!instanceDir || !mcVersion) return;
      await invoke("cache_to_instance", {
        kind: cacheKind,
        mcVersion: mcVersion,
        modLoader: cacheKind === "mod" ? (modLoader || null) : null,
        fileName: fileName,
        instanceDir: instanceDir,
        instanceSubdir: instanceSubdir,
      });
      fetchInstanceFiles();
      fetchCacheFiles();
    },
    [instanceDir, mcVersion, cacheKind, modLoader, instanceSubdir, fetchInstanceFiles, fetchCacheFiles],
  );

  const removeFromInstance = useCallback(
    async (fileName: string) => {
      if (!instanceDir || !mcVersion) return;
      await invoke("instance_to_cache", {
        kind: cacheKind,
        mcVersion: mcVersion,
        modLoader: cacheKind === "mod" ? (modLoader || null) : null,
        fileName: fileName,
        instanceDir: instanceDir,
        instanceSubdir: instanceSubdir,
      });
      fetchInstanceFiles();
      fetchCacheFiles();
    },
    [instanceDir, mcVersion, cacheKind, modLoader, instanceSubdir, fetchInstanceFiles, fetchCacheFiles],
  );

  const deleteFromInstance = useCallback(
    async (fileName: string) => {
      if (!instanceDir) return;
      const dir = `${instanceDir}/${instanceSubdir}`;
      await invoke("vm_delete_file", { dirPath: dir, fileName });
      fetchInstanceFiles();
    },
    [instanceDir, instanceSubdir, fetchInstanceFiles],
  );

  const deleteFromCache = useCallback(
    async (fileName: string) => {
      if (!mcVersion) return;
      await invoke("vm_delete_cached_file", {
        kind: cacheKind,
        mcVersion: mcVersion,
        modLoader: cacheKind === "mod" ? (modLoader || null) : null,
        fileName,
      });
      fetchCacheFiles();
    },
    [cacheKind, mcVersion, modLoader, fetchCacheFiles],
  );

  const renameInInstance = useCallback(
    async (oldName: string, newName: string) => {
      if (!instanceDir) return;
      const dir = `${instanceDir}/${instanceSubdir}`;
      await invoke("vm_rename_file", { dirPath: dir, oldName, newName });
      fetchInstanceFiles();
    },
    [instanceDir, instanceSubdir, fetchInstanceFiles],
  );

  const uploadFiles = useCallback(async () => {
    if (!instanceDir) return;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (extensions.length > 0) {
      input.accept = extensions.map(e => `.${e}`).join(',');
    }
    input.style.display = 'none';
    
    document.body.appendChild(input);
    
    return new Promise<void>((resolve) => {
      input.addEventListener('change', async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (!files || files.length === 0) {
          document.body.removeChild(input);
          resolve();
          return;
        }

        const targetDir = `${instanceDir}/${instanceSubdir}`;
        
        for (const file of Array.from(files)) {
          const arrayBuffer = await file.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          const base64 = btoa(String.fromCharCode(...bytes));
          
          await invoke("vm_write_file_base64", {
            dirPath: targetDir,
            fileName: file.name,
            contentBase64: base64,
          });
        }
        
        fetchInstanceFiles();
        fetchCacheFiles();
        
        document.body.removeChild(input);
        resolve();
      });
      
      input.click();
    });
  }, [instanceDir, instanceSubdir, fetchInstanceFiles, fetchCacheFiles, extensions]);

  const refresh = useCallback(() => {
    fetchInstanceFiles();
    fetchCacheFiles();
  }, [fetchInstanceFiles, fetchCacheFiles]);

  // 初始化加载
  useEffect(() => {
    if (instanceDir) {
      fetchInstanceFiles();
    }
    if (mcVersion) {
      fetchCacheFiles();
    }
  }, [instanceDir, mcVersion, fetchInstanceFiles, fetchCacheFiles]);

  // 过滤结果 - 同时搜索文件名和模组名称
  const filteredInstanceFiles = useMemo(() => {
    if (!instanceSearch) return instanceFiles;
    const q = instanceSearch.toLowerCase();
    return instanceFiles.filter((f) => {
      if (f.name.toLowerCase().includes(q)) return true;
      const info = instanceModInfo.get(f.name);
      if (info && (info.name.toLowerCase().includes(q) || info.mod_id.toLowerCase().includes(q))) {
        return true;
      }
      return false;
    });
  }, [instanceFiles, instanceSearch, instanceModInfo]);

  const filteredCacheFiles = useMemo(() => {
    if (!cacheSearch) return cacheFiles;
    const q = cacheSearch.toLowerCase();
    return cacheFiles.filter((f) => {
      if (f.name.toLowerCase().includes(q)) return true;
      const info = cacheModInfo.get(f.name);
      if (info && (info.name.toLowerCase().includes(q) || info.mod_id.toLowerCase().includes(q))) {
        return true;
      }
      return false;
    });
  }, [cacheFiles, cacheSearch, cacheModInfo]);

  return {
    instanceFiles,
    instanceLoading,
    instanceError,
    cacheFiles,
    cacheLoading,
    cacheError,
    instanceModInfo,
    cacheModInfo,
    modsParsing,
    addToInstance,
    removeFromInstance,
    deleteFromInstance,
    deleteFromCache,
    renameInInstance,
    uploadFiles,
    refresh,
    instanceSearch,
    setInstanceSearch,
    cacheSearch,
    setCacheSearch,
    filteredInstanceFiles,
    filteredCacheFiles,
  };
}