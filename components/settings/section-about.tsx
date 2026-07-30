"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Check, RefreshCcw, Package, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/use-i18n";

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "up-to-date" }
  | { kind: "error"; message: string };

export function AboutSection() {
  const { t } = useI18n();
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const [installing, setInstalling] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        setVersion(v);
      } catch {
        setVersion("dev");
      }
    })();
  }, []);

  const check = async () => {
    setState({ kind: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update?.available) {
        setState({
          kind: "available",
          version: update.version ?? "",
          notes: (update.body ?? "").toString(),
        });
      } else {
        setState({ kind: "up-to-date" });
      }
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const install = async () => {
    setInstalling(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update?.available) return;
      await update.downloadAndInstall(() => {});
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setInstalling(false);
    }
  };

  // 首次进入自动检查一次
  useEffect(() => {
    const t = setTimeout(() => {
      if (state.kind === "idle") check();
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card id="section-about" className="scroll-mt-4">
      <CardHeader className="pb-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="size-4 text-primary" />
            {t({ "zh-CN": "版本更新", "en-US": "Updates" })}
          </CardTitle>
          <CardDescription className="text-xs mt-1">
            {t({ "zh-CN": "当前版本、检查启动器更新", "en-US": "Current version and launcher updates" })}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <Sparkles className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">RTLauncher</div>
            <div className="text-xs text-muted-foreground">
              {t({ "zh-CN": "版本", "en-US": "Version" })} <span className="font-mono">{version ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <RefreshCcw className={cn("size-3.5 text-muted-foreground", state.kind === "checking" && "animate-spin")} />
              {state.kind === "idle" && t({ "zh-CN": "尚未检查更新", "en-US": "Updates have not been checked" })}
              {state.kind === "checking" && t({ "zh-CN": "正在检查更新...", "en-US": "Checking for updates..." })}
              {state.kind === "up-to-date" && <span className="text-emerald-600 dark:text-emerald-400">{t({ "zh-CN": "已是最新版本", "en-US": "You're up to date" })}</span>}
              {state.kind === "available" && (
                <span className="text-amber-600 dark:text-amber-400">{t({ "zh-CN": "发现新版本", "en-US": "New version available" })} v{state.version}</span>
              )}
              {state.kind === "error" && <span className="text-destructive">{t({ "zh-CN": "检查失败", "en-US": "Update check failed" })}</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={check} disabled={state.kind === "checking"} className="gap-1.5 h-8">
                <RefreshCcw className={cn("size-3.5", state.kind === "checking" && "animate-spin")} />
                {t({ "zh-CN": "检查更新", "en-US": "Check for updates" })}
              </Button>
              {state.kind === "available" && (
                <Button size="sm" onClick={install} disabled={installing} className="gap-1.5 h-8">
                  {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  {installing
                    ? t({ "zh-CN": "安装中", "en-US": "Installing" })
                    : t({ "zh-CN": "立即安装", "en-US": "Install now" })}
                </Button>
              )}
            </div>
          </div>

          {state.kind === "available" && state.notes && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground/80">
              {state.notes}
            </pre>
          )}

          {state.kind === "error" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {state.message}
            </div>
          )}

          {state.kind === "up-to-date" && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="size-3.5" />
              {t({ "zh-CN": "启动器已在最新版本。", "en-US": "The launcher is up to date." })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
