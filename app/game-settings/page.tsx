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
import { useI18n, type Translation } from "@/components/i18n/use-i18n";

/**
 * 设置入口按钮（黑白简约风格）
 */
const SETTING_CARDS = [
  {
    href: "/game-settings/mods",
    title: { "zh-CN": "模组管理", "en-US": "Mods" } as Translation,
    description: { "zh-CN": "添加、移除、管理模组", "en-US": "Add, remove, and manage mods" } as Translation,
    icon: Puzzle,
  },
  {
    href: "/game-settings/resources",
    title: { "zh-CN": "资源包", "en-US": "Resource Packs" } as Translation,
    description: { "zh-CN": "切换和管理材质资源包", "en-US": "Switch and manage texture resource packs" } as Translation,
    icon: ImageIcon,
  },
  {
    href: "/game-settings/worlds",
    title: { "zh-CN": "存档", "en-US": "Worlds" } as Translation,
    description: { "zh-CN": "管理你的世界存档", "en-US": "Manage your world saves" } as Translation,
    icon: Map,
  },
  {
    href: "/game-settings/shaders",
    title: { "zh-CN": "光影包", "en-US": "Shaders" } as Translation,
    description: { "zh-CN": "配置光影效果和着色器", "en-US": "Configure shader effects and shaders" } as Translation,
    icon: Layers,
  },
  {
    href: "/game-settings/datapacks",
    title: { "zh-CN": "数据包", "en-US": "Datapacks" } as Translation,
    description: { "zh-CN": "管理 Minecraft 数据包", "en-US": "Manage Minecraft datapacks" } as Translation,
    icon: Database,
  },
  {
    href: "/game-settings/schematics",
    title: { "zh-CN": "投影原理图", "en-US": "Schematics" } as Translation,
    description: { "zh-CN": "管理建筑原理图文件", "en-US": "Manage building schematic files" } as Translation,
    icon: Box,
  },
  {
    href: "/game-settings/screenshots",
    title: { "zh-CN": "截图", "en-US": "Screenshots" } as Translation,
    description: { "zh-CN": "浏览游戏内保存的截图", "en-US": "View screenshots saved in-game" } as Translation,
    icon: Camera,
  },
];

const SETTING_CARD_CLASS =
  "flex h-40 w-40 shrink-0 flex-col items-center justify-center gap-3 rounded-2xl border-[3px] border-border bg-card/40 transition-all hover:-translate-y-0.5 hover:border-foreground/50 hover:bg-accent/40 active:bg-accent/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50";

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
  const { t } = useI18n();
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const versionName = config.versionName || t({ "zh-CN": "点击选择版本", "en-US": "Click to select version" });
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
      alert(t({ "zh-CN": "请先选择要删除的版本", "en-US": "Please select a version to delete first" }));
      return;
    }

    const confirmed = window.confirm(
      t({
        "zh-CN": `确认删除游戏版本目录「${effectiveVersionDirName}」？\n\n将删除：${config.minecraftPath}\\versions\\${effectiveVersionDirName}\n\n此操作不可撤销。`,
        "en-US": `Confirm deletion of game version directory "${effectiveVersionDirName}"?\n\nThis will delete: ${config.minecraftPath}\\versions\\${effectiveVersionDirName}\n\nThis action cannot be undone.`,
      })
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
      alert(t({ "zh-CN": `已删除版本目录：${effectiveVersionDirName}`, "en-US": `Deleted version directory: ${effectiveVersionDirName}` }));
    } catch (err) {
      alert(String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col h-full w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[1600px] flex-col gap-4 p-4 md:p-5">
        {/* 页面标题 — 可点击弹出版本选择框 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setVersionDialogOpen(true)}
            className="flex items-center gap-3 px-4 pt-3 pb-3 text-left flex-1 min-w-0 hover:bg-accent/30 transition-colors rounded-lg cursor-pointer focus:outline-none"
            title={t({ "zh-CN": "点击选择游戏版本", "en-US": "Click to select game version" })}
          >
            <div className="flex size-9 items-center justify-center rounded-xl bg-muted shrink-0 pointer-events-none">
              <Gamepad2 className="size-5 text-foreground" />
            </div>
            <div className="pointer-events-none min-w-0 flex-1 text-left">
              <h1 className="text-lg font-semibold leading-none truncate">{versionName}</h1>
              <p className="mt-1 text-xs text-muted-foreground truncate">
                {hasLoader ? config.loadName : t({ "zh-CN": "原版 · 无 ModLoader · 点击标题选择版本", "en-US": "Vanilla · No ModLoader · Click title to select version" })}
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
              title={t({ "zh-CN": "删除当前选中的游戏版本目录", "en-US": "Delete currently selected game version directory" })}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              <span className="text-xs">{t({ "zh-CN": "删除版本", "en-US": "Delete version" })}</span>
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
                  <p className="text-sm font-medium">{t({ "zh-CN": "请先点击上方标题选择游戏版本", "en-US": "Please click the title above to select a game version" })}</p>
                  <p className="text-xs text-muted-foreground">
                    {t({ "zh-CN": "配置完成后即可管理当前版本的模组、资源包等内容", "en-US": "After configuration, you can manage mods, resource packs, and more for the current version" })}
                  </p>
                </motion.div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  {/* 上面三个按钮 */}
                  <div className="flex justify-center gap-3 w-full">
                    {SETTING_CARDS.slice(0, 3).map((card) => {
                      const Icon = card.icon;
                      return (
                        <Link
                          key={card.href}
                          href={card.href}
                          suppressHydrationWarning
                          className={SETTING_CARD_CLASS}
                        >
                          <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
                            <Icon className="size-5 text-foreground" />
                          </div>
                          <h3 className="text-sm font-semibold leading-tight text-center">{t(card.title)}</h3>
                          <p className="text-xs text-muted-foreground text-center leading-tight px-2">
                            {t(card.description)}
                          </p>
                        </Link>
                      );
                    })}
                  </div>

                  {/* 下面四个按钮 */}
                  <div className="flex justify-center gap-3 w-full">
                    {SETTING_CARDS.slice(3, 7).map((card) => {
                      const Icon = card.icon;
                      return (
                        <Link
                          key={card.href}
                          href={card.href}
                          suppressHydrationWarning
                          className={SETTING_CARD_CLASS}
                        >
                          <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
                            <Icon className="size-5 text-foreground" />
                          </div>
                          <h3 className="text-sm font-semibold leading-tight text-center">{t(card.title)}</h3>
                          <p className="text-xs text-muted-foreground text-center leading-tight px-2">
                            {t(card.description)}
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
              suppressHydrationWarning
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-card/30 hover:bg-accent/40 active:bg-accent/70 transition-all hover:border-foreground/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50 text-sm font-medium"
            >
              <Package className="size-4" />
              <span>{t({ "zh-CN": "进入整合包管理", "en-US": "Go to Modpack Management" })}</span>
              <ChevronRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* 版本选择对话框 */}
      <VersionSelectorDialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen} />
    </div>
  );
}
