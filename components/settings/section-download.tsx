"use client";

import { Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/components/settings/settings-provider";
import { useI18n } from "@/components/i18n/use-i18n";

export function DownloadSection() {
  const { settings, update } = useSettings();
  const { t } = useI18n();
  const enabled = settings.general.autoDownloadModDependencies;

  return (
    <Card id="section-download" className="scroll-mt-4">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="size-4 text-primary" />
          {t({ "zh-CN": "下载", "en-US": "Downloads" })}
        </CardTitle>
        <CardDescription className="mt-1 text-xs">
          {t({
            "zh-CN": "配置模组下载行为",
            "en-US": "Configure mod download behavior.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <Label className="text-sm font-medium">
              {t({ "zh-CN": "自动下载必需依赖", "en-US": "Download required dependencies" })}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t({
                "zh-CN": "下载 Modrinth 或 CurseForge 模组时，自动解析并下载与所选版本兼容的必需依赖；可选依赖不会下载。",
                "en-US": "When downloading Modrinth or CurseForge mods, automatically resolve and download compatible required dependencies. Optional dependencies are skipped.",
              })}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => update("general", { autoDownloadModDependencies: checked })}
            aria-label={t({ "zh-CN": "切换自动下载必需依赖", "en-US": "Toggle required dependency downloads" })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
