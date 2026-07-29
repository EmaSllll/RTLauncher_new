"use client"

// 导航图标
import {
  Home,
  Download,
  Rocket,
  Wrench,
  Settings,
  Globe,
  Gamepad2,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useUIConfigContext } from "@/components/ui-config/ui-config-provider"

interface SidebarProps {
  className?: string
}

interface NavItem {
  id: string
  icon: React.ReactNode
  label: string
  href: string
  isAvatar?: boolean
}

// 所有导航项定义
const allNavItems: NavItem[] = [
  { id: "home", icon: <Home className="size-4" />, label: "首页", href: "/" },
  { id: "game-settings", icon: <Gamepad2 className="size-4" />, label: "游戏设置", href: "/game-settings" },
  { id: "launch", icon: <Rocket className="size-4" />, label: "启动", href: "/launch" },
  { id: "download", icon: <Download className="size-4" />, label: "下载", href: "/download" },
  { id: "multiplayer", icon: <Globe className="size-4" />, label: "联机", href: "/multiplayer" },
  { id: "tools", icon: <Wrench className="size-4" />, label: "工具", href: "/tools" },
  { id: "settings", icon: <Settings className="size-4" />, label: "设置", href: "/settings" },
]

// 导航按钮
function NavButton({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-label={item.label}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            item.isAvatar
              ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              : buttonVariants({ variant: "ghost", size: "icon" }),
            "relative overflow-hidden touch-manipulation",
            !item.isAvatar && isActive && "text-accent-foreground"
          )}
        >
          {item.isAvatar ? (
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-4xl transition-colors duration-200",
                isActive && "ring-2 ring-primary ring-offset-2 ring-offset-sidebar"
              )}
            >
              {item.icon}
            </span>
          ) : (
            <>
              {isActive && (
                <motion.span
                  layoutId="active-nav-indicator"
                  className="absolute inset-0 rounded-md bg-accent"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10">{item.icon}</span>
            </>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{item.label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function isNavItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

// 左侧边栏
export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname()
  const { config, configLoaded } = useUIConfigContext()

  const isActive = (href: string) => isNavItemActive(pathname, href)

  // 根据配置过滤可见的导航项
  const visibleNavItems = configLoaded
    ? allNavItems.filter(item => {
        const tabConfig = config.sidebarTabs.find(tab => tab.id === item.id);
        return tabConfig ? tabConfig.visible : true;
      })
    : allNavItems;

  // 分离顶部和底部导航项
  const topNavItems = visibleNavItems.filter(item => item.id !== "settings");
  const bottomNavItems = visibleNavItems.filter(item => item.id === "settings");

  return (
    <aside
      className={cn(
        "flex h-full w-14 flex-col border-r border-border bg-sidebar",
        className
      )}
    >
      <nav className="flex flex-1 flex-col items-center gap-2 p-2">
        {topNavItems.map((item) => (
          <NavButton key={item.href} item={item} isActive={isActive(item.href)} />
        ))}
      </nav>

      <div className="flex flex-col items-center gap-2 border-t border-border p-2">
        {bottomNavItems.map((item) => (
          <NavButton key={item.href} item={item} isActive={isActive(item.href)} />
        ))}
      </div>
    </aside>
  )
}