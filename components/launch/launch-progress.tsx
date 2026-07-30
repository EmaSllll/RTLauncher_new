"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Progress } from "@/components/ui/progress";
import { useLaunchContext } from "@/components/launch/launch-provider";
import { Loader2 } from "lucide-react";
import { fadeSlideUp } from "@/lib/motion";
import { useI18n } from "@/components/i18n/use-i18n";

/**
 * 启动进度条组件
 * 显示游戏启动过程中的实时进度
 */
export function LaunchProgress() {
  const { t } = useI18n();
  const { progress, status } = useLaunchContext();
  const isLaunching = status === "preparing" || status === "launching";
  const stageLabel = progress ? {
    "JVM 启动": "Starting JVM",
    "加载库文件": "Loading libraries",
    "加载资源": "Loading assets",
    "初始化游戏": "Initializing game",
    "加载模组": "Loading mods",
    "加载世界": "Loading world",
    "准备完成": "Ready",
  }[progress.currentStage] ?? progress.currentStage : "";

  return (
    <AnimatePresence>
      {isLaunching && (
        <motion.div
          variants={fadeSlideUp}
          initial="initial"
          animate="animate"
          exit="exit"
          className="space-y-2"
        >
          {progress ? (
            <>
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                  <span className="font-medium text-foreground">
                    {t({ "zh-CN": progress.currentStage, "en-US": stageLabel })}
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {progress.currentStep} / {progress.totalSteps}
                </span>
              </div>
              <Progress value={progress.percentage} className="h-2" />
              <div className="text-right text-[10px] text-muted-foreground">
                {Math.round(progress.percentage)}%
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              <span className="font-medium text-foreground">
                {status === "preparing" ? t({ "zh-CN": "准备中...", "en-US": "Preparing..." }) : t({ "zh-CN": "正在分析启动日志...", "en-US": "Analyzing launch logs..." })}
              </span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
