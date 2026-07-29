"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAccountContext } from "@/components/accounts/account-provider";
import { isTauriRuntime } from "@/lib/tauri-runtime";
import { log4jParser } from "@/components/launch/log4j-progress-parser";
import type { LaunchConfig, LaunchLogEntry, LaunchProgress, LaunchStatus } from "@/types";

/** 默认启动配置 */
const DEFAULT_LAUNCH_CONFIG: LaunchConfig = {
  minecraftPath: "",
  javaPath: "",
  wrapperPath: "",
  maxMemory: "4096",
  versionName: "",
  loadType: "0",
  loadName: "",
  playerName: "",
  authToken: "",
  uuid: "",
  windowWidth: "873",
  windowHeight: "486",
  authlibInjectorPath: "",
  yggdrasilApi: "",
  prefetchedData: "",
};

interface LaunchContextValue {
  /** 启动配置 */
  config: LaunchConfig;
  /** 更新启动配置 */
  updateConfig: (patch: Partial<LaunchConfig>) => void;
  /** 当前启动状态 */
  status: LaunchStatus;
  /** 启动日志 */
  logs: LaunchLogEntry[];
  /** 错误信息 */
  errorMessage: string | null;
  /** 启动游戏 */
  launchGame: (overrides?: Partial<LaunchConfig>) => Promise<void>;
  /** 终止/取消启动中的游戏进程 */
  cancelLaunch: () => Promise<void>;
  /** 清空日志 */
  clearLogs: () => void;
  /** 最后一次启动的完整命令参数（调试用） */
  lastCommandArgs: string | null;
  /** 上次启动时间 */
  lastLaunchTime: string | null;
  /** 配置是否已加载完成 */
  configLoaded: boolean;
  /** 启动进度 */
  progress: LaunchProgress | null;
}

const LaunchContext = createContext<LaunchContextValue | null>(null);

export function useLaunchContext() {
  const ctx = useContext(LaunchContext);
  if (!ctx) {
    throw new Error("useLaunchContext must be used within LaunchProvider");
  }
  return ctx;
}

export function LaunchProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<LaunchConfig>(DEFAULT_LAUNCH_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);

  
  // 客户端挂载后从 localStorage 恢复配置，再用 Tauri config 覆盖路径字段
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      let base: Partial<LaunchConfig> = {};
      try {
        const saved = localStorage.getItem("rtl-launch-config");
        if (saved) base = JSON.parse(saved);
        const savedTime = localStorage.getItem("rtl-last-launch-time");
        if (savedTime) setLastLaunchTime(savedTime);
      } catch { /* ignore */ }

      // 从 Tauri config 目录加载选中路径，优先级高于 localStorage
      try {
        const pathsCfg = await invoke<{
          selected_java_path: string;
          selected_minecraft_path: string;
        }>("get_launcher_paths_config");
        if (pathsCfg.selected_java_path) base.javaPath = pathsCfg.selected_java_path;
        if (pathsCfg.selected_minecraft_path) base.minecraftPath = pathsCfg.selected_minecraft_path;
      } catch { /* 不可用时保留 localStorage 值 */ }

      if (!cancelled) {
        setConfig((prev) => ({ ...prev, ...base }));
        setConfigLoaded(true);
      }
    };
    init();
    return () => { cancelled = true; };
  }, []);

  const [status, setStatus] = useState<LaunchStatus>("idle");
  const [logs, setLogs] = useState<LaunchLogEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastCommandArgs, setLastCommandArgs] = useState<string | null>(null);
  const [lastLaunchTime, setLastLaunchTime] = useState<string | null>(null);
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const logIdRef = useRef(0);

  const { selectedProfile } = useAccountContext();

  const MAX_LOG_ENTRIES = 500;

  const addLog = useCallback(
    (level: LaunchLogEntry["level"], message: string) => {
      const entry: LaunchLogEntry = {
        id: ++logIdRef.current,
        timestamp: new Date().toLocaleTimeString(),
        level,
        message,
      };
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
      });
    },
    []
  );

  const updateConfig = useCallback((patch: Partial<LaunchConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      // 持久化到 localStorage
      try {
        localStorage.setItem("rtl-launch-config", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    logIdRef.current = 0;
  }, []);

  // 监听游戏日志事件（来自 Minecraft log4j stdout/stderr）
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | null = null;
    listen<{ level: string; message: string }>("game-log", (event) => {
      const { level, message } = event.payload;
      const logLevel: "error" | "info" | "warn" =
        level === "error" || level === "warn" ? level : "info";

      // 使用 log4j 解析器分析日志并更新进度
      if (status === "launching" || status === "preparing") {
        const parsedProgress = log4jParser.parseLog(message);
        if (parsedProgress.stage) {
          const allStages = log4jParser.getAllStages();
          const currentStageIndex = allStages.findIndex(s => s.id === parsedProgress.stage?.id);
          setProgress({
            currentStep: currentStageIndex + 1,
            totalSteps: allStages.length,
            currentStage: parsedProgress.stage.name,
            percentage: parsedProgress.progress,
          });
        }
      }

      setLogs((prev) => {
        const next = [
          ...prev,
          {
            id: ++logIdRef.current,
            timestamp: new Date().toLocaleTimeString(),
            level: logLevel,
            message,
          },
        ];
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
      });
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [status]);

  // 监听游戏进程退出事件
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | null = null;
    listen<number>("game-exited", (event) => {
      const exitCode = event.payload;
      const timeStr = new Date().toLocaleString("zh-CN");
      setLastLaunchTime(timeStr);
      try { localStorage.setItem("rtl-last-launch-time", timeStr); } catch { /* ignore */ }
      setStatus("idle");
      setProgress(null); // 清理进度状态
      log4jParser.reset(); // 重置日志解析器
      setLogs((prev) => [
        ...prev,
        {
          id: ++logIdRef.current,
          timestamp: new Date().toLocaleTimeString(),
          level: exitCode === 0 ? "info" : "warn",
          message: `游戏已退出，退出码: ${exitCode}`,
        },
      ]);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // 监听游戏完全启动事件（JVM 启动完成、资源加载完成）
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | null = null;
    listen<number>("game-fully-started", (event) => {
      const pid = event.payload;
      setStatus("running");
      setProgress(null);
      setLogs((prev) => [
        ...prev,
        {
          id: ++logIdRef.current,
          timestamp: new Date().toLocaleTimeString(),
          level: "info",
          message: `游戏已完全启动 (PID ${pid})，停止 JVM 追踪`,
        },
      ]);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // 监听启动进度事件
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ current_step: number; total_steps: number; current_stage: string; percentage: number }>("launch-progress", (event) => {
      const { current_step, total_steps, current_stage, percentage } = event.payload;
      setProgress({
        currentStep: current_step,
        totalSteps: total_steps,
        currentStage: current_stage,
        percentage: percentage,
      });
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const cancelLaunch = useCallback(
    async () => {
      if (status !== "preparing" && status !== "launching" && status !== "running") {
        return;
      }
      try {
        const result = await invoke<string>("kill_game_process");
        setLogs((prev) => [
          ...prev,
          {
            id: ++logIdRef.current,
            timestamp: new Date().toLocaleTimeString(),
            level: "warn",
            message: result,
          },
        ]);
        setStatus("idle");
        setProgress(null);
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [status]
  );

  const launchGame = useCallback(
    async (overrides?: Partial<LaunchConfig>) => {
      const merged = { ...config, ...overrides };

      // 校验必要参数
      if (!merged.minecraftPath) {
        setErrorMessage("请设置 Minecraft 游戏目录");
        return;
      }
      if (!merged.javaPath) {
        setErrorMessage("请设置 Java 路径");
        return;
      }
      if (!merged.versionName) {
        setErrorMessage("请选择游戏版本");
        return;
      }
      if (!selectedProfile) {
        setErrorMessage("请先选择一个玩家账户");
        return;
      }

      setErrorMessage(null);
      setProgress(null);
      log4jParser.reset(); // 重置日志解析器
      setStatus("preparing");
      addLog("info", "正在准备启动参数...");

      try {
        setStatus("launching");
        addLog("info", `启动版本: ${merged.versionName}`);
        addLog("info", `玩家: ${selectedProfile.name}`);
        addLog("info", `最大内存: ${merged.maxMemory}MB`);

        if (merged.loadType !== "0") {
          addLog("info", `加载器: ${merged.loadName}`);
        }

        const result = await invoke<string>("launch_game", {
          minecraftPath: merged.minecraftPath,
          javaPath: merged.javaPath,
          wrapperPath: merged.wrapperPath,
          maxMemory: merged.maxMemory,
          versionName: merged.versionName,
          playerName: merged.playerName || selectedProfile.name,
          authToken: merged.authToken || selectedProfile.accessToken || "",
          uuid: merged.uuid || selectedProfile.uuid || selectedProfile.id,
          authlibInjectorPath: merged.authlibInjectorPath,
          yggdrasilApi: merged.yggdrasilApi || selectedProfile.yggdrasilUrl || "",
          prefetchedData: merged.prefetchedData,
          loadType: merged.loadType,
          loadName: merged.loadName,
          windowWidth: merged.windowWidth || "873",
          windowHeight: merged.windowHeight || "486",
        });

        setLastCommandArgs(result);
        setStatus("running");
        addLog("info", "游戏已启动！");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error");
        setErrorMessage(msg);
        addLog("error", `启动失败: ${msg}`);
      }
    },
    [config, selectedProfile, addLog]
  );

  return (
    <LaunchContext.Provider
      value={{
        config,
        updateConfig,
        status,
        logs,
        errorMessage,
        launchGame,
        cancelLaunch,
        clearLogs,
        lastCommandArgs,
        lastLaunchTime,
        configLoaded,
        progress,
      }}
    >
      {children}
    </LaunchContext.Provider>
  );
}
