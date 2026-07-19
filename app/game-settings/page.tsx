"use client";

import { useState } from "react";
import Link from "next/link";
import { invoke } from "@tauri-apps/api/core";
import {
  Gamepad2,
  Puzzle,
  Image as ImageIcon,
  Box,
  Map,
  Layers,
  Database,
  Camera,
  Package,
  ChevronRight,
  Trash2,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { useLaunchContext } from "@/components/launch/launch-provider";
import { VersionSelectorDialog } from "@/components/launch/version-selector-dialog";
import { fadeSlideUp } from "@/lib/motion";
import { Button } from "@/components/ui/button";

/**
 * 设置入口按钮（黑白简约风格）
 */
const SETTING_CARDS = [
  {
    href: "/game-settings/mods",
    title: "模组管理",
    description: "添加、移除、管理模组",
    icon: Puzzle,
  },
  {
    href: "/game-settings/resources",
    title: "资源包",
    description: "切换和管理材质资源包",
    icon: ImageIcon,
  },
  {
    href: "/game-settings/worlds",
    title: "存档",
    description: "管理你的世界存档",
    icon: Map,
  },
  {
    href: "/game-settings/shaders",
    title: "光影包",
    description: "配置光影效果和着色器",
    icon: Layers,
  },
  {
    href: "/game-settings/datapacks",
    title: "数据包",
    description: "管理 Minecraft 数据包",
    icon: Database,
  },
  {
    href: "/game-settings/schematics",
    title: "投影原理图",
    description: "管理建筑原理图文件",
    icon: Box,
  },
  {
    href: "/game-settings/screenshots",
    title: "截图",
    description: "浏览游戏内保存的截图",
    icon: Camera,
  },
];

/**
 * 游戏设置页面
 * 布局：
 *   ┌─────────────────────────────────────────────────┐
 *   │  标题（可点击选择版本）                          │
 *   │                                                 │
 *   │  ┌─────────────────────────────────────────┐    │
 *   │  │  [模组] [资源包] [存档] [光影] ...      │    │  ← 横向一排等大按钮
 *   │  │  统一圆角长方形，黑白简约                │    │
 *   │  └─────────────────────────────────────────┘    │
 *   │                                                 │
 *   │  [ 进入整合包管理 → ]                           │  ← 底部页面切换按钮
 *   └─────────────────────────────────────────────────┘
 */
export default function GameSettings() {
  const { config, updateConfig } = useLaunchContext();
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const versionName = config.versionName || "点击选择版本";
  const hasLoader = config.loadType !== "0" && config.loadName;
  const isConfigured = !!config.minecraftPath && !!config.versionName;

  // 当前实际的版本目录名：modloader 时用 loadName，原版时用 versionName
  const effectiveVersionDirName =
    config.loadType !== "0" && config.loadName
      ? config.loadName
      : config.versionName;

  async function handleDeleteVersion(e: React.MouseEvent) {
    e.stopPropagation();
    if (!config.minecraftPath || !effectiveVersionDirName) {
      alert("请先选择要删除的版本");
      return;
    }

    const confirmed = window.confirm(
      `确认删除游戏版本目录「${effectiveVersionDirName}」？\n\n将删除：${config.minecraftPath}\\versions\\${effectiveVersionDirName}\n\n此操作不可撤销。`
    );
    if (!confirmed) return;

    try {
      setDeleting(true);
      await invoke("delete_version_dir_cmd", {
        minecraftPath: config.minecraftPath,
        versionName: effectiveVersionDirName,
      });
      // 删除成功：清空当前选择的版本配置
      updateConfig({
        versionName: "",
        loadType: "0",
        loadName: "",
      });
      setVersionDialogOpen(false);
      alert(`已删除版本目录：${effectiveVersionDirName}`);
    } catch (err) {
      alert(String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* 页面标题 — 可点击弹出版本选择框 */}
      <div className="flex items-center gap-2 shrink-0 mx-2 mt-2">
        <button
          type="button"
          onClick={() => setVersionDialogOpen(true)}
          className="flex items-center gap-3 px-4 pt-3 pb-3 text-left flex-1 min-w-0 hover:bg-accent/30 transition-colors rounded-lg cursor-pointer focus:outline-none"
          title="点击选择游戏版本"
        >
          <div className="flex size-9 items-center justify-center rounded-xl bg-muted shrink-0 pointer-events-none">
            <Gamepad2 className="size-5 text-foreground" />
          </div>
          <div className="pointer-events-none min-w-0 flex-1 text-left">
            <h1 className="text-lg font-semibold leading-none truncate">{versionName}</h1>
            <p className="mt-1 text-xs text-muted-foreground truncate">
              {hasLoader ? config.loadName : "原版 · 无 ModLoader · 点击标题选择版本"}
            </p>
          </div>
        </button>
        {isConfigured && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 hover:text-red-500 hover:border-red-500/50"
            onClick={handleDeleteVersion}
            disabled={deleting}
            title="删除当前选中的游戏版本目录"
          >
            {deleting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            <span className="text-xs">删除版本</span>
          </Button>
        )}
      </div>

      {/* 主体内容 — 垂直分布：上方留白 · 中间按钮横排 · 下方留白 · 底部切换按钮 */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* 顶部留白 */}
        <div className="flex-shrink-0 h-10"></div>

        {/* 中间：设置入口按钮（上面三个下面四个） */}
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full">
            {!isConfigured ? (
              <motion.div
                variants={fadeSlideUp}
                initial="initial"
                animate="animate"
                className="flex flex-col items-center justify-center gap-3 text-center py-8"
              >
                <div className="size-12 rounded-full bg-muted flex items-center justify-center">
                  <Gamepad2 className="size-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">请先点击上方标题选择游戏版本</p>
                <p className="text-xs text-muted-foreground">
                  配置完成后即可管理当前版本的模组、资源包等内容
                </p>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                {/* 上面三个按钮 */}
                <div className="flex items-stretch justify-center gap-3 w-full max-w-[600px]">
                  {SETTING_CARDS.slice(0, 3).map((card) => {
                    const Icon = card.icon;
                    return (
                      <Link
                        key={card.href}
                        href={card.href}
                        className="flex flex-col items-center justify-center gap-3 flex-1 min-w-[140px] max-w-[200px] h-[180px] rounded-2xl border-[3px] border-border bg-card/40 hover:bg-accent/40 active:bg-accent/70 transition-all hover:border-foreground/50 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50"
                      >
                        <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
                          <Icon className="size-6 text-foreground" />
                        </div>
                        <h3 className="text-base font-semibold leading-tight text-center">{card.title}</h3>
                        <p className="text-xs text-muted-foreground text-center leading-tight px-2">
                          {card.description}
                        </p>
                      </Link>
                    );
                  })}
                </div>

                {/* 下面四个按钮 */}
                <div className="flex items-stretch justify-center gap-3 w-full max-w-[700px]">
                  {SETTING_CARDS.slice(3, 7).map((card) => {
                    const Icon = card.icon;
                    return (
                      <Link
                        key={card.href}
                        href={card.href}
                        className="flex flex-col items-center justify-center gap-3 flex-1 min-w-[120px] max-w-[180px] h-[160px] rounded-2xl border-[3px] border-border bg-card/40 hover:bg-accent/40 active:bg-accent/70 transition-all hover:border-foreground/50 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50"
                      >
                        <div className="flex size-10 items-center justify-center rounded-xl bg-muted">
                          <Icon className="size-5 text-foreground" />
                        </div>
                        <h3 className="text-sm font-semibold leading-tight text-center">{card.title}</h3>
                        <p className="text-xs text-muted-foreground text-center leading-tight px-2">
                          {card.description}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部：右下角 · 跳转到整合包管理的按钮（距离底部有高度） */}
        <div className="shrink-0 flex justify-end px-4 pt-4 pb-8">
          <Link
            href="/game-settings/modpacks"
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-card/30 hover:bg-accent/40 active:bg-accent/70 transition-all hover:border-foreground/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50 text-sm font-medium"
          >
            <Package className="size-4" />
            <span>进入整合包管理</span>
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      {/* 版本选择对话框 */}
      <VersionSelectorDialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen} />
    </div>
  );
}