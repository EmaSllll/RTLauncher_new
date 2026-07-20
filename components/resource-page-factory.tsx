"use client";

import React from "react";
import { motion } from "framer-motion";
import { Package, Folder } from "lucide-react";
import ResourcePanel from "@/components/resource-panel";
import { useInstancePath, getMcVersion, getModLoader } from "@/hooks/use-instance-path";
import { useResourceManager } from "@/hooks/use-resource-manager";
import { useLaunchContext } from "@/components/launch/launch-provider";
import { fadeSlideUp } from "@/lib/motion";

/**
 * 资源管理页面的配置
 *
 * 所有资源管理页面（模组 / 资源包 / 光影包 / 数据包 / 存档）都
 * 可以通过这个配置 + createResourcePage 工厂函数生成，避免
 * 90% 的样板代码重复。
 */
export interface ResourcePageConfig {
  /** 左列标题 */
  title: string;
  /** 左列图标 */
  leftIcon: React.ReactNode;
  /** 左列图标背景色样式类（如 "bg-emerald-500/10"） */
  leftIconBg: string;
  /** 左列图标颜色样式类（如 "text-emerald-500"） */
  leftIconColor: string;
  /** 实例目录中的子文件夹名（如 "mods" / "resourcepacks" / "shaderpacks" / "datapacks" / "saves"） */
  instanceSubdir: string;
  /** 后端 cache kind 字符串（如 "mod" / "resourcepack" / "shaderpack" / "datapack" / "world"） */
  cacheKind: string;
  /** 是否需要传 modLoader（仅 mods 需要） */
  needsModLoader?: boolean;
  /**
   * 版本信息来源：
   * - "instance": 从 selectedInstance 读取（instance-settings 页面）
   * - "config": 从启动配置 config 读取（game-settings 页面，默认）
   */
  versionSource?: "instance" | "config";
  /** 允许通过的文件扩展名（小写，不含点） */
  extensions: string[];
  /** 从文件名中去除扩展名的函数（用于简化显示） */
  simplifyName: (name: string) => string;
  /** 右列图标（默认：文件夹图标） */
  rightIcon?: React.ReactNode;
  /** 右列图标背景色 */
  rightIconBg?: string;
}

/**
 * 扩展的返回接口（供 mods 页面额外消费的 modInfo 数据）
 */
export interface ResourcePageExtra {
  instanceModInfo: Map<string, any>;
  cacheModInfo: Map<string, any>;
  mcVersion: string | undefined;
  modLoader: string | undefined;
  instanceDir: string | undefined;
  minecraftPath: string | undefined;
  versionName: string;
  instanceFiles: { name: string; size: number }[];
  cacheFiles: { name: string; size: number }[];
  addToInstance: (fileName: string) => Promise<void>;
  removeFromInstance: (fileName: string) => Promise<void>;
  deleteFromInstance: (fileName: string) => Promise<void>;
  deleteFromCache: (fileName: string) => Promise<void>;
  renameInInstance: (oldName: string, newName: string) => Promise<void>;
  refresh: () => void;
}

/**
 * 生成一个资源管理页面组件（基础版本，无详情页）。
 *
 * 用于资源包 / 光影包 / 数据包 / 存档等普通页面。
 */
export function createResourcePage(config: ResourcePageConfig): React.FC {
  const {
    title,
    leftIcon,
    leftIconBg,
    instanceSubdir,
    cacheKind,
    needsModLoader = false,
    versionSource = "config",
    extensions,
    simplifyName,
    rightIcon,
    rightIconBg = "bg-emerald-500/10",
  } = config;

  const Component: React.FC = () => {
    const { config: launcherConfig } = useLaunchContext();
    const { instanceDir, selectedInstance, minecraftPath, configLoaded } = useInstancePath();

    // 根据 versionSource 决定版本信息的来源
    const versionName =
      versionSource === "instance"
        ? selectedInstance?.name || "未选择版本"
        : launcherConfig.versionName || "未选择版本";
    const mcVersion =
      versionSource === "instance"
        ? selectedInstance?.minecraft_version
        : getMcVersion(selectedInstance, launcherConfig.versionName);
    const modLoader = needsModLoader
      ? versionSource === "instance"
        ? selectedInstance?.loader
        : getModLoader(
            selectedInstance,
            launcherConfig.loadType,
            launcherConfig.loadName,
            launcherConfig.versionName,
          )
      : undefined;

    const {
      filteredInstanceFiles,
      filteredCacheFiles,
      instanceLoading,
      cacheLoading,
      instanceError,
      cacheError,
      addToInstance,
      removeFromInstance,
      deleteFromInstance,
      deleteFromCache,
      uploadFiles,
      refresh,
      instanceSearch,
      setInstanceSearch,
      cacheSearch,
      setCacheSearch,
      instanceFiles,
      cacheFiles,
    } = useResourceManager(
      instanceDir,
      instanceSubdir,
      cacheKind,
      mcVersion,
      modLoader,
      extensions,
    );

    if (!configLoaded) {
      return (
        <motion.div
          variants={fadeSlideUp}
          initial="initial"
          animate="animate"
          className="flex h-full flex-col items-center justify-center gap-3 text-center p-4"
        >
          <div className="size-12 rounded-full bg-muted flex items-center justify-center">
            <Package className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">正在加载配置...</p>
          <p className="text-xs text-muted-foreground">请稍候</p>
        </motion.div>
      );
    }

    if (!minecraftPath || (versionSource === "instance" && !instanceDir)) {
      return (
        <motion.div
          variants={fadeSlideUp}
          initial="initial"
          animate="animate"
          className="flex h-full flex-col items-center justify-center gap-3 text-center p-4"
        >
          <div className="size-12 rounded-full bg-muted flex items-center justify-center">
            <Package className="size-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">未配置游戏目录</p>
          <p className="text-xs text-muted-foreground">
            {versionSource === "instance"
              ? "请先选择一个实例"
              : "请先在「启动」页面配置 Minecraft 游戏目录"}
          </p>
        </motion.div>
      );
    }

    const description =
      versionSource === "instance"
        ? selectedInstance
          ? [
              selectedInstance.name,
              ...(modLoader ? [modLoader] : []),
              ...(mcVersion ? [`MC ${mcVersion}`] : []),
            ].join(" · ")
          : "请选择一个实例"
        : [
            `版本: ${versionName}`,
            ...(modLoader ? [modLoader] : []),
            ...(mcVersion && mcVersion !== versionName ? [`原版: ${mcVersion}`] : []),
          ].join(" · ");

    return (
      <ResourcePanel
        leftTitle={title}
        leftDescription={description}
        leftIcon={leftIcon}
        leftIconBg={leftIconBg}
        leftFiles={filteredInstanceFiles}
        leftLoading={instanceLoading}
        leftError={instanceError}
        leftSearch={instanceSearch}
        setLeftSearch={setInstanceSearch}
        leftBadge={`${instanceFiles.length} 个`}
        rightTitle=""
        rightIcon={rightIcon || <Folder className="size-5 text-emerald-500" />}
        rightIconBg={rightIconBg}
        rightFiles={filteredCacheFiles}
        rightLoading={cacheLoading}
        rightError={cacheError}
        rightSearch={cacheSearch}
        setRightSearch={setCacheSearch}
        rightBadge={`${cacheFiles.length} 个`}
        onMoveRightToLeft={addToInstance}
        onMoveLeftToRight={removeFromInstance}
        onDeleteLeft={deleteFromInstance}
        onDeleteRight={deleteFromCache}
        onRefresh={refresh}
        onUploadFiles={uploadFiles}
        simplifyName={simplifyName}
      />
    );
  };

  Component.displayName = `ResourcePage(${config.cacheKind})`;
  return Component;
}

/**
 * 用工厂方式调用 useResourceManager（供 mods 页面复用，它有额外的详情页）。
 * 返回完整的 hook 数据 + 页面配置信息，页面组件自行处理渲染分支。
 */
export function useResourcePage(config: ResourcePageConfig): {
  panel: Omit<
    React.ComponentProps<typeof ResourcePanel>,
    "leftTitle" | "leftIcon" | "leftIconBg" | "rightIcon" | "rightIconBg"
  > & {
    leftTitle: string;
    leftIcon: React.ReactNode;
    leftIconBg: string;
    leftDescription: string;
    rightIcon: React.ReactNode;
    rightIconBg: string;
    rightTitle: string;
  };
  loadingState: { configLoaded: boolean; minecraftPath: string | undefined; instanceDir: string | undefined };
  extra: ResourcePageExtra;
} {
  const {
    title,
    leftIcon,
    leftIconBg,
    instanceSubdir,
    cacheKind,
    needsModLoader = false,
    versionSource = "config",
    extensions,
    simplifyName,
    rightIcon,
    rightIconBg = "bg-emerald-500/10",
  } = config;

  const { config: launcherConfig } = useLaunchContext();
  const { instanceDir, selectedInstance, minecraftPath, configLoaded } = useInstancePath();

  const versionName =
    versionSource === "instance"
      ? selectedInstance?.name || "未选择版本"
      : launcherConfig.versionName || "未选择版本";
  const mcVersion =
    versionSource === "instance"
      ? selectedInstance?.minecraft_version
      : getMcVersion(selectedInstance, launcherConfig.versionName);
  const modLoader = needsModLoader
    ? versionSource === "instance"
      ? selectedInstance?.loader
      : getModLoader(
          selectedInstance,
          launcherConfig.loadType,
          launcherConfig.loadName,
          launcherConfig.versionName,
        )
    : undefined;

  const manager = useResourceManager(
    instanceDir,
    instanceSubdir,
    cacheKind,
    mcVersion,
    modLoader,
    extensions,
  );

  const description =
    versionSource === "instance"
      ? selectedInstance
        ? [
            selectedInstance.name,
            ...(modLoader ? [modLoader] : []),
            ...(mcVersion ? [`MC ${mcVersion}`] : []),
          ].join(" · ")
        : "请选择一个实例"
      : [
          `版本: ${versionName}`,
          ...(modLoader ? [modLoader] : []),
          ...(mcVersion && mcVersion !== versionName ? [`原版: ${mcVersion}`] : []),
        ].join(" · ");

  return {
    panel: {
      leftTitle: title,
      leftDescription: description,
      leftIcon,
      leftIconBg,
      leftFiles: manager.filteredInstanceFiles,
      leftLoading: manager.instanceLoading,
      leftError: manager.instanceError,
      leftSearch: manager.instanceSearch,
      setLeftSearch: manager.setInstanceSearch,
      leftBadge: `${manager.instanceFiles.length} 个`,
      leftModInfo: manager.instanceModInfo,
      rightTitle: "",
      rightIcon: rightIcon || <Folder className="size-5 text-emerald-500" />,
      rightIconBg,
      rightFiles: manager.filteredCacheFiles,
      rightLoading: manager.cacheLoading,
      rightError: manager.cacheError,
      rightSearch: manager.cacheSearch,
      setRightSearch: manager.setCacheSearch,
      rightBadge: `${manager.cacheFiles.length} 个`,
      rightModInfo: manager.cacheModInfo,
      onMoveRightToLeft: manager.addToInstance,
      onMoveLeftToRight: manager.removeFromInstance,
      onDeleteLeft: manager.deleteFromInstance,
      onDeleteRight: manager.deleteFromCache,
      onRenameLeft: manager.renameInInstance,
      onRefresh: manager.refresh,
      onUploadFiles: manager.uploadFiles,
      simplifyName,
    },
    loadingState: { configLoaded, minecraftPath, instanceDir },
    extra: {
      instanceModInfo: manager.instanceModInfo,
      cacheModInfo: manager.cacheModInfo,
      mcVersion,
      modLoader,
      instanceDir,
      minecraftPath,
      versionName,
      instanceFiles: manager.instanceFiles,
      cacheFiles: manager.cacheFiles,
      addToInstance: manager.addToInstance,
      removeFromInstance: manager.removeFromInstance,
      deleteFromInstance: manager.deleteFromInstance,
      deleteFromCache: manager.deleteFromCache,
      renameInInstance: manager.renameInInstance,
      refresh: manager.refresh,
    },
  };
}

/**
 * 通用的加载/未配置 fallback 页面
 */
export function ResourcePageFallback({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <motion.div
      variants={fadeSlideUp}
      initial="initial"
      animate="animate"
      className="flex h-full flex-col items-center justify-center gap-3 text-center p-4"
    >
      <div className="size-12 rounded-full bg-muted flex items-center justify-center">
        <Package className="size-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </motion.div>
  );
}