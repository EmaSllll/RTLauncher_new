"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/game-settings/mods", label: "模组管理" },
  { href: "/game-settings/resources", label: "资源包" },
  { href: "/game-settings/worlds", label: "存档" },
  { href: "/game-settings/shaders", label: "光影包" },
  { href: "/game-settings/datapacks", label: "数据包" },
  { href: "/game-settings/schematics", label: "投影原理图" },
  { href: "/game-settings/screenshots", label: "截图" },
];

export default function GameSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

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
              {item.label}
            </Link>
          ))}
        </div>
      </div>
      {/* 页面内容 */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
