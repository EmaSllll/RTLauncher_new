"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Search, ArrowRight, RefreshCw, Plus, Trash2, Edit3, Check, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fadeSlideUp, staggerContainer, staggerItem } from "@/lib/motion";

/**
 * 模组依赖项信息
 */
export interface ModDependency {
  mod_id: string;
  version_range?: string | null;
  mandatory: boolean;
  ordering?: string | null;
  side?: string | null;
}

/**
 * 模组完整元数据信息
 */
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
 * 通用的两列资源管理页面布局
 *
 * 左列：已加入实例的文件
 * 右列：cache 中对应版本的文件（可加入）
 */

export interface FileItem {
  name: string;
  size: number;
}

export interface ResourcePanelProps {
  // 左列
  leftTitle: string;
  leftDescription?: string;
  leftIcon: React.ReactNode;
  leftIconBg: string;
  leftFiles: FileItem[];
  leftLoading: boolean;
  leftError: string | null;
  leftSearch: string;
  setLeftSearch: (s: string) => void;
  leftBadge?: string;
  // 左列模组元数据缓存
  leftModInfo?: Map<string, ModInfo>;
  // 右列
  rightTitle: string;
  rightDescription?: string;
  rightIcon: React.ReactNode;
  rightIconBg: string;
  rightFiles: FileItem[];
  rightLoading: boolean;
  rightError: string | null;
  rightSearch: string;
  setRightSearch: (s: string) => void;
  rightBadge?: string;
  // 右列模组元数据缓存
  rightModInfo?: Map<string, ModInfo>;
  // 模组详情页回调（点击文件名时调用）
  onOpenModDetail?: (fileName: string, info: ModInfo) => void;
  // 操作
  onMoveRightToLeft?: (fileName: string) => Promise<void>; // 加入实例（cache -> 实例）
  onMoveLeftToRight?: (fileName: string) => Promise<void>; // 移出实例（实例 -> cache）
  onDeleteLeft?: (fileName: string) => Promise<void>; // 从实例中删除
  onDeleteRight?: (fileName: string) => Promise<void>; // 从 cache 中删除
  onRenameLeft?: (oldName: string, newName: string) => Promise<void>; // 重命名实例中的文件
  onRefresh?: () => void;
  // 文件上传回调
  onUploadFiles?: () => Promise<void>;
  // 文件名简化（可选回调）
  simplifyName?: (name: string) => string;
  // 文件副标题（可选回调）- 从文件名或其他信息生成的描述
  getFileSubtitle?: (file: FileItem) => string;
}

export default function ResourcePanel({
  leftTitle,
  leftDescription,
  leftIcon,
  leftIconBg,
  leftFiles,
  leftLoading,
  leftError,
  leftSearch,
  setLeftSearch,
  leftBadge,
  leftModInfo,
  rightTitle,
  rightDescription,
  rightIcon,
  rightIconBg,
  rightFiles,
  rightLoading,
  rightError,
  rightSearch,
  setRightSearch,
  rightBadge,
  rightModInfo,
  onOpenModDetail,
  onMoveRightToLeft,
  onMoveLeftToRight,
  onDeleteLeft,
  onDeleteRight,
  onRenameLeft,
  onRefresh,
  onUploadFiles,
  simplifyName,
  getFileSubtitle,
}: ResourcePanelProps) {
  // 先做 URL decode（%20 -> 空格 等），再应用用户自定义的 simplifyName
  const decodeUrlName = (s: string): string => {
    try {
      return decodeURIComponent(s.replace(/\+/g, " "));
    } catch {
      return s;
    }
  };
  const simplify = simplifyName
    ? (n: string) => simplifyName(decodeUrlName(n))
    : (n: string) => decodeUrlName(n);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const handleStartRename = (name: string) => {
    setRenamingName(name);
    setRenameValue(name);
  };

  const handleCancelRename = () => {
    setRenamingName(null);
    setRenameValue("");
  };

  const handleConfirmRename = async () => {
    if (!renamingName || !onRenameLeft) return;
    if (!renameValue.trim()) return;
    try {
      await onRenameLeft(renamingName, renameValue.trim());
    } catch (e) {
      console.error("重命名失败:", e);
    }
    setRenamingName(null);
    setRenameValue("");
  };

  const handleOpenDetail = (file: FileItem, infoMap?: Map<string, ModInfo>) => {
    if (!onOpenModDetail) return;
    if (infoMap && infoMap.size > 0) {
      const info = infoMap.get(file.name);
      if (info) {
        onOpenModDetail(file.name, info);
        return;
      }
    }
    // 如果没有模组信息或Map为空，仍然调用回调（用于存档等非模组页面）
    onOpenModDetail(file.name, {} as ModInfo);
  };

  const renderFileList = (
    files: FileItem[],
    loading: boolean,
    error: string | null,
    emptyIcon: React.ReactNode,
    emptyText: string,
    side: "left" | "right", // 左列(实例)或右列(cache)
    moveHandler: ((fileName: string) => Promise<void>) | undefined,
    deleteHandler: ((fileName: string) => Promise<void>) | undefined,
    canRename: boolean,
    modInfoMap?: Map<string, ModInfo>,
  ) => {
    if (loading) {
      return (
        <div className="space-y-2 px-1">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      );
    }
    if (error) {
      return (
        <motion.div
          variants={fadeSlideUp}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center justify-center gap-2 p-6 text-center"
        >
          <p className="text-sm text-destructive">读取失败</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </motion.div>
      );
    }
    if (files.length === 0) {
      return (
        <motion.div
          variants={fadeSlideUp}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <div className="size-12 rounded-full bg-muted flex items-center justify-center">{emptyIcon}</div>
          <p className="text-sm font-medium">{emptyText}</p>
        </motion.div>
      );
    }
    return (
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-1">
        {files.map((file) => {
          const info = modInfoMap?.get(file.name);
          const displayName = info?.name && info.name !== file.name
            ? info.name // 优先显示模组名称
            : simplify(file.name);
          const subtitle = info
            ? [
                `v${info.version}`,
                info.mod_id,
                info.authors.length > 0 ? info.authors.slice(0, 2).join(", ") : null,
              ].filter(Boolean).join(" · ")
            : (getFileSubtitle ? getFileSubtitle(file) : formatSize(file.size));
          const hasDetail = !!onOpenModDetail;

          return (
            <motion.div
              key={file.name}
              variants={staggerItem}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/50 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                {canRename && renamingName === file.name ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="h-7 text-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleConfirmRename();
                        if (e.key === "Escape") handleCancelRename();
                      }}
                    />
                    <Button variant="ghost" size="icon" className="size-7" onClick={handleConfirmRename}>
                      <Check className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={handleCancelRename}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <p
                      className="text-sm font-bold truncate"
                      title={file.name}
                    >
                      {displayName}
                    </p>
                    {subtitle && (
                      <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                    )}
                  </>
                )}
              </div>

              {/* 操作按钮组 - 只有在不是重命名模式时才显示 */}
              {!(canRename && renamingName === file.name) && (
                <div className="flex items-center gap-1 shrink-0">
                  {/* 查看详情（模组专用）- "!" 字符按钮 */}
                  {hasDetail && (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDetail(file, modInfoMap);
                      }}
                      title="查看详细信息"
                    >
                      <Info className="size-3.5" />
                    </Button>
                  )}

                  {/* 重命名（仅左列） */}
                  {canRename && onRenameLeft && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleStartRename(file.name)}
                      title="重命名"
                    >
                      <Edit3 className="size-3.5" />
                    </Button>
                  )}

                  {/* 移动按钮 - 仅图标，无文字，加粗效果 */}
                  {moveHandler && (
                    <Button
                      variant={side === "right" ? "default" : "secondary"}
                      size="icon"
                      className={`size-7 ${side === "right" ? "font-bold" : ""}`}
                      onClick={() => moveHandler(file.name)}
                      title={side === "right" ? "加入实例" : "移出实例"}
                    >
                      {side === "right" ? (
                        <Plus className="size-3.5" />
                      ) : (
                        <ArrowRight className="size-3.5" />
                      )}
                    </Button>
                  )}

                  {/* 删除按钮 */}
                  {deleteHandler && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm(`确定删除 "${simplify(file.name)}" 吗？`)) {
                          deleteHandler(file.name);
                        }
                      }}
                      title="删除"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </motion.div>
    );
  };

  const leftEmptyIcon = React.cloneElement(leftIcon as any, { className: "size-6 text-muted-foreground" });
  const rightEmptyIcon = React.cloneElement(rightIcon as any, { className: "size-6 text-muted-foreground" });

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      {/* 标题栏 */}
      <motion.div
        variants={fadeSlideUp}
        initial="initial"
        animate="animate"
        className="flex items-center gap-3 shrink-0"
      >
        <div className={`flex size-9 items-center justify-center rounded-xl ${leftIconBg}`}>{leftIcon}</div>
        <div>
          <h1 className="text-lg font-semibold leading-none">{leftTitle}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{leftDescription || ""}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onUploadFiles && (
            <Button variant="default" size="icon" className="size-8" onClick={onUploadFiles} title="上传文件">
              <Plus className="size-3.5" />
            </Button>
          )}
          {onRefresh && (
            <Button variant="ghost" size="icon" className="size-8" onClick={onRefresh} title="刷新">
              <RefreshCw className="size-3.5" />
            </Button>
          )}
        </div>
      </motion.div>

      {/* 两列内容区 */}
      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
        {/* 左列：实例中的文件 */}
        <motion.div
          variants={fadeSlideUp}
          initial="initial"
          animate="animate"
          className="flex-1 flex flex-col border rounded-xl bg-card overflow-hidden min-w-0"
        >
          <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b">
            <div className={`flex size-7 items-center justify-center rounded-lg ${leftIconBg}`}>
              {React.cloneElement(leftIcon as any, { className: "size-3.5 text-current" })}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold leading-tight">当前实例中</h2>
              <p className="text-xs text-muted-foreground truncate">已加入的文件</p>
            </div>
            {leftBadge && <Badge variant="secondary" className="text-xs shrink-0">{leftBadge}</Badge>}
            <div className="relative w-40 shrink-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={leftSearch}
                onChange={(e) => setLeftSearch(e.target.value)}
                placeholder="搜索..."
                className="pl-7 h-7 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {renderFileList(
              leftFiles,
              leftLoading,
              leftError,
              leftEmptyIcon,
              "暂无文件",
              "left",
              onMoveLeftToRight,
              onDeleteLeft,
              true,
              leftModInfo,
            )}
          </div>
        </motion.div>

        {/* 右列：cache 中的文件 */}
        <motion.div
          variants={fadeSlideUp}
          initial="initial"
          animate="animate"
          className="flex-1 flex flex-col border rounded-xl bg-card overflow-hidden min-w-0"
        >
          <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b">
            <div className={`flex size-7 items-center justify-center rounded-lg ${rightIconBg}`}>
              {React.cloneElement(rightIcon as any, { className: "size-3.5 text-current" })}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold leading-tight">Cache 库</h2>
              <p className="text-xs text-muted-foreground truncate">对应版本 · 可加入</p>
            </div>
            {rightBadge && <Badge variant="secondary" className="text-xs shrink-0">{rightBadge}</Badge>}
            <div className="relative w-40 shrink-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={rightSearch}
                onChange={(e) => setRightSearch(e.target.value)}
                placeholder="搜索..."
                className="pl-7 h-7 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {renderFileList(
              rightFiles,
              rightLoading,
              rightError,
              rightEmptyIcon,
              "暂无可用文件",
              "right",
              onMoveRightToLeft,
              onDeleteRight,
              false,
              rightModInfo,
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}