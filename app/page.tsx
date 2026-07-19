"use client";

import { useState, useEffect } from "react";
import { AccountSwitcher } from "@/components/accounts/account-switcher";
import { useAccountContext } from "@/components/accounts/account-provider";
import { AnnouncementCard } from "@/components/home/announcement-card";
import { SkinViewer3D } from "@/components/accounts/skin-viewer-3d";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkinCapeManager } from "@/components/accounts/skin-cape-manager";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fadeSlideUp } from "@/lib/motion";
import { Users, UserPlus, User, Shirt } from "lucide-react";
import type { Account } from "@/types";
import { AppUpdateSection } from "@/components/settings/app-updater";

/**
 * 主页组件（新布局 - 最终版）
 *
 * 布局：
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ [左上角：公告（正方形）]                                             │
 * │                                                                     │
 * │                                                                     │
 * │ [中间：空着]                                                         │
 * │                                                                     │
 * │                                                                     │
 * │ [右侧：皮肤展示 + 账户管理]                                          │
 * │  3D皮肤预览                                                         │
 * │  账户信息                                                           │
 * │  皮肤和披风更改（上下排列）                                          │
 * └─────────────────────────────────────────────────────────────────────┘
 */
export default function Home() {
  const [isProfileSelectorOpen, setIsProfileSelectorOpen] = useState(false);
  const [isSkinManagerOpen, setIsSkinManagerOpen] = useState(false);
  const { selectedProfile, selectProfile } = useAccountContext();

  const handleProfileSelect = (profile: Account) => {
    selectProfile(profile);
  };

  useEffect(() => {
    document.body.classList.add("no-scrollbar");
    document.body.style.overflow = "hidden";

    return () => {
      document.body.classList.remove("no-scrollbar");
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div className="relative h-full overflow-hidden">
      {/* 主内容区 */}
      <div className="h-full w-full p-4 md:p-5">
        <div className="grid h-full grid-cols-1 md:grid-cols-[1fr_320px] gap-4 md:gap-5">
          {/* 左侧主区域 */}
          <div className="relative flex flex-col gap-4 min-h-0">
            {/* 左上角：公告（正方形） */}
            <div className="absolute top-0 left-0 w-64 h-64">
              <AnnouncementCard compact />
            </div>

            {/* 中间区域完全空着 */}
          </div>

          {/* 右侧：皮肤展示 + 账户管理（垂直一体化） */}
          <div className="flex flex-col gap-4 min-h-0">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.35 }}
              className="flex-1 min-h-0"
            >
              <Card className="h-full flex flex-col border shadow-sm overflow-hidden">
                {/* 3D 皮肤预览区域 */}
                <CardContent className="flex-1 flex flex-col items-center justify-center p-4 min-h-0">
                  <SkinPreviewLarge profile={selectedProfile} />
                </CardContent>

                {/* 账户信息与操作区域（和皮肤预览连在一起） */}
                <div className="border-t border-border">
                  <CardContent className="pt-4 pb-4">
                    {/* 账户信息 */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="size-10 shrink-0 rounded-lg bg-muted flex items-center justify-center text-base font-semibold text-muted-foreground">
                        {selectedProfile ? (
                          selectedProfile.name.charAt(0).toUpperCase()
                        ) : (
                          <User className="size-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {selectedProfile?.name ?? "尚未登录"}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {selectedProfile ? "已登录" : "点击下方按钮添加账户"}
                        </div>
                      </div>
                    </div>

                    {/* 操作按钮（上下排列） */}
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsProfileSelectorOpen(true)}
                        className="w-full gap-2"
                      >
                        <Users className="size-3.5" />
                        管理账户
                      </Button>

                      {/* 仅当账号为MC正版（Microsoft）时显示皮肤和披风更改按钮 */}
                      {selectedProfile?.authType === "microsoft" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsSkinManagerOpen(true)}
                          className="w-full gap-2"
                        >
                          <Shirt className="size-3.5" />
                          皮肤和披风更改
                        </Button>
                      )}
                    </div>

                    {/* 更新提示 */}
                    <div className="mt-4">
                      <AppUpdateSection />
                    </div>
                  </CardContent>
                </div>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>

      {/* 账户切换弹窗 */}
      <AccountSwitcher
        open={isProfileSelectorOpen}
        onClose={() => setIsProfileSelectorOpen(false)}
        onSelect={handleProfileSelect}
      />

      {/* 皮肤/披风管理弹窗 */}
      <Dialog open={isSkinManagerOpen} onOpenChange={(open) => {
        if (!open) setIsSkinManagerOpen(false);
      }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh]">
          {selectedProfile ? (
            <SkinCapeManager
              account={selectedProfile}
              onClose={() => setIsSkinManagerOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * 右栏：大尺寸 3D 皮肤预览
 */
function SkinPreviewLarge({ profile }: { profile: Account | null }) {
  const hasSkin = !!profile?.skinUrl;
  const displayName = profile?.name ?? "尚未登录";

  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-3">
      {/* 3D 皮肤展示 */}
      <div className="flex-1 flex items-center justify-center w-full min-h-0">
        {hasSkin ? (
          <div className="relative rounded-lg bg-muted/40 overflow-hidden">
            <SkinViewer3D
              skinSrc={profile!.skinUrl!}
              width={300}
              height={400}
            />
          </div>
        ) : profile ? (
          // 已登录但无皮肤：显示字母头像
          <div className="relative flex flex-col items-center justify-center gap-3">
            <div className="size-24 rounded-2xl bg-muted flex items-center justify-center text-3xl font-semibold text-muted-foreground shadow-sm">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="text-xs text-muted-foreground text-center">
              该账户暂无皮肤
            </div>
          </div>
        ) : (
          // 完全未登录：邀请创建账户
          <div className="relative flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="size-24 rounded-2xl bg-muted flex items-center justify-center shadow-sm">
              <UserPlus className="size-10" />
            </div>
            <div className="text-center text-sm">
              登录后即可预览 3D 皮肤
            </div>
          </div>
        )}
      </div>
    </div>
  );
}