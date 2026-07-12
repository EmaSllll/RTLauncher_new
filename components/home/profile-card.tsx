"use client";

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { fadeSlideUp } from "@/lib/motion";
import { Loader2, Play } from "lucide-react";
import type { Account } from "@/types";
import { useLaunchContext } from "@/components/launch/launch-provider";
import { VersionSelectorDialog } from "@/components/launch/version-selector-dialog";
import { AppUpdateSection } from "@/components/settings/app-updater";

type ProfileCardProps = {
  selectedProfile: Account | null;
  onOpenProfileSelector: () => void;
};

export function ProfileCard({
  selectedProfile,
  onOpenProfileSelector,
}: ProfileCardProps) {
  const { config, status, launchGame, errorMessage } = useLaunchContext();
  const isLaunching = status === "preparing" || status === "launching";
  const isRunning = status === "running";
  const canLaunch = !isLaunching && !isRunning;

  const versionDisplay = config.versionName || "未选择游戏版本";

  const handleLaunch = () => {
    launchGame();
  };

  return (
    <motion.div
      variants={fadeSlideUp}
      initial="initial"
      animate="animate"
      transition={{ delay: 0.1 }}
      className="h-full"
    >
      <Card className="h-full flex flex-col justify-between border shadow-sm hover:shadow-xl transition-shadow duration-300">
        {/* 卡片主要内容区域 */}
        <CardContent className="flex-grow flex flex-col items-center justify-center">
          <button
            type="button"
            className="cursor-pointer transition-all duration-300 p-2 rounded-xl hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
            onClick={onOpenProfileSelector}
            title="点击管理账号"
          >
            {/* 放大的头像，去掉默认的圆形 after 边框 */}
            <div className="relative flex items-center justify-center">
              {selectedProfile?.skinUrl ? (
                <img
                  src={selectedProfile.skinUrl}
                  alt={selectedProfile.name}
                  className="size-24 object-cover rounded-md bg-muted shadow-sm"
                />
              ) : (
                <div className="size-24 rounded-md bg-muted flex items-center justify-center text-2xl font-bold text-muted-foreground">
                  {(selectedProfile?.name ?? "RTL User").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </button>
          <div className="flex flex-col items-center mt-4 text-center pointer-events-none">
            <span className="font-bold text-lg">
              {selectedProfile?.name ?? "RTL User"}
            </span>
            <span className="text-muted-foreground text-sm">
              {selectedProfile?.status ?? ""}
            </span>
          </div>
        </CardContent>

        {/* 卡片底部按钮区域 */}
        <CardContent className="flex items-center">
          <div className="w-full">
            <div className="text-center text-sm text-muted-foreground mb-2">
              {versionDisplay || "未选择实例"}
            </div>
            <Button
              variant="default"
              size="lg"
              className="w-full mb-2 sm:mb-3 md:mb-4 gap-1.5"
              disabled={!canLaunch}
              onClick={handleLaunch}
            >
              {isLaunching ? (
                <><Loader2 className="size-4 animate-spin" />启动中</>
              ) : isRunning ? (
                <><Play className="size-4" />运行中</>
              ) : (
                <><Play className="size-4" />启动游戏</>
              )}
            </Button>
            {errorMessage && (
              <p className="text-xs text-destructive text-center mb-2">{errorMessage}</p>
            )}
            <AppUpdateSection />
            <div className="flex gap-2 mt-2">
              <VersionSelectorDialog />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}