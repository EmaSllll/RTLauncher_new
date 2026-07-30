"use client";

import { useCallback } from "react";
import { useSettings, type AppLanguage } from "@/components/settings/settings-provider";

export type Translation = Record<AppLanguage, string>;

/**
 * 统一的界面翻译入口。
 *
 * 新增界面文案时必须同时提供中文与英文，避免语言切换后出现未翻译文本。
 */
export function useI18n() {
  const { settings } = useSettings();
  const language = settings.general.language;
  const t = useCallback((translation: Translation) => translation[language], [language]);

  return { language, isEnglish: language === "en-US", t };
}
