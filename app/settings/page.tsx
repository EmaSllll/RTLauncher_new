"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AppearanceSection } from "@/components/settings/section-appearance";
import { AboutSection } from "@/components/settings/section-about";
import { SidebarConfigSection } from "@/components/settings/section-sidebar-config";
import { LanguageSection } from "@/components/settings/section-language";
import { DownloadSection } from "@/components/settings/section-download";
import { useSettings, type AppLanguage } from "@/components/settings/settings-provider";
import { Settings, Sparkles, Package, Layout, Globe2, Download } from "lucide-react";

interface NavItem {
  id: string;
  label: Record<AppLanguage, string>;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: "section-language", label: { "zh-CN": "语言", "en-US": "Language" }, icon: <Globe2 className="size-4" /> },
  { id: "section-download", label: { "zh-CN": "下载", "en-US": "Downloads" }, icon: <Download className="size-4" /> },
  { id: "section-sidebar-config", label: { "zh-CN": "侧边栏配置", "en-US": "Sidebar" }, icon: <Layout className="size-4" /> },
  { id: "section-appearance", label: { "zh-CN": "外观", "en-US": "Appearance" }, icon: <Sparkles className="size-4" /> },
  { id: "section-about", label: { "zh-CN": "版本更新", "en-US": "Updates" }, icon: <Package className="size-4" /> },
];

const PAGE_COPY: Record<AppLanguage, { title: string; description: string; category: string; end: string }> = {
  "zh-CN": {
    title: "设置",
    description: "全局设置 —— 外观、主题、版本信息",
    category: "分类",
    end: "— 已经到底了 —",
  },
  "en-US": {
    title: "Settings",
    description: "Global settings — appearance, theme, and version information",
    category: "Categories",
    end: "— End of settings —",
  },
};

export default function SettingsPage() {
  const { settings } = useSettings();
  const language = settings.general.language;
  const copy = PAGE_COPY[language];
  const [activeId, setActiveId] = useState<string>("section-sidebar-config");

  // 使用 IntersectionObserver 自动高亮当前可见区域
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("[data-settings-content]");
    if (!scroller) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null;
        for (const e of entries) {
          if (e.isIntersecting) {
            if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
          }
        }
        if (best) setActiveId(best.target.id);
      },
      {
        root: scroller,
        rootMargin: "-30% 0px -55% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    for (const item of NAV_ITEMS) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const goTo = (id: string) => {
    const el = document.getElementById(id);
    const scroller = document.querySelector<HTMLElement>("[data-settings-content]");
    if (el && scroller) {
      const top = el.offsetTop - 16;
      scroller.scrollTo({ top, behavior: "smooth" });
      setActiveId(id);
    }
  };

  return (
    <div className="relative h-full overflow-hidden">
      {/* 页面标题 */}
      <div className="border-b border-border bg-background/60 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings className="size-3.5" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">{copy.title}</h1>
            <p className="text-xs text-muted-foreground">{copy.description}</p>
          </div>
        </div>
      </div>

      {/* 主体：两栏布局 */}
      <div className="flex h-[calc(100%-54px)]">
        {/* 左侧锚点导航 */}
        <nav className="hidden w-52 shrink-0 border-r border-border bg-background/30 p-3 md:block">
          <div className="sticky top-0 space-y-1">
            <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {copy.category}
            </div>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goTo(item.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                  activeId === item.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-foreground/80 hover:bg-accent/40"
                )}
              >
                {item.icon}
                <span>{item.label[language]}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* 右侧内容区 */}
        <main
          data-settings-content
          className="h-full flex-1 overflow-y-auto px-4 py-4 md:px-6"
        >
          <div className="mx-auto max-w-2xl space-y-4">
            <LanguageSection />
            <DownloadSection />
            <SidebarConfigSection />
            <AppearanceSection />
            <AboutSection />
            <div className="py-3 text-center text-xs text-muted-foreground">
              {copy.end}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
