"use client";

import React from "react";
import { motion } from "framer-motion";
import { Boxes, Folder, Package } from "lucide-react";
import ResourcePanel from "@/components/resource-panel";
import { useInstancePath } from "@/hooks/use-instance-path";
import { useResourceManager } from "@/hooks/use-resource-manager";
import { fadeSlideUp } from "@/lib/motion";

export default function SchematicsPage() {
  const { instanceDir, selectedInstance, minecraftPath, configLoaded } = useInstancePath();

  const {
    filteredInstanceFiles,
    filteredCacheFiles,
    instanceLoading,
    cacheLoading,
    instanceError,
    cacheError,
    addToInstance,
    removeFromInstance,
    refresh,
    instanceSearch,
    setInstanceSearch,
    cacheSearch,
    setCacheSearch,
    instanceFiles,
    cacheFiles,
    openInstanceDirectory,
    goToParentInstanceDirectory,
    instanceDirectoryPath,
  } = useResourceManager(
    instanceDir,
    "schematics",
    "world",
    selectedInstance?.minecraft_version,
    undefined,
    ["schem", "schematic", "litematic", "nbt"],
    true,
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

  if (!minecraftPath || !instanceDir) {
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
        <p className="text-xs text-muted-foreground">请先在「启动」页面配置游戏目录路径</p>
      </motion.div>
    );
  }

  return (
    <ResourcePanel
      leftTitle="Schematics 管理"
      leftDescription={
        selectedInstance
          ? `${selectedInstance.name} · ${instanceFiles.length} 个文件`
          : "请选择一个实例"
      }
      leftIcon={<Boxes className="size-5 text-rose-500" />}
      leftIconBg="bg-rose-500/10"
      leftFiles={filteredInstanceFiles}
      leftLoading={instanceLoading}
      leftError={instanceError}
      leftSearch={instanceSearch}
      setLeftSearch={setInstanceSearch}
      leftBadge={`${instanceFiles.length} 个`}
      leftDirectoryPath={instanceDirectoryPath}
      onOpenLeftDirectory={openInstanceDirectory}
      onNavigateUpLeft={goToParentInstanceDirectory}
      rightTitle=""
      rightIcon={<Folder className="size-5 text-sky-500" />}
      rightIconBg="bg-sky-500/10"
      rightFiles={filteredCacheFiles}
      rightLoading={cacheLoading}
      rightError={cacheError}
      rightSearch={cacheSearch}
      setRightSearch={setCacheSearch}
      rightBadge={`${cacheFiles.length} 个`}
      onMoveRightToLeft={addToInstance}
      onMoveLeftToRight={removeFromInstance}
      onRefresh={refresh}
    />
  );
}
