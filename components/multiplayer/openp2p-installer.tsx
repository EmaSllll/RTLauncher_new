"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OpenP2PDownloadLink } from "@/components/multiplayer/openp2p-download-link";
import { useMultiplayerContext } from "@/components/multiplayer/multiplayer-provider";
import { AlertCircle, CheckCircle2, Loader2, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";

type InstallStatus =
  | "checking"
  | "not_installed"
  | "installed"
  | "installing"
  | "success"
  | "error";

export function OpenP2PInstaller() {
  const { installOpenP2P, checkStatus, status } = useMultiplayerContext();
  const router = useRouter();

  const [innerStatus, setInnerStatus] = useState<InstallStatus>("checking");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const handleExit = () => {
    setClosing(true);
    setTimeout(() => {
      setDialogOpen(false);
      setClosing(false);
      router.push("/");
    }, 300);
  };

  // 用 ref 追踪 dialogOpen，避免 effect 重新注册
  const dialogOpenRef = useRef(dialogOpen);
  dialogOpenRef.current = dialogOpen;

  // 检查是否已安装，未安装时自动弹窗
  useEffect(() => {
    checkStatus();
    // 根据 provider 的状态同步本地状态
    if (status === "not_installed") {
      setInnerStatus("not_installed");
      setDialogOpen(true);
    } else if (status === "installed" || status === "running" || status === "starting" || status === "stopping") {
      setInnerStatus("installed");
    }
  }, [checkStatus, status]);

  // 监听 Tauri 拖拽事件，仅在对话框打开时处理
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        const { getCurrentWebviewWindow } = await import(
          "@tauri-apps/api/webviewWindow"
        );
        const webview = getCurrentWebviewWindow();

        const fn = await webview.onDragDropEvent(async (event) => {
          if (!dialogOpenRef.current) return;

          if (event.payload.type === "over") {
            setIsDragOver(true);
            return;
          }
          if (event.payload.type === "leave") {
            setIsDragOver(false);
            return;
          }
          if (event.payload.type === "drop") {
            setIsDragOver(false);
            const paths = event.payload.paths;
            if (!paths || paths.length === 0) return;

            const src = paths[0];
            setInnerStatus("installing");
            setErrorMsg(null);
            try {
              await installOpenP2P(src);
              setInnerStatus("success");
              setTimeout(() => {
                setClosing(true);
                setTimeout(() => {
                  setDialogOpen(false);
                  setClosing(false);
                  setInnerStatus("installed");
                }, 300);
              }, 500);
            } catch (e) {
              setInnerStatus("error");
              setErrorMsg(typeof e === "string" ? e : (e as Error)?.message ?? "安装失败");
            }
          }
        });

        unlisten = fn;
      } catch {
        // 非 Tauri 环境忽略
      }
    };

    setup();
    return () => {
      unlisten?.();
    };
  }, [installOpenP2P]);

  // 已安装则不渲染任何内容
  if (innerStatus === "installed" || innerStatus === "checking") return null;

  return (
    <>
      {/* 安装对话框遮罩 */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 遮罩 */}
          <div
            className={cn(
              "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300",
              closing ? "opacity-0" : "opacity-100"
            )}
          />
          {/* 对话框 */}
          <div
            className={cn(
              "relative z-10 w-full max-w-md mx-4 rounded-2xl bg-background border shadow-2xl p-6 space-y-4 transition-all duration-300",
              closing ? "opacity-0 scale-95" : "opacity-100 scale-100"
            )}
          >
            <button
              type="button"
              className="absolute top-3 right-3 size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              onClick={handleExit}
              disabled={innerStatus === "installing"}
            >
              <X className="size-4" />
            </button>

            <div className="space-y-1 pr-8">
              <h3 className="text-base font-semibold">安装 OpenP2P</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                多人联机功能需要 openp2p 作为联机工具。请将 openp2p 可执行文件拖入此窗口完成安装。
              </p>
            </div>

            <OpenP2PDownloadLink />

            {/* 拖放区域 */}
            <div
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors duration-200",
                isDragOver
                  ? "border-primary bg-primary/5 text-primary"
                  : innerStatus === "success"
                  ? "border-green-500 bg-green-500/5"
                  : innerStatus === "error"
                  ? "border-destructive bg-destructive/5"
                  : "border-border text-muted-foreground",
                (innerStatus === "installing" || innerStatus === "success") &&
                  "pointer-events-none"
              )}
            >
              {innerStatus === "installing" ? (
                <>
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <p className="text-sm font-medium">安装中...</p>
                </>
              ) : innerStatus === "success" ? (
                <>
                  <CheckCircle2 className="size-6 text-green-500" />
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">
                    安装成功
                  </p>
                </>
              ) : (
                <>
                  <UploadCloud className={cn("size-8", isDragOver && "text-primary")} />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      将 openp2p 可执行文件拖到此处
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Windows 版本通常命名为 openp2p.exe
                    </p>
                  </div>
                </>
              )}
            </div>

            {innerStatus === "error" && errorMsg && (
              <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                <span className="break-all">{errorMsg}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
