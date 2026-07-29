"use client"

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
import { usePathname, useRouter } from "next/navigation"
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

let activeNavigation: {
  transition: ViewTransition
  controller: AbortController
} | null = null

function waitForPageContent(
  main: HTMLElement,
  previousText: string,
  signal: AbortSignal
) {
  return new Promise<void>((resolve) => {
    let settled = false
    let settleTimer: number | undefined
    let timeoutTimer: number | undefined

    const finish = () => {
      if (settled) return
      settled = true
      observer.disconnect()
      window.clearTimeout(timeoutTimer)
      window.clearTimeout(settleTimer)
      signal.removeEventListener("abort", finish)
      resolve()
    }

    const observer = new MutationObserver(() => {
      if (main.innerText === previousText) return
      if (settleTimer !== undefined) return

      // 首批新内容出现后稍等几帧即开始交叉淡入，不再等待后续列表更新。
      settleTimer = window.setTimeout(finish, 60)
    })

    observer.observe(main, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    if (signal.aborted) {
      finish()
      return
    }

    signal.addEventListener("abort", finish, { once: true })
    timeoutTimer = window.setTimeout(finish, 700)
  })
}

const topNavItems: NavItem[] = [
  { icon: <Home className="size-4" />, label: "首页", href: "/" },
  { icon: <Gamepad2 className="size-4" />, label: "游戏设置", href: "/game-settings" },
  { icon: <Rocket className="size-4" />, label: "启动", href: "/launch" },
  { icon: <Download className="size-4" />, label: "下载", href: "/download" },
  { icon: <Globe className="size-4" />, label: "联机", href: "/multiplayer" },
  { icon: <Wrench className="size-4" />, label: "工具", href: "/tools" },
]

const bottomNavItems: NavItem[] = [
  { icon: <Settings className="size-4" />, label: "设置", href: "/settings" },
]

function NavButton({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const router = useRouter()

  const handleNavigation = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    if (isActive) {
      event.preventDefault()
      return
    }

    const startViewTransition = document.startViewTransition?.bind(document)
    if (!startViewTransition) return

    const main = document.querySelector<HTMLElement>("main")
    if (!main) return

    event.preventDefault()
    const previousText = main.innerText

    activeNavigation?.controller.abort()
    activeNavigation?.transition.skipTransition()

    const controller = new AbortController()
    const transition = startViewTransition(async () => {
      const contentReady = waitForPageContent(
        main,
        previousText,
        controller.signal
      )
      router.push(item.href)
      await contentReady
    })

    const navigation = { transition, controller }
    activeNavigation = navigation

    void transition.finished
      .catch(() => undefined)
      .finally(() => {
        if (activeNavigation === navigation) activeNavigation = null
      })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          onClick={handleNavigation}
          suppressHydrationWarning
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
