"use client";

import { useState, useEffect } from "react";
import {
  Search,
  RefreshCw,
  Loader2,
  Package,
  Box,
  Plus,
  Edit,
  Trash2,
  Folder,
  Sparkles,
  FileText,
} from "lucide-react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import {
  useModpackInstances,
  deleteInstance,
  getModpackDir,
  formatTimestamp,
} from "@/components/modpack/modpack-api";
import { useI18n } from "@/components/i18n/use-i18n";

interface NewPackDialogState {
  open: boolean;
  format: "modrinth" | "curseforge";
  name: string;
  error?: string;
}

export default function ToolsPage() {
  const router = useRouter();
  const { t } = useI18n();

  // 整合包实例
  const { instances, loading: instLoading, reload: reloadInstances } =
    useModpackInstances();
  const [instanceFilter, setInstanceFilter] = useState("");
  const [dir, setDir] = useState("");
  const [dialog, setDialog] = useState<NewPackDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    getModpackDir().then(setDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredInstances = instances.filter((inst) => {
    if (!instanceFilter.trim()) return true;
    const q = instanceFilter.toLowerCase();
    return inst.name.toLowerCase().includes(q);
  });

  // --------- 新建整合包：弹窗 ---------
  const openNewPack = (format: "modrinth" | "curseforge") => {
    setDialog({ open: true, format, name: "" });
  };

  const confirmNewPack = () => {
    if (!dialog) return;
    const trimmed = dialog.name.trim();
    if (!trimmed) {
      setDialog({ ...dialog, error: t({ "zh-CN": "请输入名称", "en-US": "Enter a name" }) });
      return;
    }
    if (!/^[^\\/:*?"<>|\r\n]+$/.test(trimmed)) {
      setDialog({ ...dialog, error: t({ "zh-CN": "名称包含非法字符", "en-US": "The name contains invalid characters" }) });
      return;
    }
    const url =
      dialog.format === "modrinth"
        ? `/tools/modpack-builder?type=modrinth&name=${encodeURIComponent(trimmed)}`
        : `/tools/modpack-builder?type=curseforge&name=${encodeURIComponent(trimmed)}`;
    setDialog(null);
    router.push(url);
  };

  const editInstance = (name: string, format: "modrinth" | "curseforge") => {
    const url = `/tools/modpack-builder?type=${format}&name=${encodeURIComponent(name)}&edit=1`;
    router.push(url);
  };

  const doDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteInstance(pendingDelete);
      await reloadInstances();
    } catch (e: any) {
      alert(`${t({ "zh-CN": "删除失败", "en-US": "Delete failed" })}: ${e?.message || e}`);
    }
    setPendingDelete(null);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* 顶部标题栏 */}
      <div className="shrink-0 border-b border-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
            <FileText className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none">{t({ "zh-CN": "工具中心", "en-US": "Tools" })}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{t({ "zh-CN": "整合包制作与管理", "en-US": "Create and manage modpacks" })}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* 两个整合包制作大卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Modrinth */}
            <motion.div
              whileHover={{ scale: 1.01 }}
              className="rounded-2xl border border-border bg-card overflow-hidden"
            >
              <div className="p-5 bg-gradient-to-br from-emerald-500/10 to-transparent">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/15">
                    <Package className="size-5 text-emerald-500" />
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    mrpack
                  </Badge>
                </div>
                <h3 className="font-semibold text-base">{t({ "zh-CN": "制作 Modrinth 整合包", "en-US": "Create a Modrinth modpack" })}</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {t({ "zh-CN": "通过 Modrinth API 搜索并添加文件，自动收集 path、SHA-1、SHA-512、fileSize 与下载地址，并导出标准 .mrpack。", "en-US": "Search and add files with the Modrinth API, collect path, SHA-1, SHA-512, fileSize, and download URL, and export a standard .mrpack." })}
                </p>
                <Button
                  className="mt-4 w-full gap-2"
                  onClick={() => openNewPack("modrinth")}
                >
                  <Plus className="size-4" />
                  {t({ "zh-CN": "新建 Modrinth 整合包", "en-US": "New Modrinth modpack" })}
                </Button>
              </div>
            </motion.div>

            {/* CurseForge */}
            <motion.div
              whileHover={{ scale: 1.01 }}
              className="rounded-2xl border border-border bg-card overflow-hidden"
            >
              <div className="p-5 bg-gradient-to-br from-amber-500/10 to-transparent">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15">
                    <Box className="size-5 text-amber-500" />
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    manifest.json
                  </Badge>
                </div>
                <h3 className="font-semibold text-base">{t({ "zh-CN": "制作 CurseForge 整合包", "en-US": "Create a CurseForge modpack" })}</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {t({ "zh-CN": "通过 CurseForge API 搜索，收集 projectID 与 fileID，生成标准 manifest.json 并导出 ZIP。", "en-US": "Search with the CurseForge API, collect projectID and fileID, generate a standard manifest.json, and export a ZIP." })}
                </p>
                <Button
                  className="mt-4 w-full gap-2"
                  onClick={() => openNewPack("curseforge")}
                >
                  <Plus className="size-4" />
                  {t({ "zh-CN": "新建 CurseForge 整合包", "en-US": "New CurseForge modpack" })}
                </Button>
              </div>
            </motion.div>
          </div>

          {/* 已有实例列表 */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                {t({ "zh-CN": "我的整合包实例", "en-US": "My modpack instances" })}
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={reloadInstances}
                  disabled={instLoading}
                >
                  <RefreshCw
                    className={`size-3.5 mr-1 ${instLoading ? "animate-spin" : ""}`}
                  />
                  {t({ "zh-CN": "刷新", "en-US": "Refresh" })}
                </Button>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder={t({ "zh-CN": "搜索实例名称...", "en-US": "Search instances..." })}
                    value={instanceFilter}
                    onChange={(e) => setInstanceFilter(e.target.value)}
                    className="w-48 h-8 text-xs pl-8"
                  />
                </div>
              </div>
            </div>

            {dir && (
              <div className="mb-3 text-xs text-muted-foreground flex items-center gap-1">
                <Folder className="size-3" /> {t({ "zh-CN": "保存位置：", "en-US": "Saved in:" })}
                <span className="font-mono">{dir}</span>
              </div>
            )}

            {instLoading ? (
              <div className="py-8 flex items-center justify-center text-xs text-muted-foreground gap-2">
                <Loader2 className="size-4 animate-spin" /> {t({ "zh-CN": "加载中...", "en-US": "Loading..." })}
              </div>
            ) : filteredInstances.length === 0 ? (
              <div className="py-8 text-center border border-dashed rounded-xl text-xs text-muted-foreground">
                {instances.length === 0
                  ? t({ "zh-CN": "暂无整合包实例，点击上方按钮创建第一个", "en-US": "No modpack instances yet. Create your first one above." })
                  : t({ "zh-CN": "没有匹配此关键词的实例", "en-US": "No instances match this search." })}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredInstances.map((inst) => (
                  <div
                    key={`${inst.format}-${inst.name}`}
                    className="border border-border rounded-xl p-3 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {inst.name}
                          </span>
                          <Badge
                            variant={inst.format === "modrinth" ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            {inst.format}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
                          <span>
                            {inst.file_count} {t({ "zh-CN": "个文件", "en-US": "files" })} · MC {inst.game_version || "—"}
                          </span>
                          {inst.loader && (
                            <Badge variant="outline" className="text-[9px] py-0">
                              {inst.loader}
                            </Badge>
                          )}
                          {inst.optifine && (
                            <Badge variant="outline" className="text-[9px] py-0">
                              OF
                            </Badge>
                          )}
                          {inst.cross_loader && (
                            <Badge
                              variant="outline"
                              className="text-[9px] py-0 text-amber-600 border-amber-400"
                            >
                              {t({ "zh-CN": "互联", "en-US": "Cross-loader" })}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {t({ "zh-CN": "更新：", "en-US": "Updated: " })}{formatTimestamp(inst.updated_at)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            editInstance(inst.name, inst.format as any)
                          }
                        >
                          <Edit className="size-3.5 mr-1" />
                          {t({ "zh-CN": "编辑", "en-US": "Edit" })}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete(inst.name)}
                        >
                          <Trash2 className="size-3.5 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新建整合包：命名弹窗 */}
      {dialog?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold text-base mb-1">
              {t({ "zh-CN": "新建", "en-US": "New" })} {dialog.format === "modrinth" ? "Modrinth" : "CurseForge"} {t({ "zh-CN": "整合包", "en-US": "modpack" })}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {t({ "zh-CN": "给你的整合包取个名字，之后可随时修改。", "en-US": "Give your modpack a name. You can change it later." })}
            </p>
            <div className="mb-4">
              <label className="text-xs text-muted-foreground block mb-1">
                {t({ "zh-CN": "整合包名称", "en-US": "Modpack name" })} *
              </label>
              <Input
                autoFocus
                value={dialog.name}
                onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && confirmNewPack()}
                placeholder={t({ "zh-CN": "如：My Fantastic Pack", "en-US": "e.g. My Fantastic Pack" })}
              />
              {dialog.error && (
                <div className="mt-1 text-xs text-red-500">{dialog.error}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog(null)}>
                {t({ "zh-CN": "取消", "en-US": "Cancel" })}
              </Button>
              <Button
                size="sm"
                onClick={confirmNewPack}
                disabled={!dialog.name.trim()}
              >
                {t({ "zh-CN": "开始制作", "en-US": "Start creating" })}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="font-semibold text-base mb-1">{t({ "zh-CN": "确认删除？", "en-US": "Delete this modpack?" })}</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {t({ "zh-CN": "将从磁盘永久删除：", "en-US": "This will be permanently removed from disk:" })}
              <span className="block font-mono mt-1 text-primary">{pendingDelete}.json</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPendingDelete(null)}
              >
                {t({ "zh-CN": "取消", "en-US": "Cancel" })}
              </Button>
              <Button size="sm" variant="destructive" onClick={doDelete}>
                {t({ "zh-CN": "删除", "en-US": "Delete" })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
