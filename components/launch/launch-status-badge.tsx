"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fadeIn } from "@/lib/motion";
import {
  Circle,
  Loader2,
  Play,
  AlertCircle,
  Square,
} from "lucide-react";
import type { LaunchStatus } from "@/types";
import { useI18n } from "@/components/i18n/use-i18n";

const statusConfig: Record<
  LaunchStatus,
  { label: { "zh-CN": string; "en-US": string }; icon: React.ReactNode; color: string }
> = {
  idle: {
    label: { "zh-CN": "就绪", "en-US": "Ready" },
    icon: <Circle className="size-3" />,
    color: "text-muted-foreground",
  },
  preparing: {
    label: { "zh-CN": "准备中", "en-US": "Preparing" },
    icon: <Loader2 className="size-3 animate-spin" />,
    color: "text-blue-500",
  },
  launching: {
    label: { "zh-CN": "启动中", "en-US": "Launching" },
    icon: <Loader2 className="size-3 animate-spin" />,
    color: "text-amber-500",
  },
  running: {
    label: { "zh-CN": "运行中", "en-US": "Running" },
    icon: <Play className="size-3" />,
    color: "text-green-500",
  },
  stopped: {
    label: { "zh-CN": "已停止", "en-US": "Stopped" },
    icon: <Square className="size-3" />,
    color: "text-muted-foreground",
  },
  error: {
    label: { "zh-CN": "错误", "en-US": "Error" },
    icon: <AlertCircle className="size-3" />,
    color: "text-destructive",
  },
};

interface LaunchStatusBadgeProps {
  status: LaunchStatus;
  className?: string;
}

export function LaunchStatusBadge({ status, className }: LaunchStatusBadgeProps) {
  const { t } = useI18n();
  const cfg = statusConfig[status];
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 overflow-hidden", cfg.color, className)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          variants={fadeIn}
          initial="initial"
          animate="animate"
          exit="exit"
          className="flex items-center gap-1.5"
        >
          {cfg.icon}
          {t(cfg.label)}
        </motion.span>
      </AnimatePresence>
    </Badge>
  );
}
