"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useLaunchContext } from "@/components/launch/launch-provider";
import { useAccountContext } from "@/components/accounts/account-provider";
import { VersionSelectorDialog } from "@/components/launch/version-selector-dialog";
import {
  FolderOpen,
  HardDrive,
  Cpu,
  Package,
  User,
  Monitor,
  Plus,
  X,
  CheckCircle2,
  Circle,
  Download,
  Search,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LauncherPathsConfig } from "@/types";

interface MemoryInfo {
  totalMB: number;
  usedMB: number;
  availableMB: number;
  recommendedMB: number;
}

function useSystemMemory(): MemoryInfo {
  const [info, setInfo] = useState<MemoryInfo>({ totalMB: 0, usedMB: 0, availableMB: 0, recommendedMB: 0 });

  useEffect(() => {
    invoke<{ total_mb: number; used_mb: number; available_mb: number; recommended_mb: number }>("get_system_memory")
      .then(({ total_mb, used_mb, available_mb, recommended_mb }) =>
        setInfo({ totalMB: total_mb, usedMB: used_mb, availableMB: available_mb, recommendedMB: recommended_mb })
      )
      .catch(() => {});
  }, []);

  return info;
}

/** 路径列表条目 */
function PathItem({
  path,
  isSelected,
  isDefault,
  badge,
  canRemove,
  onSelect,
  onRemove,
}: {
  path: string;
  isSelected: boolean;
  isDefault?: boolean;
  badge?: string;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 cursor-pointer transition-colors text-xs group ${
        isSelected
          ? "bg-primary/10 text-primary"
          : "hover:bg-muted text-muted-foreground"
      }`}
      onClick={onSelect}
    >
      {isSelected ? (
        <CheckCircle2 className="size-3 shrink-0 text-primary" />
      ) : (
        <Circle className="size-3 shrink-0 opacity-40" />
      )}
      <span className="flex-1 break-all leading-snug">{path}</span>
      {badge && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium bg-primary/10 text-primary leading-none">
          {badge}
        </span>
      )}
      {isDefault && (
        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium bg-muted text-muted-foreground leading-none">
          默认
        </span>
      )}
      {canRemove && (
        <button
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/**
 * 启动配置卡片
 * 设置 Java 路径、内存、版本等启动参数
 */
export function LaunchConfigCard() {
  const { config, updateConfig } = useLaunchContext();
  const { selectedProfile } = useAccountContext();
  const { totalMB, usedMB, availableMB, recommendedMB } = useSystemMemory();

  const [pathsCfg, setPathsCfg] = useState<LauncherPathsConfig>({
    java_paths: [],
    selected_java_path: "",
    minecraft_paths: [],
    selected_minecraft_path: "",
    default_minecraft_path: "",
  });
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    invoke<LauncherPathsConfig>("get_launcher_paths_config")
      .then((cfg) => setPathsCfg(cfg))
      .catch(() => {});
  }, []);

  const savePaths = useCallback(
    async (next: LauncherPathsConfig) => {
      // 去重，保证唯一性
      const uniqueJava = [...new Set(next.java_paths)];
      const uniqueMc = [...new Set(next.minecraft_paths)];
      const dedup: LauncherPathsConfig = {
        ...next,
        java_paths: uniqueJava,
        minecraft_paths: uniqueMc,
      };
      setPathsCfg(dedup);
      try {
        await invoke("save_launcher_paths_config", { config: dedup });
      } catch { /* ignore */ }
      if (dedup.selected_java_path) updateConfig({ javaPath: dedup.selected_java_path });
      if (dedup.selected_minecraft_path) updateConfig({ minecraftPath: dedup.selected_minecraft_path });
    },
    [updateConfig]
  );

  const openDialog = async (mode: "java" | "minecraft") => {
    try {
      const mod = await import("@tauri-apps/plugin-dialog" as string);
      const open = mod.open;
      const result =
        mode === "minecraft"
          ? await open({ directory: true, multiple: false })
          : await open({ multiple: false, filters: [{ name: "Executable", extensions: ["exe", ""] }] });
      if (!result) return;
      const path = result as string;
      if (mode === "java") {
        if (pathsCfg.java_paths.includes(path)) return;
        // 自动识别版本信息
        const installations = { ...pathsCfg.java_installations };
        try {
          const info = await invoke<{ path: string; version: string; major_version: number; vendor: string; architecture: string; java_type: string }>("validate_java_path", { javaPath: path });
          installations[info.path] = info;
          await savePaths({
            ...pathsCfg,
            java_paths: [...pathsCfg.java_paths, info.path],
            java_installations: installations,
            selected_java_path: info.path,
          });
        } catch {
          // 验证失败仍保存路径，但无版本信息
          await savePaths({
            ...pathsCfg,
            java_paths: [...pathsCfg.java_paths, path],
            selected_java_path: path,
          });
        }
      } else {
        if (pathsCfg.minecraft_paths.includes(path)) return;
        await savePaths({
          ...pathsCfg,
          minecraft_paths: [...pathsCfg.minecraft_paths, path],
          selected_minecraft_path: path,
        });
      }
    } catch { /* dialog 不可用或用户取消 */ }
  };

  const handleOpenFileDialog = async (field: "wrapperPath") => {
    try {
      const mod = await import("@tauri-apps/plugin-dialog" as string);
      const open = mod.open;
      const result = await open({
        multiple: false,
        filters: [{ name: "Executable", extensions: ["jar", "exe", ""] }],
      });
      if (result) updateConfig({ [field]: result as string });
    } catch { /* ignore */ }
  };

  const handleExportLaunchArgs = async () => {
    try {
      if (!selectedProfile) {
        alert("请先选择账户");
        return;
      }

      const mod = await import("@tauri-apps/plugin-dialog" as string);
      const save = mod.save;
      const filePath = await save({
        defaultPath: "launch_command.txt",
        filters: [{ name: "Text", extensions: ["txt"] }, { name: "Batch", extensions: ["bat"] }, { name: "Shell", extensions: ["sh"] }],
      });
      if (!filePath) return;

      // 构建完整的启动命令参数
      const result = await invoke<string>("build_jvm_arguments", {
        minecraftPath: config.minecraftPath,
        javaPath: config.javaPath,
        wrapperPath: config.wrapperPath,
        maxMemory: config.maxMemory,
        versionName: config.versionName,
        playerName: config.playerName || selectedProfile.name,
        authToken: config.authToken || selectedProfile.accessToken || "",
        uuid: config.uuid || selectedProfile.uuid || selectedProfile.id,
        authlibInjectorPath: config.authlibInjectorPath,
        yggdrasilApi: config.yggdrasilApi || selectedProfile.yggdrasilUrl || "",
        prefetchedData: config.prefetchedData,
        loadType: config.loadType,
        loadName: config.loadName,
        windowWidth: config.windowWidth || "873",
        windowHeight: config.windowHeight || "486",
      });

      const exportData = `# Minecraft 启动命令
# 导出时间: ${new Date().toLocaleString()}
# 版本: ${config.versionName || "未设置"}
# 玩家: ${selectedProfile.name}

${result}
`;

      await invoke("write_file", { path: filePath, content: exportData });
      alert("启动命令已导出成功！");
    } catch (err) {
      alert(`导出失败: ${err}`);
    }
  };

  const handleScanJava = async () => {
    setScanning(true);
    try {
      type JavaInfo = { path: string; version: string; major_version: number; vendor: string; architecture: string; java_type: string };
      const results = await invoke<JavaInfo[]>("search_java_installations");

      const installations: Record<string, JavaInfo> = {};

      // 先处理已有的路径和验证信息
      for (const oldPath of pathsCfg.java_paths) {
        if (pathsCfg.java_installations?.[oldPath]) {
          // 保留已有的验证信息
          installations[oldPath] = pathsCfg.java_installations[oldPath] as JavaInfo;
        }
      }

      // 扫描结果加入，只添加新的路径
      for (const r of results) {
        // 如果这个路径不在已有路径中，或者已有路径没有验证信息，才添加
        if (!pathsCfg.java_paths.includes(r.path) || !pathsCfg.java_installations?.[r.path]) {
          installations[r.path] = r;
        }
      }

      // 合并所有路径，使用Set去重
      const allPaths = [...pathsCfg.java_paths, ...results.map((r) => r.path)];
      const newPaths = [...new Set(allPaths)];

      const next = {
        ...pathsCfg,
        java_paths: newPaths,
        java_installations: installations,
        selected_java_path: pathsCfg.selected_java_path || (results.length > 0 ? results[0].path : ""),
      };
      await savePaths(next);
    } catch { /* ignore */ }
    setScanning(false);
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Package className="size-4 text-primary" />
            启动配置
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px] gap-1.5"
            onClick={handleExportLaunchArgs}
          >
            <Download className="size-3" />
            导出参数
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 游戏目录 — 路径列表 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              <HardDrive className="size-3" />
              游戏目录
            </Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground gap-1"
              onClick={() => openDialog("minecraft")}
            >
              <Plus className="size-3" /> 添加
            </Button>
          </div>
          {/* 默认路径始终显示 */}
          {pathsCfg.default_minecraft_path && (
            <PathItem
              path={pathsCfg.default_minecraft_path}
              isSelected={pathsCfg.selected_minecraft_path === pathsCfg.default_minecraft_path}
              isDefault
              canRemove={false}
              onSelect={() =>
                savePaths({ ...pathsCfg, selected_minecraft_path: pathsCfg.default_minecraft_path })
              }
              onRemove={() => {}}
            />
          )}
          {/* 用户手动添加的路径 */}
          {pathsCfg.minecraft_paths
            .filter((p) => p !== pathsCfg.default_minecraft_path)
            .map((p) => (
              <PathItem
                key={p}
                path={p}
                isSelected={pathsCfg.selected_minecraft_path === p}
                canRemove
                onSelect={() => savePaths({ ...pathsCfg, selected_minecraft_path: p })}
                onRemove={() => {
                  const next = {
                    ...pathsCfg,
                    minecraft_paths: pathsCfg.minecraft_paths.filter((x) => x !== p),
                    selected_minecraft_path:
                      pathsCfg.selected_minecraft_path === p
                        ? pathsCfg.default_minecraft_path
                        : pathsCfg.selected_minecraft_path,
                  };
                  savePaths(next);
                }}
              />
            ))}
          {!pathsCfg.default_minecraft_path &&
            pathsCfg.minecraft_paths.length === 0 && (
              <p className="text-[10px] text-muted-foreground/60 px-1">
                点击"添加"选择游戏目录
              </p>
            )}
        </div>

        {/* Java 路径 — 路径列表 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              <Cpu className="size-3" />
              Java 路径
            </Label>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground gap-1"
                onClick={handleScanJava}
                disabled={scanning}
              >
                <Search className={`size-3 ${scanning ? "animate-spin" : ""}`} />
                {scanning ? "扫描中" : "扫描"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground gap-1"
                onClick={() => openDialog("java")}
              >
                <Plus className="size-3" /> 添加
              </Button>
            </div>
          </div>
          {pathsCfg.java_paths.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/60 px-1">
              点击"扫描"自动搜索或"添加"手动选择 Java
            </p>
          ) : (
            [...new Set(pathsCfg.java_paths)].map((p) => {
              const inst = pathsCfg.java_installations?.[p];
              const badge = inst ? `Java ${inst.major_version}` : undefined;
              return (
                <PathItem
                  key={p}
                  path={p}
                  isSelected={pathsCfg.selected_java_path === p}
                  badge={badge}
                  canRemove
                  onSelect={() => savePaths({ ...pathsCfg, selected_java_path: p })}
                  onRemove={() => {
                    const nextPaths = pathsCfg.java_paths.filter((x) => x !== p);
                    savePaths({
                      ...pathsCfg,
                      java_paths: nextPaths,
                      selected_java_path:
                        pathsCfg.selected_java_path === p
                          ? (nextPaths[0] ?? "")
                          : pathsCfg.selected_java_path,
                    });
                  }}
                />
              );
            })
          )}
        </div>

        {/* Wrapper 路径（可选） */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            <Package className="size-3" />
            Wrapper 路径
            <span className="text-[10px] text-muted-foreground/60 ml-1">（可选）</span>
          </Label>
          <div className="flex gap-2">
            <Input
              placeholder="留空则直接启动，无需 Wrapper"
              value={config.wrapperPath}
              onChange={(e) =>
                updateConfig({ wrapperPath: e.target.value })
              }
              className="text-xs h-8"
            />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-8 px-2"
              onClick={() => handleOpenFileDialog("wrapperPath")}
            >
              <FolderOpen className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* 最大内存 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              最大内存 (MB)
            </Label>
            {totalMB > 0 && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>系统总计 <span className="text-foreground font-medium">{totalMB >= 1024 ? `${(totalMB / 1024).toFixed(1)} GB` : `${totalMB} MB`}</span></span>
                {availableMB > 0 && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>可用 <span className="text-foreground font-medium">{availableMB >= 1024 ? `${(availableMB / 1024).toFixed(1)} GB` : `${availableMB} MB`}</span></span>
                  </>
                )}
              </div>
            )}
          </div>
          {totalMB > 0 && availableMB > 0 && (() => {
            const percentage = Math.min(100, (Number(config.maxMemory) / availableMB) * 100);
            return (
              <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/40 transition-all"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            );
          })()}
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1024}
              max={availableMB > 0 ? Math.max(1024, availableMB) : totalMB > 0 ? Math.max(1024, Math.floor(totalMB * 0.75)) : 32768}
              step={1}
              value={Number(config.maxMemory) || 4096}
              onChange={(e) => updateConfig({ maxMemory: e.target.value })}
              className="flex-1 h-1.5 accent-primary cursor-pointer"
            />
            <Input
              type="number"
              value={config.maxMemory}
              onChange={(e) => updateConfig({ maxMemory: e.target.value })}
              className="w-20 text-xs h-8 text-center"
              min={512}
              max={availableMB > 0 ? availableMB : 65536}
            />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-8 px-3 text-[10px] gap-1"
              disabled={recommendedMB === 0}
              onClick={() => {
                if (recommendedMB > 0) {
                  updateConfig({ maxMemory: String(recommendedMB) });
                }
              }}
            >
              自动分配
              {recommendedMB > 0 && (
                <span className="text-[9px] text-muted-foreground/70">
                  {recommendedMB >= 1024 ? `${(recommendedMB / 1024).toFixed(1)}GB` : `${recommendedMB}MB`}
                </span>
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            建议分配可用内存的 50%–75%
            {availableMB > 0 && (() => {
              return (
                <span className="ml-1 text-muted-foreground/60">
                  （{Math.round(availableMB * 0.5)}–{Math.round(availableMB * 0.75)} MB，推荐 {recommendedMB} MB）
                </span>
              );
            })()}
          </p>
        </div>

        {/* 版本名称 - 使用版本选择对话框（自动识别加载器） */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">游戏版本</Label>
          <VersionSelectorDialog />
        </div>

        {/* 窗口尺寸 */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            <Monitor className="size-3" />
            游戏窗口尺寸
          </Label>
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              placeholder="宽度"
              value={config.windowWidth}
              onChange={(e) => updateConfig({ windowWidth: e.target.value })}
              className="text-xs h-8 w-24 text-center"
              min={1}
            />
            <span className="text-xs text-muted-foreground">×</span>
            <Input
              type="number"
              placeholder="高度"
              value={config.windowHeight}
              onChange={(e) => updateConfig({ windowHeight: e.target.value })}
              className="text-xs h-8 w-24 text-center"
              min={1}
            />
          </div>
        </div>

        {/* 玩家身份（可折叠） */}
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none">
            高级：玩家身份设置
          </summary>
          <div className="mt-3 space-y-3 border-l-2 border-border pl-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                <User className="size-3" />
                玩家名称
              </Label>
              <Input
                placeholder="留空则使用当前账户名"
                value={config.playerName}
                onChange={(e) =>
                  updateConfig({ playerName: e.target.value })
                }
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                UUID
              </Label>
              <Input
                placeholder="留空则使用账户 ID"
                value={config.uuid}
                onChange={(e) =>
                  updateConfig({ uuid: e.target.value })
                }
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                认证令牌 (accessToken)
              </Label>
              <Input
                type="password"
                placeholder="可选"
                value={config.authToken}
                onChange={(e) =>
                  updateConfig({ authToken: e.target.value })
                }
                className="text-xs h-8"
              />
            </div>
          </div>
        </details>

        {/* 第三方验证（可折叠） */}
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none">
            高级：第三方验证设置
          </summary>
          <div className="mt-3 space-y-3 border-l-2 border-border pl-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Authlib Injector 路径
              </Label>
              <Input
                placeholder="authlib-injector.jar 路径"
                value={config.authlibInjectorPath}
                onChange={(e) =>
                  updateConfig({ authlibInjectorPath: e.target.value })
                }
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Yggdrasil API
              </Label>
              <Input
                placeholder="https://..."
                value={config.yggdrasilApi}
                onChange={(e) =>
                  updateConfig({ yggdrasilApi: e.target.value })
                }
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                预取数据 (Base64)
              </Label>
              <Input
                placeholder="可选"
                value={config.prefetchedData}
                onChange={(e) =>
                  updateConfig({ prefetchedData: e.target.value })
                }
                className="text-xs h-8"
              />
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}