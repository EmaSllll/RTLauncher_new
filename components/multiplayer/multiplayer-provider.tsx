"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type OpenP2PStatus =
  | "idle"
  | "not_installed"
  | "installed"
  | "starting"
  | "running"
  | "stopping"
  | "error";

type RunMode = "host" | "join";

type MultiplayerContextValue = {
  status: OpenP2PStatus;
  errorMsg: string | null;
  runMode: RunMode | null;
  roomInfo: string | null; // 房主模式下的编码房间信息
  logText: string; // openp2p 运行日志
  checkStatus: () => Promise<void>;
  installOpenP2P: (srcPath: string) => Promise<string>;
  startAsHost: (roomName: string, port: string) => Promise<string>;
  startAsJoin: (encodedInfo: string, playerName: string) => Promise<string>;
  stopOpenP2P: () => Promise<void>;
  isRunning: () => Promise<boolean>;
  pollLog: () => Promise<string>; // 拉取新增日志
  clearLog: () => void;
  getOpenP2PDir: () => Promise<string>;
  getOpenP2PPath: () => Promise<string>;
};

const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

export function useMultiplayerContext() {
  const ctx = useContext(MultiplayerContext);
  if (!ctx) {
    throw new Error("useMultiplayerContext must be used within MultiplayerProvider");
  }
  return ctx;
}

export function MultiplayerProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<OpenP2PStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [runMode, setRunMode] = useState<RunMode | null>(null);
  const [roomInfo, setRoomInfo] = useState<string | null>(null);
  const [logText, setLogText] = useState<string>("");

  const checkStatus = useCallback(async () => {
    try {
      const installed = await invoke<boolean>("mp_check_openp2p");
      if (!installed) {
        setStatus("not_installed");
        return;
      }
      const running = await invoke<boolean>("mp_is_openp2p_running");
      setStatus(running ? "running" : "installed");
    } catch (e) {
      setStatus("error");
      setErrorMsg(typeof e === "string" ? e : (e as Error)?.message ?? "状态检查失败");
    }
  }, []);

  const installOpenP2P = useCallback(async (srcPath: string): Promise<string> => {
    const dest = await invoke<string>("mp_install_openp2p", { srcPath });
    await checkStatus();
    return dest;
  }, [checkStatus]);

  const startAsHost = useCallback(async (roomName: string, port: string): Promise<string> => {
    setStatus("starting");
    setErrorMsg(null);
    setLogText("");
    try {
      // 先生成房间编码信息（用于分享给玩家）
      const encoded = await invoke<string>("mp_encode_room_info", { roomName, portCount: port });
      // 然后启动房主模式的 openp2p
      const path = await invoke<string>("mp_start_openp2p_host", { roomName });
      setStatus("running");
      setRunMode("host");
      setRoomInfo(encoded);
      return path;
    } catch (e) {
      setStatus("error");
      setErrorMsg(typeof e === "string" ? e : (e as Error)?.message ?? "启动失败");
      throw e;
    }
  }, []);

  const startAsJoin = useCallback(async (encodedInfo: string, playerName: string): Promise<string> => {
    setStatus("starting");
    setErrorMsg(null);
    setLogText("");
    try {
      const path = await invoke<string>("mp_start_openp2p_join", { encodedValue: encodedInfo, playerName });
      setStatus("running");
      setRunMode("join");
      setRoomInfo(encodedInfo);
      return path;
    } catch (e) {
      setStatus("error");
      setErrorMsg(typeof e === "string" ? e : (e as Error)?.message ?? "启动失败");
      throw e;
    }
  }, []);

  const stopOpenP2P = useCallback(async () => {
    setStatus("stopping");
    try {
      await invoke<void>("mp_stop_openp2p");
      setStatus("installed");
      setRunMode(null);
      setRoomInfo(null);
    } catch (e) {
      setStatus("error");
      setErrorMsg(typeof e === "string" ? e : (e as Error)?.message ?? "停止失败");
    }
  }, []);

  const isRunning = useCallback(async (): Promise<boolean> => {
    try {
      return await invoke<boolean>("mp_is_openp2p_running");
    } catch (e) {
      console.error("检查 openp2p 运行状态失败:", e);
      return false;
    }
  }, []);

  const pollLog = useCallback(async (): Promise<string> => {
    try {
      const newLog = await invoke<string>("mp_poll_log");
      if (newLog) {
        setLogText(prev => prev + (prev && !prev.endsWith("\n") ? "\n" : "") + newLog);
      }
      return newLog;
    } catch (e) {
      console.error("轮询 openp2p 日志失败:", e);
      return "";
    }
  }, []);

  const clearLog = useCallback(() => {
    setLogText("");
  }, []);

  const getOpenP2PDir = useCallback(async (): Promise<string> => {
    try {
      return await invoke<string>("mp_get_openp2p_dir");
    } catch (e) {
      console.error("获取 openp2p 目录失败:", e);
      return "";
    }
  }, []);

  const getOpenP2PPath = useCallback(async (): Promise<string> => {
    try {
      return await invoke<string>("mp_get_openp2p_path");
    } catch (e) {
      console.error("获取 openp2p 路径失败:", e);
      return "";
    }
  }, []);

  return (
    <MultiplayerContext.Provider
      value={{
        status,
        errorMsg,
        runMode,
        roomInfo,
        logText,
        checkStatus,
        installOpenP2P,
        startAsHost,
        startAsJoin,
        stopOpenP2P,
        isRunning,
        pollLog,
        clearLog,
        getOpenP2PDir,
        getOpenP2PPath,
      }}
    >
      {children}
    </MultiplayerContext.Provider>
  );
}