"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { INSTANCE_CARDS } from "@/constants/data";
import { cn } from "@/lib/utils";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useResourcePacks } from "@/hooks/use-resource-packs";
import { useDirFiles } from "@/hooks/use-dir-files";
import type { InstanceData } from "@/types";
import { useI18n, type Translation } from "@/components/i18n/use-i18n";

type InstanceCardGridProps = {
  instanceDir: string | undefined;
  selectedInstance: InstanceData | null;
};

const CARD_COPY: Record<string, { title: Translation; description: Translation; stats: Translation[] }> = {
  mods: {
    title: { "zh-CN": "Mods", "en-US": "Mods" },
    description: { "zh-CN": "模组管理中心", "en-US": "Manage your mods" },
    stats: [{ "zh-CN": "• 已安装：72个模组", "en-US": "• Installed: 72 mods" }, { "zh-CN": "• 更新可用：3个", "en-US": "• Updates available: 3" }, { "zh-CN": "• 配置文件编辑", "en-US": "• Edit configuration files" }],
  },
  worlds: {
    title: { "zh-CN": "世界", "en-US": "Worlds" },
    description: { "zh-CN": "存档管理", "en-US": "Manage world saves" },
    stats: [{ "zh-CN": "• 游戏存档：6个", "en-US": "• World saves: 6" }, { "zh-CN": "• 最近游戏：RTL World", "en-US": "• Recently played: RTL World" }, { "zh-CN": "• 自动备份", "en-US": "• Automatic backups" }],
  },
  resources: {
    title: { "zh-CN": "资源包", "en-US": "Resource Packs" },
    description: { "zh-CN": "游戏材质管理", "en-US": "Manage game textures" },
    stats: [{ "zh-CN": "• 当前使用：默认高清", "en-US": "• Current: Default HD" }, { "zh-CN": "• 已安装：4个包", "en-US": "• Installed: 4 packs" }, { "zh-CN": "• 资源包排序", "en-US": "• Resource pack order" }],
  },
  shaders: {
    title: { "zh-CN": "光影包", "en-US": "Shaders" },
    description: { "zh-CN": "视觉效果增强", "en-US": "Enhanced visual effects" },
    stats: [{ "zh-CN": "• 当前光影：BSL", "en-US": "• Current shader: BSL" }, { "zh-CN": "• 已安装：3个", "en-US": "• Installed: 3" }, { "zh-CN": "• 性能配置", "en-US": "• Performance settings" }],
  },
  screenshots: {
    title: { "zh-CN": "截图", "en-US": "Screenshots" },
    description: { "zh-CN": "游戏截图管理", "en-US": "Manage game screenshots" },
    stats: [{ "zh-CN": "• 总数：126张", "en-US": "• Total: 126" }, { "zh-CN": "• 最近截图：今天", "en-US": "• Latest screenshot: Today" }, { "zh-CN": "• 快速分享", "en-US": "• Quick sharing" }],
  },
  schematics: {
    title: { "zh-CN": "投影原理图", "en-US": "Schematics" },
    description: { "zh-CN": "结构设计管理", "en-US": "Manage building designs" },
    stats: [{ "zh-CN": "• 原理图：12个", "en-US": "• Schematics: 12" }, { "zh-CN": "• 最近使用：Redstone Castle", "en-US": "• Recently used: Redstone Castle" }, { "zh-CN": "• 快速部署", "en-US": "• Quick deployment" }],
  },
};

export function InstanceCardGrid({
  instanceDir,
  selectedInstance,
}: InstanceCardGridProps) {
  const { t } = useI18n();
  // mods count 来自 Rust 扫描结果
  const modsCount = selectedInstance?.mods_count;

  // 使用 useMemo 稳定化路径字符串，避免每次渲染都重新创建
  const savesPath = useMemo(() => (instanceDir ? `${instanceDir}/saves` : undefined), [instanceDir]);
  const shaderpacksPath = useMemo(() => (instanceDir ? `${instanceDir}/shaderpacks` : undefined), [instanceDir]);
  const screenshotsPath = useMemo(() => (instanceDir ? `${instanceDir}/screenshots` : undefined), [instanceDir]);
  const schematicsPath = useMemo(() => (instanceDir ? `${instanceDir}/schematics` : undefined), [instanceDir]);

  // 世界（saves/ 下的目录数）
  const { entries: worldEntries } = useDirFiles(savesPath);
  const worldCount = worldEntries.filter((e) => e.is_dir).length;
  const latestWorld = worldEntries.find((e) => e.is_dir)?.name;

  // 资源包
  const { packs: resourcePacks } = useResourcePacks(instanceDir ?? undefined);

  // 光影包（shaderpacks/）
  const { entries: shaderEntries } = useDirFiles(shaderpacksPath);

  // 截图
  const { entries: screenshotEntries } = useDirFiles(
    screenshotsPath,
    ["png", "jpg", "jpeg", "webp"]
  );

  // 投影原理图
  const { entries: schematicEntries } = useDirFiles(
    schematicsPath,
    ["schematic", "nbt", "litematic", "schem"]
  );

  /** 根据卡片 id 生成动态 stats，无数据时回退到 baseStats */
  const getDynamicStats = (cardId: string, baseStats: string[]): string[] => {
    switch (cardId) {
      case "mods":
        if (modsCount != null)
          return [t({ "zh-CN": `• 已安装：${modsCount} 个模组`, "en-US": `• Installed: ${modsCount} mods` }), ...baseStats.slice(1)];
        break;
      case "worlds":
        if (instanceDir) {
          const countStr = `${worldCount}`;
          const recent = latestWorld ? t({ "zh-CN": `• 最近游戏：${latestWorld}`, "en-US": `• Recently played: ${latestWorld}` }) : baseStats[1];
          return [t({ "zh-CN": `• 游戏存档：${countStr}个`, "en-US": `• World saves: ${countStr}` }), recent, baseStats[2]];
        }
        break;
      case "resources":
        if (instanceDir) {
          const first = resourcePacks[0]?.name;
          const current = first ? t({ "zh-CN": `• 当前使用：${first}`, "en-US": `• Current: ${first}` }) : baseStats[0];
          return [current, t({ "zh-CN": `• 已安装：${resourcePacks.length} 个包`, "en-US": `• Installed: ${resourcePacks.length} packs` }), baseStats[2]];
        }
        break;
      case "shaders":
        if (instanceDir) {
          const firstName = shaderEntries[0]?.name.replace(/\.[^.]+$/, "");
          const current = firstName ? t({ "zh-CN": `• 当前光影：${firstName}`, "en-US": `• Current shader: ${firstName}` }) : baseStats[0];
          return [current, t({ "zh-CN": `• 已安装：${shaderEntries.length} 个`, "en-US": `• Installed: ${shaderEntries.length}` }), baseStats[2]];
        }
        break;
      case "screenshots":
        if (instanceDir)
          return [
            t({ "zh-CN": `• 总数：${screenshotEntries.length} 张`, "en-US": `• Total: ${screenshotEntries.length}` }),
            screenshotEntries.length > 0 ? baseStats[1] : t({ "zh-CN": "• 上次截图：从不", "en-US": "• Last screenshot: Never" }),
            baseStats[2],
          ];
        break;
      case "schematics":
        if (instanceDir) {
          const latest = schematicEntries[0]?.name.replace(/\.[^.]+$/, "");
          const recentStr = latest ? t({ "zh-CN": `• 最近使用：${latest}`, "en-US": `• Recently used: ${latest}` }) : baseStats[1];
          return [t({ "zh-CN": `• 原理图：${schematicEntries.length} 个`, "en-US": `• Schematics: ${schematicEntries.length}` }), recentStr, baseStats[2]];
        }
        break;
    }
    return baseStats;
  };

  return (
    <motion.div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      variants={staggerContainer}
      initial="initial"
      animate="animate"
    >
      {INSTANCE_CARDS.map((card) => {
        const copy = CARD_COPY[card.id];
        return (
        <motion.div key={card.id} variants={staggerItem} className="h-full">
          <Link
            href={card.href}
            prefetch={false}
            className="block h-full"
            suppressHydrationWarning
          >
            <Card className="shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer h-full flex flex-col border hover:border-primary/40">
              <CardHeader>
                {/* 图标 */}
                <div
                  className={cn(
                    "mb-3 flex size-11 items-center justify-center rounded-xl",
                    card.iconBgColor
                  )}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={cn("size-5", card.iconColor)}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    {card.icon}
                  </svg>
                </div>
                <CardTitle>{t(copy.title)}</CardTitle>
                <CardDescription className="text-xs">{t(copy.description)}</CardDescription>
              </CardHeader>
              <CardContent className="px-4">
                <div className="space-y-1.5">
                  {getDynamicStats(card.id, copy.stats.map((stat) => t(stat))).map((stat, index) => (
                    <p key={index} className="text-xs text-muted-foreground">
                      {stat}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        </motion.div>
      )})}
    </motion.div>
  );
}
