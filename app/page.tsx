"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  Download,
  Gamepad2,
  Loader2,
  Play,
  Rocket,
  Shirt,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { AccountSwitcher } from "@/components/accounts/account-switcher";
import { SkinCapeManager } from "@/components/accounts/skin-cape-manager";
import { SkinViewer3D } from "@/components/accounts/skin-viewer-3d";
import { useAccountContext } from "@/components/accounts/account-provider";
import { AnnouncementCard } from "@/components/home/announcement-card";
import { InstanceCardGrid } from "@/components/home/instance-card-grid";
import { LaunchStatusBadge } from "@/components/launch/launch-status-badge";
import { useLaunchContext } from "@/components/launch/launch-provider";
import { AppUpdateSection } from "@/components/settings/app-updater";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { useInstancePath } from "@/hooks/use-instance-path";
import type { Account } from "@/types";

const QUICK_ACTIONS = [
  {
    href: "/launch",
    title: "启动设置",
    description: "版本、Java 与内存",
    icon: Rocket,
    iconClassName: "bg-primary/10 text-primary",
  },
  {
    href: "/download",
    title: "下载内容",
    description: "游戏、加载器与资源",
    icon: Download,
    iconClassName: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  {
    href: "/game-settings",
    title: "游戏管理",
    description: "模组、存档与资源包",
    icon: Gamepad2,
    iconClassName: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
];

/** 首页仪表盘：把启动状态、实例资源与账户操作集中在一个可滚动页面。 */
export default function Home() {
  const router = useRouter();
  const [isProfileSelectorOpen, setIsProfileSelectorOpen] = useState(false);
  const [isSkinManagerOpen, setIsSkinManagerOpen] = useState(false);
  const { selectedProfile, selectProfile } = useAccountContext();
  const {
    config,
    configLoaded,
    status,
    errorMessage,
    launchGame,
    cancelLaunch,
  } = useLaunchContext();
  const {
    instanceDir,
    selectedInstance,
    loading: instanceLoading,
  } = useInstancePath();

  const isLaunchActive =
    status === "preparing" || status === "launching" || status === "running";
  const canLaunch = Boolean(
    config.minecraftPath &&
      config.javaPath &&
      config.versionName &&
      selectedProfile,
  );
  const versionName = selectedInstance?.minecraft_version || config.versionName || "未选择版本";
  const loaderName =
    selectedInstance?.loader || (config.loadType === "0" ? "Vanilla" : "模组加载器");

  const handleProfileSelect = (profile: Account) => {
    selectProfile(profile);
  };

  const handlePrimaryAction = async () => {
    if (isLaunchActive) {
      await cancelLaunch();
      return;
    }
    if (!canLaunch) {
      router.push("/launch");
      return;
    }
    await launchGame();
  };

  const primaryActionLabel = isLaunchActive
    ? status === "running"
      ? "停止游戏"
      : "取消启动"
    : canLaunch
      ? "立即启动"
      : "完成启动配置";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[1600px] flex-col gap-4 p-4 md:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-primary">RTLauncher</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              欢迎回来，{selectedProfile?.name ?? "冒险者"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              在这里管理你的游戏版本、资源与启动状态。
            </p>
          </div>
          <LaunchStatusBadge status={status} className="mt-1" />
        </header>

        <div className="grid min-h-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="flex min-w-0 flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_250px]">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Card className="relative min-h-[230px] overflow-hidden border-primary/20 bg-gradient-to-br from-primary/12 via-card to-card shadow-sm">
                  <div className="pointer-events-none absolute -right-12 -top-16 size-52 rounded-full bg-primary/10 blur-3xl" />
                  <CardContent className="relative flex h-full min-h-[230px] flex-col justify-between gap-6 p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          {instanceLoading ? (
                            <Badge variant="outline" className="gap-1.5">
                              <Loader2 className="size-3 animate-spin" />
                              正在读取版本
                            </Badge>
                          ) : (
                            <Badge variant="outline">
                              {selectedInstance ? "当前实例" : "尚未选择实例"}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-muted-foreground">
                            {loaderName}
                          </Badge>
                        </div>
                        <h2 className="truncate text-2xl font-semibold tracking-tight">
                          {selectedInstance?.name || versionName}
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {selectedInstance
                            ? `Minecraft ${versionName} · 已安装 ${selectedInstance.mods_count} 个模组`
                            : "选择一个已安装版本后，即可在这里快速启动游戏。"}
                        </p>
                      </div>
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                        <Boxes className="size-5" />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="lg"
                        className="gap-2"
                        disabled={!configLoaded}
                        onClick={() => void handlePrimaryAction()}
                      >
                        {isLaunchActive ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Play className="size-4" />
                        )}
                        {primaryActionLabel}
                      </Button>
                      <Button variant="outline" size="lg" asChild>
                        <Link href="/launch" className="gap-2">
                          查看启动详情
                          <ArrowRight className="size-4" />
                        </Link>
                      </Button>
                    </div>

                    {errorMessage && (
                      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {errorMessage}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05, duration: 0.3 }}
                className="min-h-[230px]"
              >
                <AnnouncementCard compact />
              </motion.div>
            </div>

            <Card size="sm" className="shadow-sm">
              <CardHeader className="pb-1">
                <CardTitle>快速入口</CardTitle>
                <CardDescription>常用功能无需切换多层菜单</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-3">
                  {QUICK_ACTIONS.map(({ href, title, description, icon: Icon, iconClassName }) => (
                    <Link
                      key={href}
                      href={href}
                      className="group flex min-w-0 items-center gap-3 rounded-xl border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{description}</span>
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>

            <section aria-labelledby="resource-overview-title" className="flex min-h-0 flex-col gap-3">
              <div className="flex items-end justify-between gap-3 px-1">
                <div>
                  <h2 id="resource-overview-title" className="text-base font-semibold">
                    实例资源概览
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    资源数据随当前选择的游戏版本自动更新。
                  </p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/game-settings" className="gap-1.5">
                    管理游戏
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
              <InstanceCardGrid
                instanceDir={instanceDir}
                selectedInstance={selectedInstance}
              />
            </section>
          </section>

          <motion.aside
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="lg:sticky lg:top-0"
          >
            <Card className="overflow-hidden border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle>账户与角色</CardTitle>
                <CardDescription>选择玩家并管理皮肤、披风</CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-[270px] items-center justify-center pt-0">
                <SkinPreviewLarge profile={selectedProfile} />
              </CardContent>

              <div className="border-t border-border">
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-base font-semibold text-muted-foreground">
                      {selectedProfile ? (
                        selectedProfile.name.charAt(0).toUpperCase()
                      ) : (
                        <User className="size-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {selectedProfile?.name ?? "尚未登录"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {selectedProfile?.status ?? "添加账户后即可启动游戏"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => setIsProfileSelectorOpen(true)}
                    >
                      <Users className="size-3.5" />
                      管理账户
                    </Button>
                    {selectedProfile?.authType === "microsoft" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-2"
                        onClick={() => setIsSkinManagerOpen(true)}
                      >
                        <Shirt className="size-3.5" />
                        皮肤和披风
                      </Button>
                    )}
                  </div>
                  <AppUpdateSection />
                </CardContent>
              </div>
            </Card>
          </motion.aside>
        </div>
      </div>

      <AccountSwitcher
        open={isProfileSelectorOpen}
        onClose={() => setIsProfileSelectorOpen(false)}
        onSelect={handleProfileSelect}
      />

      <Dialog
        open={isSkinManagerOpen}
        onOpenChange={(open) => setIsSkinManagerOpen(open)}
      >
        <DialogContent className="max-h-[90vh] sm:max-w-4xl">
          {selectedProfile && (
            <SkinCapeManager
              account={selectedProfile}
              onClose={() => setIsSkinManagerOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SkinPreviewLarge({ profile }: { profile: Account | null }) {
  const hasSkin = Boolean(profile?.skinUrl);
  const displayName = profile?.name ?? "尚未登录";

  return (
    <div className="flex w-full flex-col items-center justify-center gap-3">
      {hasSkin ? (
        <div className="overflow-hidden rounded-2xl bg-muted/40">
          <SkinViewer3D skinSrc={profile!.skinUrl!} width={250} height={290} />
        </div>
      ) : profile ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-24 items-center justify-center rounded-3xl bg-muted text-3xl font-semibold text-muted-foreground shadow-sm">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <p className="text-xs text-muted-foreground">该账户暂无可预览的皮肤</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
          <div className="flex size-24 items-center justify-center rounded-3xl bg-muted shadow-sm">
            <UserPlus className="size-10" />
          </div>
          <p className="text-sm">登录后即可预览 3D 皮肤</p>
        </div>
      )}
    </div>
  );
}
