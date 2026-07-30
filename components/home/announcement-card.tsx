"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ANNOUNCEMENTS } from "@/constants/data";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { slideLeftContent } from "@/lib/motion";
import { useI18n } from "@/components/i18n/use-i18n";

const ANNOUNCEMENT_COPY = [
  { title: { "zh-CN": "欢迎使用 RTLauncher", "en-US": "Welcome to RTLauncher" }, content: { "zh-CN": "全新的 Minecraft 启动器，提供现代化的设计和流畅的体验。", "en-US": "A modern Minecraft launcher with a polished, smooth experience." } },
  { title: { "zh-CN": "系统更新", "en-US": "System update" }, content: { "zh-CN": "我们最近发布了新功能，改善了用户体验。", "en-US": "We recently released new features and improved the experience." } },
  { title: { "zh-CN": "使用提示", "en-US": "Tips" }, content: { "zh-CN": "查看我们的文档了解如何更好地使用本系统。", "en-US": "Read the documentation to get the most from the launcher." } },
] as const;

export function AnnouncementCard({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(0);
  const announcement = ANNOUNCEMENT_COPY[current] ?? ANNOUNCEMENT_COPY[0];

  const prev = () =>
    setCurrent((i) => (i - 1 + ANNOUNCEMENTS.length) % ANNOUNCEMENTS.length);
  const next = () =>
    setCurrent((i) => (i + 1) % ANNOUNCEMENTS.length);

  if (compact) {
    return (
      <Card className="w-full h-full shadow-sm flex flex-col">
        <CardHeader className="pb-2 px-3">
          <CardTitle className="text-sm">{t({ "zh-CN": "公告栏", "en-US": "Announcements" })}</CardTitle>
          <CardDescription className="text-xs">{t({ "zh-CN": "最新消息", "en-US": "Latest news" })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col items-center justify-between gap-2 pt-0 px-3">
          <div className="flex flex-1 items-center justify-center w-full rounded-lg border p-2 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                variants={slideLeftContent}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <h3 className="font-medium text-xs">{t(announcement.title)}</h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {t(announcement.content)}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" onClick={prev}>
              <ChevronLeft className="size-3" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {current + 1} / {ANNOUNCEMENTS.length}
            </span>
            <Button variant="outline" size="icon-sm" onClick={next}>
              <ChevronRight className="size-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="aspect-square shadow-sm flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t({ "zh-CN": "公告栏", "en-US": "Announcements" })}</CardTitle>
        <CardDescription className="text-xs">{t({ "zh-CN": "最新消息和更新", "en-US": "Latest news and updates" })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center justify-between gap-3 pt-0">
        <div className="flex flex-1 items-center justify-center w-full rounded-lg border p-3 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={current}
              variants={slideLeftContent}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <h3 className="font-medium text-sm">{t(announcement.title)}</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {t(announcement.content)}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={prev}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {current + 1} / {ANNOUNCEMENTS.length}
          </span>
          <Button variant="outline" size="icon-sm" onClick={next}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
