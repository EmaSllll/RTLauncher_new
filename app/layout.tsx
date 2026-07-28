import type { Metadata } from "next";
import "./globals.css";
import { TitleBar } from "@/components/title-bar";
import { Sidebar } from "@/components/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountProvider } from "@/components/accounts/account-provider";
import { DownloadProvider } from "@/components/download/download-provider";
import { DownloadTaskList } from "@/components/download/download-task-list";
import { LaunchProvider } from "@/components/launch/launch-provider";
import { FloatingLaunchButton } from "@/components/launch/floating-launch-button";
import { MultiplayerProvider } from "@/components/multiplayer/multiplayer-provider";
import { PageTransition } from "@/components/page-transition";
import { GlobalDragDrop } from "@/components/global/global-drag-drop";

export const metadata: Metadata = {
  title: "RTLauncher",
  description: "RTLauncher Desktop App",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased h-screen flex flex-col overflow-hidden bg-background">
        
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SettingsProvider>
            <AccountProvider>
              <LaunchProvider>
                <MultiplayerProvider>
                  <DownloadProvider>
                    <TooltipProvider>
                      {/* 全局拖放处理组件 - 必须放在 DownloadProvider 内部 */}
                      <GlobalDragDrop />
                       
                      <TitleBar />

                      <div className="flex flex-1 overflow-hidden">
                        <Sidebar />
          <main className="flex-1 overflow-hidden [view-transition-name:page-content]">
                          <PageTransition>{children}</PageTransition>
                        </main>
                      </div>

                      <DownloadTaskList />
                       
                      {/* 全局悬浮启动按钮 - 类似下载任务，所有页面可见 */}
                      <FloatingLaunchButton />
                    </TooltipProvider>
                  </DownloadProvider>
                </MultiplayerProvider>
              </LaunchProvider>
            </AccountProvider>
          </SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
