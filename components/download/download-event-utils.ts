"use client";

import {
  type Dispatch,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DownloadTask, DownloadTaskStatus } from "./download-provider";

/** ============= 事件监听部分 ============= */

interface ProgressPayload {
  task_id: number;
  percent: number;
}

interface FinishedPayload {
  task_id: number;
  success: boolean;
  error: string | null;
  failed_count?: number;
}

/** 统一的 progress 事件处理器（每个下载器都走同一套逻辑） */
function makeProgressHandler(
  setTasks: Dispatch<SetStateAction<DownloadTask[]>>,
  cancelledRef: { current: boolean }
) {
  return (event: { payload: ProgressPayload }) => {
    if (cancelledRef.current) return;
    const { task_id, percent } = event.payload;
    if (typeof percent !== "number" || isNaN(percent)) {
      return;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.taskId === task_id && t.status === "downloading"
          ? { ...t, progress: percent }
          : t
      )
    );
  };
}

/** 统一的 finished 事件处理器 */
function makeFinishedHandler(
  setTasks: Dispatch<SetStateAction<DownloadTask[]>>,
  cancelledRef: { current: boolean },
  onEnd?: () => void
) {
  return (event: { payload: FinishedPayload }) => {
    if (cancelledRef.current) return;
    const { task_id, success, error, failed_count = 0 } = event.payload;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.taskId !== task_id) return t;
        if (t.status === "cancelled") return t;
        const isWarning = success && failed_count > 0;
        return {
          ...t,
          status: (isWarning ? "warning" : success ? "success" : "error") as DownloadTaskStatus,
          progress: success ? 100 : t.progress,
          error: error ?? undefined,
          failedCount: failed_count > 0 ? failed_count : undefined,
        };
      })
    );
    onEnd?.();
  };
}

/** 一次性注册所有下载器的事件监听（原版 + Java + OptiFine + Fabric + Quilt + Forge + NeoForge + Mod + Modpack）
 * 返回 unlisten 函数数组，组件卸载时调用
 */
export async function setupAllDownloadListeners(
  setTasks: Dispatch<SetStateAction<DownloadTask[]>>,
  dequeueNext: () => void
): Promise<UnlistenFn[]> {
  const cancelledRef = { current: false };
  const progressHandler = makeProgressHandler(setTasks, cancelledRef);
  const finishedHandler = makeFinishedHandler(setTasks, cancelledRef);
  // 原版下载完成后先释放排队锁再启动下一个
  const vanillaFinishedHandler = makeFinishedHandler(
    setTasks,
    cancelledRef,
    dequeueNext
  );

  const eventPairs: Array<[string, string, "vanilla" | "other"]> = [
    ["download-progress", "download-finished", "vanilla"],
    ["java-download-progress", "java-download-finished", "other"],
    ["optifine-download-progress", "optifine-download-finished", "other"],
    ["fabric-download-progress", "fabric-download-finished", "other"],
    ["forge-download-progress", "forge-download-finished", "other"],
    ["mod-download-progress", "mod-download-finished", "other"],
    ["neoforge-download-progress", "neoforge-download-finished", "other"],
    ["liteloader-download-progress", "liteloader-download-finished", "other"],
    ["quilt-download-progress", "quilt-download-finished", "other"],
  ];

  const unlistens: UnlistenFn[] = [];
  for (const [progressEvent, finishedEvent, kind] of eventPairs) {
    const unlistenP = await listen<ProgressPayload>(progressEvent, progressHandler);
    unlistens.push(unlistenP);

    const handler = kind === "vanilla" ? vanillaFinishedHandler : finishedHandler;
    const unlistenF = await listen<FinishedPayload>(finishedEvent, handler);
    unlistens.push(unlistenF);
  }

  // modpack 特殊处理：progress 跟其他一样，但 finished 不同：
  const unlistenModpackP = await listen<ProgressPayload>("modpack-progress", progressHandler);
  unlistens.push(unlistenModpackP);

  const unlistenModpackF = await listen("modpack-finished", (ev) => {
    if (cancelledRef.current) return;
    const payload = ev.payload as any;
    const task_id = payload.task_id;
    const success = payload.success;
    const message = payload.message;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.taskId !== task_id) return t;
        if (t.status === "cancelled") return t;
        return {
          ...t,
          status: (success ? "success" : "error") as DownloadTaskStatus,
          progress: success ? 100 : t.progress,
          error: success ? undefined : String(message),
        };
      })
    );
  });
  unlistens.push(unlistenModpackF);

  return unlistens;
}

/** ============= 启动函数部分 ============= */

interface StartDownloadOptions {
  /** 用于生成 label，显示在 UI 上 */
  label: string;
  /** Minecraft 版本，用于在任务列表显示 */
  mcVersion: string;
  /** 后端 Tauri 命令名称，如 "download_and_install_forge" */
  tauriCommand: string;
  /** 传给后端的参数对象 */
  params: Record<string, unknown>;
}

/**
 * 生成一个 startXXXDownload 函数的工厂
 *
 * 所有下载器（Forge / NeoForge / Fabric / Quilt / OptiFine / Mod 都走这套逻辑
 * 只有原版下载不一样（它走队列）
 */
export function makeStartDownloadFn(
  setTasks: Dispatch<SetStateAction<DownloadTask[]>>,
  taskIdCounterRef: { current: number },
  dequeueNext?: () => void
) {
  return async function startDownload(opts: StartDownloadOptions): Promise<number> {
    const taskId = taskIdCounterRef.current++;
    const { label, mcVersion, tauriCommand, params } = opts;

    setTasks((prev) => {
      const isDownloading = prev.some(
        (t) => t.label === label && t.status === "downloading"
      );
      if (isDownloading) return prev;

      const task: DownloadTask = {
        taskId,
        label,
        mcVersion,
        status: "downloading",
        progress: 0,
        startedAt: Date.now(),
      };
      return [task, ...prev];
    });

    try {
      const returnedTaskId = await invoke<number>(tauriCommand, params);
      // 如果后端返回的 taskId 与我们生成的不一样，替换掉
      if (returnedTaskId !== taskId) {
        setTasks((prev) =>
          prev.map((t) =>
            t.taskId === taskId ? { ...t, taskId: returnedTaskId } : t
          )
        );
      }
      return returnedTaskId;
    } catch (err) {
      console.error(`启动下载失败 (${tauriCommand}):`, err);
      // 标记任务为失败
      setTasks((prev) =>
        prev.map((t) =>
          t.taskId === taskId ? { ...t, status: "error", error: String(err) } : t
        )
      );
      // 启动失败后尝试下一个排队任务
      dequeueNext?.();
      throw err;
    }
  };
}