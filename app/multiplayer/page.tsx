"use client";

import { useEffect, useState, useRef } from "react";
import { Globe, Power, Loader2, AlertCircle, RefreshCw, Copy, Check, Server, Users, ScrollText } from "lucide-react";
import { useMultiplayerContext } from "@/components/multiplayer/multiplayer-provider";
import { OpenP2PInstaller } from "@/components/multiplayer/openp2p-installer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function MultiplayerPage() {
  const {
    status,
    errorMsg,
    runMode,
    roomInfo,
    logText,
    checkStatus,
    startAsHost,
    startAsJoin,
    stopOpenP2P,
    pollLog,
    clearLog,
    getOpenP2PDir,
    getOpenP2PPath,
  } = useMultiplayerContext();

  const [mode, setMode] = useState<"host" | "join">("host");
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [openP2PDir, setOpenP2PDir] = useState<string>("");
  const [openP2PPath, setOpenP2PPath] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [dirCopied, setDirCopied] = useState(false);
  const runningModeLabel =
    runMode === "host" ? "房主模式" : runMode === "join" ? "加入模式" : "后台进程";

  // 房主模式输入
  const [roomName, setRoomName] = useState("");
  const [port, setPort] = useState("25565");

  // 加入模式输入
  const [encodedInfo, setEncodedInfo] = useState("");
  const [playerName, setPlayerName] = useState("");

  const logRef = useRef<HTMLDivElement>(null);

  // 初始化：检查状态 + 获取 openp2p 目录/路径
  useEffect(() => {
    checkStatus();
    (async () => {
      const d = await getOpenP2PDir();
      const p = await getOpenP2PPath();
      setOpenP2PDir(d);
      setOpenP2PPath(p);
    })();
  }, [checkStatus, getOpenP2PDir, getOpenP2PPath]);

  // 运行时日志轮询：立即读取一次，之后每 1 秒拉取新增内容。
  // 在 starting/running 状态下都轮询，确保能看到启动阶段的输出
  useEffect(() => {
    if (status !== "running" && status !== "starting") return;
    void pollLog();
    const timer = setInterval(() => {
      void pollLog();
    }, 1000);
    return () => clearInterval(timer);
  }, [status, pollLog]);

  // 日志自动滚动
  useEffect(() => {
    if (logAutoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logText, logAutoScroll]);

  const handleStart = async () => {
    setStarting(true);
    try {
      if (mode === "host") {
        if (!roomName.trim()) return;
        if (!port.trim()) return;
        await startAsHost(roomName.trim(), port.trim());
      } else {
        if (!encodedInfo.trim()) return;
        if (!playerName.trim()) return;
        await startAsJoin(encodedInfo.trim(), playerName.trim());
      }
    } catch (e) {
      console.error("启动失败:", e);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopOpenP2P();
    } catch (e) {
      console.error("停止失败:", e);
    } finally {
      setStopping(false);
    }
  };

  const handleCopy = async () => {
    if (!roomInfo) return;
    try {
      await navigator.clipboard.writeText(roomInfo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("复制失败:", e);
    }
  };

  const handleCopyDir = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setDirCopied(true);
      setTimeout(() => setDirCopied(false), 2000);
    } catch (e) {
      console.error("复制失败:", e);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-hidden">
      {/* 顶部：标题 + 状态 */}
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
            <Globe className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none">多人联机</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              基于 OpenP2P 的联机工具 —— 后台运行，无命令窗口
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={checkStatus}
            title="刷新状态"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {status === "error" && errorMsg && (
        <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive shrink-0">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{errorMsg}</span>
        </div>
      )}

      {/* 调试信息：显示 openp2p 路径（便于定位问题） */}
      {openP2PPath && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2 shrink-0">
          <div className="flex-1 min-w-0">
            <span className="text-[10px] text-muted-foreground">OpenP2P 位置：</span>
            <code className="text-[11px] text-muted-foreground font-mono truncate ml-1">
              {openP2PPath}
            </code>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-[10px] px-2 shrink-0"
            onClick={() => handleCopyDir(openP2PPath)}
          >
            {dirCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
            <span>{dirCopied ? "已复制" : "复制"}</span>
          </Button>
        </div>
      )}

      {/* 主体 */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-auto">
        {status === "running" ? (
          /* 运行中：显示运行状态 + 日志面板 */
          <div className="flex-1 min-h-0 rounded-xl border border-border bg-card overflow-hidden flex flex-col">
            {/* 控制栏 */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30 shrink-0">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <div className="size-2 rounded-full bg-green-500 animate-pulse" />
                <span className="font-medium">
                  OpenP2P 正在运行（{runningModeLabel}）
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStop}
                  disabled={stopping}
                  className="gap-1.5"
                >
                  <Power className="size-3.5" />
                  <span>{stopping ? "停止中..." : "停止联机"}</span>
                </Button>
              </div>
            </div>

            {/* 状态 + 日志双栏 */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
              {/* 左侧：状态信息 */}
              <div className="lg:w-[45%] lg:border-r border-border flex flex-col items-center justify-center gap-5 p-6 overflow-auto">
                <div className="size-20 rounded-2xl bg-green-500/10 flex items-center justify-center shrink-0">
                  {runMode === "host" ? (
                    <Server className="size-10 text-green-600 dark:text-green-400" />
                  ) : (
                    <Users className="size-10 text-green-600 dark:text-green-400" />
                  )}
                </div>

                <div className="text-center space-y-2 max-w-md">
                  <h2 className="text-lg font-semibold text-foreground">
                    {runMode === "host"
                      ? "房间已创建"
                      : runMode === "join"
                        ? "已加入房间"
                        : "OpenP2P 已在后台运行"}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    OpenP2P 正在后台静默运行，不会弹出任何命令窗口。
                    下方日志面板实时显示运行状态反馈。
                  </p>
                </div>

                {/* 房间编码信息（可复制） */}
                {runMode === "host" && roomInfo && (
                  <div className="w-full max-w-lg space-y-2">
                    <div className="text-xs text-muted-foreground text-center">
                      将此编码分享给其他玩家以加入你的房间：
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2">
                      <code className="flex-1 text-xs text-foreground break-all font-mono">
                        {roomInfo}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopy}
                        className="shrink-0 gap-1.5"
                      >
                        {copied ? (
                          <>
                            <Check className="size-3.5 text-green-600" />
                            <span>已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5" />
                            <span>复制</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* 加入模式下显示已用的编码 */}
                {runMode === "join" && roomInfo && (
                  <div className="w-full max-w-lg space-y-2">
                    <div className="text-xs text-muted-foreground text-center">当前使用的房间编码：</div>
                    <div className="rounded-lg border border-border bg-background/50 px-3 py-2">
                      <code className="text-xs text-muted-foreground break-all font-mono">{roomInfo}</code>
                    </div>
                  </div>
                )}
              </div>

              {/* 右侧：运行日志 */}
              <div className="flex-1 min-h-0 flex flex-col border-t lg:border-t-0 border-border">
                <div className="flex items-center justify-between px-4 py-2 bg-muted/20 shrink-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ScrollText className="size-3.5" />
                    <span className="font-medium">运行日志</span>
                    {openP2PDir && (
                      <span className="text-[10px] text-muted-foreground/70">（来自 {openP2PDir}）</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={logAutoScroll}
                        onChange={(e) => setLogAutoScroll(e.target.checked)}
                        className="rounded border-border"
                      />
                      自动滚动
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearLog}
                      className="h-6 text-[10px] px-2"
                    >
                      清空
                    </Button>
                  </div>
                </div>
                <div
                  ref={logRef}
                  className="flex-1 min-h-0 overflow-auto bg-[#071a2e] dark:bg-[#061322] p-3 font-mono text-[11px] leading-relaxed"
                >
                  {logText ? (
                    <pre className="whitespace-pre-wrap break-all text-green-400/90 dark:text-green-300/90">
                      {logText}
                    </pre>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400">
                      <Loader2 className="size-4 animate-spin" />
                      <p className="text-[11px]">正在等待 OpenP2P 输出日志...</p>
                      <p className="text-[10px]">如果长时间没有内容，可能是 openp2p 启动失败或参数不正确</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : starting || stopping ? (
          <div className="flex-1 rounded-xl border border-border bg-card flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">
              {starting ? "正在启动 OpenP2P..." : "正在停止 OpenP2P..."}
            </p>
            <p className="text-xs text-muted-foreground">请稍候...</p>
          </div>
        ) : status === "installed" ? (
          <div className="flex-1 rounded-xl border border-border bg-card flex flex-col p-6 gap-6">
            {/* 模式切换 */}
            <div className="flex items-center gap-2 justify-center">
              <Button
                variant={mode === "host" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("host")}
                className="gap-1.5"
              >
                <Server className="size-3.5" />
                <span>创建房间（房主）</span>
              </Button>
              <Button
                variant={mode === "join" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("join")}
                className="gap-1.5"
              >
                <Users className="size-3.5" />
                <span>加入房间</span>
              </Button>
            </div>

            {/* 房主模式表单 */}
            {mode === "host" && (
              <div className="flex-1 flex flex-col items-center justify-center gap-5 max-w-md mx-auto w-full">
                <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Server className="size-8 text-primary" />
                </div>
                <div className="text-center space-y-1 w-full">
                  <h2 className="text-base font-semibold text-foreground">创建房间</h2>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    设置房间名和游戏端口号。启动后将生成房间编码，分享给其他玩家即可加入。
                  </p>
                </div>

                <div className="w-full space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">房间名</label>
                    <input
                      type="text"
                      value={roomName}
                      onChange={(e) => setRoomName(e.target.value)}
                      placeholder="例如：my_room"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">端口号</label>
                    <input
                      type="text"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="例如：25565"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary font-mono"
                    />
                    <p className="flex items-start gap-1.5 text-sm font-semibold leading-relaxed text-red-600 dark:text-red-400">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>
                        重要：请填写 Minecraft“对局域网开放”后显示的局域网联机端口号！
                      </span>
                    </p>
                  </div>

                  <Button onClick={handleStart} className="gap-2 mt-2 w-full" disabled={starting || !roomName.trim() || !port.trim()}>
                    <Power className="size-4" />
                    <span>启动联机</span>
                  </Button>
                </div>
              </div>
            )}

            {/* 加入模式表单 */}
            {mode === "join" && (
              <div className="flex-1 flex flex-col items-center justify-center gap-5 max-w-md mx-auto w-full">
                <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Users className="size-8 text-primary" />
                </div>
                <div className="text-center space-y-1 w-full">
                  <h2 className="text-base font-semibold text-foreground">加入房间</h2>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    输入房主提供的房间编码和你的玩家名，即可加入房间。
                  </p>
                </div>

                <div className="w-full space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">房间编码</label>
                    <input
                      type="text"
                      value={encodedInfo}
                      onChange={(e) => setEncodedInfo(e.target.value)}
                      placeholder="房主分享的 Base64 编码"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">玩家名</label>
                    <input
                      type="text"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="你的游戏玩家名"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                    />
                  </div>

                  <Button
                    onClick={handleStart}
                    className="gap-2 mt-2 w-full"
                    disabled={starting || !encodedInfo.trim() || !playerName.trim()}
                  >
                    <Power className="size-4" />
                    <span>加入联机</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : status === "not_installed" ? (
          <div className="flex-1 rounded-xl border border-border bg-card flex flex-col items-center justify-center gap-4 p-6">
            <div className="size-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="size-8 text-destructive" />
            </div>
            <div className="text-center space-y-1">
              <h2 className="text-base font-semibold text-foreground">尚未安装 OpenP2P</h2>
              <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
                多人联机功能需要 openp2p.exe 作为外置联机工具。
                请将 openp2p 可执行文件拖入此窗口完成安装。
              </p>
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg">
              <div className="size-1.5 rounded-full bg-primary" />
              <span>将 openp2p.exe 文件拖入窗口即可完成安装</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 rounded-xl border border-border bg-card flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm">正在检查 OpenP2P 状态...</p>
          </div>
        )}
      </div>

      {/* 拖入安装对话框 */}
      <OpenP2PInstaller />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; dot: string; bg: string; text: string }> = {
    idle: { label: "检查中", dot: "bg-muted-foreground/40", bg: "bg-muted", text: "text-muted-foreground" },
    not_installed: { label: "未安装", dot: "bg-destructive", bg: "bg-destructive/10", text: "text-destructive" },
    installed: { label: "就绪", dot: "bg-emerald-500", bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-400" },
    starting: { label: "启动中", dot: "bg-primary", bg: "bg-primary/10", text: "text-primary" },
    running: { label: "运行中", dot: "bg-green-500 animate-pulse", bg: "bg-green-500/10", text: "text-green-700 dark:text-green-400" },
    stopping: { label: "停止中", dot: "bg-orange-500", bg: "bg-orange-500/10", text: "text-orange-700 dark:text-orange-400" },
    error: { label: "出错", dot: "bg-destructive", bg: "bg-destructive/10", text: "text-destructive" },
  };

  const c = config[status] ?? config.idle;

  return (
    <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", c.bg, c.text)}>
      <span className={cn("size-1.5 rounded-full", c.dot)} />
      {c.label}
    </div>
  );
}
