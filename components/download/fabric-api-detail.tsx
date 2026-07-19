<<<<<<< HEAD
"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoaderVersionList } from "@/components/download/loader-version-list";
import { ArrowLeft, Loader2, Download } from "lucide-react";
import { slideInFromRight, fadeIn } from "@/lib/motion";
import type { LoaderVersion } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { useDownloadManager } from "@/components/download/download-provider";

interface FabricApiDetailProps {
  mcVersion: string;
  onBack: () => void;
}

export function FabricApiDetail({ mcVersion, onBack }: FabricApiDetailProps) {
  const [apiVersions, setApiVersions] = useState<LoaderVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedApiVersion, setSelectedApiVersion] = useState<LoaderVersion | null>(null);
  const { startFabricDownload } = useDownloadManager();

  useEffect(() => {
    const fetchApiVersions = async () => {
      setLoading(true);
      try {
        const result = await invoke<{ id: string; version: string }[]>(
          "get_fabric_api_versions",
          { mcVersion }
        );
        const versions: LoaderVersion[] = result.map(v => ({
          id: v.id,
          version: v.version,
          releaseDate: "",
          isRecommended: false
        }));
        setApiVersions(versions);
      } catch (err) {
        console.error("获取Fabric API版本列表失败:", err);
        setApiVersions([]);
      } finally {
        setLoading(false);
      }
    };
    fetchApiVersions();
  }, [mcVersion]);

  const handleInstall = async (apiVersion: LoaderVersion) => {
    try {
      // 使用Fabric Loader的最新版本下载Fabric API
      const taskId = await startFabricDownload(mcVersion, "0.15.11", apiVersion.version);
      console.log(`Fabric API 下载任务已启动，任务ID: ${taskId}`);
    } catch (err) {
      console.error("下载并安装Fabric API失败:", err);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 返回按钮 + 版本信息头 */}
      <div className="flex items-center gap-3 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="返回"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold leading-none">
            Fabric API
          </h2>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {mcVersion}
          </Badge>
        </div>
      </div>

      {/* 子标题区域 */}
      <div className="shrink-0">
        <h3 className="text-sm font-medium text-muted-foreground">
          选择 Fabric API 版本
        </h3>
        <p className="text-xs text-muted-foreground/70 mt-0.5">
          选择一个 Fabric API 版本进行安装
        </p>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"
              variants={fadeIn}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <Loader2 className="size-8 animate-spin" />
              <p className="text-sm">正在获取版本列表...</p>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              variants={fadeIn}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <LoaderVersionList
                loaderName="Fabric API"
                versions={apiVersions}
                onInstall={handleInstall}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
=======
"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoaderVersionList } from "@/components/download/loader-version-list";
import { ArrowLeft, Loader2, Download } from "lucide-react";
import { slideInFromRight, fadeIn } from "@/lib/motion";
import type { LoaderVersion } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { useDownloadManager } from "@/components/download/download-provider";

interface FabricApiDetailProps {
  mcVersion: string;
  onBack: () => void;
}

export function FabricApiDetail({ mcVersion, onBack }: FabricApiDetailProps) {
  const [apiVersions, setApiVersions] = useState<LoaderVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedApiVersion, setSelectedApiVersion] = useState<LoaderVersion | null>(null);
  const { startFabricDownload } = useDownloadManager();

  useEffect(() => {
    const fetchApiVersions = async () => {
      setLoading(true);
      try {
        const result = await invoke<{ id: string; version: string }[]>(
          "get_fabric_api_versions",
          { mcVersion }
        );
        const versions: LoaderVersion[] = result.map(v => ({
          id: v.id,
          version: v.version,
          releaseDate: "",
          isRecommended: false
        }));
        setApiVersions(versions);
      } catch (err) {
        console.error("获取Fabric API版本列表失败:", err);
        setApiVersions([]);
      } finally {
        setLoading(false);
      }
    };
    fetchApiVersions();
  }, [mcVersion]);

  const handleInstall = async (apiVersion: LoaderVersion) => {
    try {
      // 使用Fabric Loader的最新版本下载Fabric API
      const taskId = await startFabricDownload(mcVersion, "0.15.11", apiVersion.version);
      console.log(`Fabric API 下载任务已启动，任务ID: ${taskId}`);
    } catch (err) {
      console.error("下载并安装Fabric API失败:", err);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 返回按钮 + 版本信息头 */}
      <div className="flex items-center gap-3 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="返回"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold leading-none">
            Fabric API
          </h2>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {mcVersion}
          </Badge>
        </div>
      </div>

      {/* 子标题区域 */}
      <div className="shrink-0">
        <h3 className="text-sm font-medium text-muted-foreground">
          选择 Fabric API 版本
        </h3>
        <p className="text-xs text-muted-foreground/70 mt-0.5">
          选择一个 Fabric API 版本进行安装
        </p>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"
              variants={fadeIn}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <Loader2 className="size-8 animate-spin" />
              <p className="text-sm">正在获取版本列表...</p>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              variants={fadeIn}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <LoaderVersionList
                loaderName="Fabric API"
                versions={apiVersions}
                onInstall={handleInstall}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
>>>>>>> 7e94b3d5fae96299a238ed4f26231cdffc1ac040
