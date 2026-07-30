"use client";

import { Globe2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings, type AppLanguage } from "@/components/settings/settings-provider";

const COPY = {
  "zh-CN": {
    title: "语言",
    description: "选择启动器界面语言",
    system: "首次使用时会根据系统语言自动选择。",
    chinese: "中文",
    english: "英文",
  },
  "en-US": {
    title: "Language",
    description: "Choose the launcher interface language",
    system: "The system language is used automatically on first launch.",
    chinese: "Chinese",
    english: "English",
  },
} as const;

export function LanguageSection() {
  const { settings, update } = useSettings();
  const { language } = settings.general;
  const copy = COPY[language];

  return (
    <Card id="section-language" className="scroll-mt-4">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe2 className="size-4 text-primary" />
          {copy.title}
        </CardTitle>
        <CardDescription className="text-xs mt-1">{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={language}
          onValueChange={(value) => update("general", { language: value as AppLanguage })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">{copy.chinese}</SelectItem>
            <SelectItem value="en-US">{copy.english}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{copy.system}</p>
      </CardContent>
    </Card>
  );
}
