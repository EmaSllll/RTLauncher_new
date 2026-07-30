"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useI18n, type Translation } from "@/components/i18n/use-i18n";

const NAV_ITEMS = [
  { href: "/game-settings/mods", label: { "zh-CN": "模组管理", "en-US": "Mods" } as Translation },
  { href: "/game-settings/resources", label: { "zh-CN": "资源包", "en-US": "Resource Packs" } as Translation },
  { href: "/game-settings/worlds", label: { "zh-CN": "存档", "en-US": "Worlds" } as Translation },
  { href: "/game-settings/shaders", label: { "zh-CN": "光影包", "en-US": "Shaders" } as Translation },
  { href: "/game-settings/datapacks", label: { "zh-CN": "数据包", "en-US": "Datapacks" } as Translation },
  { href: "/game-settings/schematics", label: { "zh-CN": "投影原理图", "en-US": "Schematics" } as Translation },
  { href: "/game-settings/screenshots", label: { "zh-CN": "截图", "en-US": "Screenshots" } as Translation },
];

export default function GameSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <div className="h-full flex flex-col">
      {/* 顶部导航栏 */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-background/80 backdrop-blur-sm">
        {/* 子页面 Tab 导航 */}
        <div className="flex gap-0.5 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              suppressHydrationWarning
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
                pathname === item.href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              {t(item.label)}
            </Link>
          ))}
        </div>
      </div>
      {/* 页面内容 */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
