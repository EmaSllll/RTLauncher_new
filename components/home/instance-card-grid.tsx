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

type InstanceCardGridProps = {
  instanceDir: string | undefined;
  selectedInstance: InstanceData | null;
};

export function InstanceCardGrid({
  instanceDir,
  selectedInstance,
}: InstanceCardGridProps) {
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
          return [`• 已安装：${modsCount} 个模组`, ...baseStats.slice(1)];
        break;
      case "worlds":
        if (instanceDir) {
          const countStr = worldCount > 0 ? `${worldCount} 个` : "0 个";
          const recent = latestWorld ? `• 最近游戏：${latestWorld}` : baseStats[1];
          return [`• 游戏存档：${countStr}`, recent, baseStats[2]];
        }
        break;
      case "resources":
        if (instanceDir) {
          const first = resourcePacks[0]?.name;
          const current = first ? `• 当前使用：${first}` : baseStats[0];
          return [current, `• 已安装：${resourcePacks.length} 个包`, baseStats[2]];
        }
        break;
      case "shaders":
        if (instanceDir) {
          const firstName = shaderEntries[0]?.name.replace(/\.[^.]+$/, "");
          const current = firstName ? `• 当前光影：${firstName}` : baseStats[0];
          return [current, `• 已安装：${shaderEntries.length} 个`, baseStats[2]];
        }
        break;
      case "screenshots":
        if (instanceDir)
          return [
            `• 总数：${screenshotEntries.length} 张`,
            screenshotEntries.length > 0 ? baseStats[1] : "• 上次截图：从不",
            baseStats[2],
          ];
        break;
      case "schematics":
        if (instanceDir) {
          const latest = schematicEntries[0]?.name.replace(/\.[^.]+$/, "");
          const recentStr = latest ? `• 最近使用：${latest}` : baseStats[1];
          return [`• 原理图：${schematicEntries.length} 个`, recentStr, baseStats[2]];
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
      {INSTANCE_CARDS.map((card) => (
        <motion.div key={card.id} variants={staggerItem}>
          <Link
            href={card.href}
            className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full border py-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
              <CardHeader className="px-4">
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
                <CardTitle>{card.title}</CardTitle>
                <CardDescription className="text-xs">{card.description}</CardDescription>
              </CardHeader>
              <CardContent className="px-4">
                <div className="space-y-1.5">
                  {getDynamicStats(card.id, card.stats).map((stat, index) => (
                    <p key={index} className="text-xs text-muted-foreground">
                      {stat}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
