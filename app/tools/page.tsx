<<<<<<< HEAD
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

interface NewPackDialogState {
  open: boolean;
  format: "modrinth" | "curseforge";
  name: string;
  error?: string;
}

export default function ToolsPage() {
  const router = useRouter();

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
      setDialog({ ...dialog, error: "请输入名称" });
      return;
    }
    if (!/^[^\\/:*?"<>|\r\n]+$/.test(trimmed)) {
      setDialog({ ...dialog, error: "名称包含非法字符" });
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
      alert(`删除失败: ${e?.message || e}`);
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
            <h1 className="text-lg font-semibold leading-none">工具中心</h1>
            <p className="mt-1 text-xs text-muted-foreground">整合包制作与管理</p>
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
                <h3 className="font-semibold text-base">制作 Modrinth 整合包</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  通过 Modrinth API 搜索并添加文件，自动收集 path、sha1、sha256、
                  fileSize、downloadUrl；可指定每个文件的客户端/服务端依赖级别。
                </p>
                <Button
                  className="mt-4 w-full gap-2"
                  onClick={() => openNewPack("modrinth")}
                >
                  <Plus className="size-4" />
                  新建 Modrinth 整合包
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
                <h3 className="font-semibold text-base">制作 CurseForge 整合包</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  通过 CurseForge API 搜索，收集 projectID 与 fileID 对；
                  可勾选每个文件是否为必须安装。
                </p>
                <Button
                  className="mt-4 w-full gap-2"
                  onClick={() => openNewPack("curseforge")}
                >
                  <Plus className="size-4" />
                  新建 CurseForge 整合包
                </Button>
              </div>
            </motion.div>
          </div>

          {/* 已有实例列表 */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                我的整合包实例
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
                  刷新
                </Button>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder="搜索实例名称..."
                    value={instanceFilter}
                    onChange={(e) => setInstanceFilter(e.target.value)}
                    className="w-48 h-8 text-xs pl-8"
                  />
                </div>
              </div>
            </div>

            {dir && (
              <div className="mb-3 text-xs text-muted-foreground flex items-center gap-1">
                <Folder className="size-3" /> 保存位置：
                <span className="font-mono">{dir}</span>
              </div>
            )}

            {instLoading ? (
              <div className="py-8 flex items-center justify-center text-xs text-muted-foreground gap-2">
                <Loader2 className="size-4 animate-spin" /> 加载中...
              </div>
            ) : filteredInstances.length === 0 ? (
              <div className="py-8 text-center border border-dashed rounded-xl text-xs text-muted-foreground">
                {instances.length === 0
                  ? "暂无整合包实例，点击上方按钮创建第一个"
                  : "没有匹配此关键词的实例"}
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
                            {inst.file_count} 个文件 · MC {inst.game_version || "—"}
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
                              互联
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          更新：{formatTimestamp(inst.updated_at)}
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
                          编辑
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
              新建 {dialog.format === "modrinth" ? "Modrinth" : "CurseForge"} 整合包
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              给你的整合包取个名字，之后可随时修改。
            </p>
            <div className="mb-4">
              <label className="text-xs text-muted-foreground block mb-1">
                整合包名称 *
              </label>
              <Input
                autoFocus
                value={dialog.name}
                onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && confirmNewPack()}
                placeholder="如：My Fantastic Pack"
              />
              {dialog.error && (
                <div className="mt-1 text-xs text-red-500">{dialog.error}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={confirmNewPack}
                disabled={!dialog.name.trim()}
              >
                开始制作
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="font-semibold text-base mb-1">确认删除？</h3>
            <p className="text-xs text-muted-foreground mb-4">
              将从磁盘永久删除：
              <span className="block font-mono mt-1 text-primary">{pendingDelete}.json</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPendingDelete(null)}
              >
                取消
              </Button>
              <Button size="sm" variant="destructive" onClick={doDelete}>
                删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
=======
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

interface NewPackDialogState {
  open: boolean;
  format: "modrinth" | "curseforge";
  name: string;
  error?: string;
}

export default function ToolsPage() {
  const router = useRouter();

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
      setDialog({ ...dialog, error: "请输入名称" });
      return;
    }
    if (!/^[^\\/:*?"<>|\r\n]+$/.test(trimmed)) {
      setDialog({ ...dialog, error: "名称包含非法字符" });
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
      alert(`删除失败: ${e?.message || e}`);
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
            <h1 className="text-lg font-semibold leading-none">工具中心</h1>
            <p className="mt-1 text-xs text-muted-foreground">整合包制作与管理</p>
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
                <h3 className="font-semibold text-base">制作 Modrinth 整合包</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  通过 Modrinth API 搜索并添加文件，自动收集 path、sha1、sha256、
                  fileSize、downloadUrl；可指定每个文件的客户端/服务端依赖级别。
                </p>
                <Button
                  className="mt-4 w-full gap-2"
                  onClick={() => openNewPack("modrinth")}
                >
                  <Plus className="size-4" />
                  新建 Modrinth 整合包
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
                <h3 className="font-semibold text-base">制作 CurseForge 整合包</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  通过 CurseForge API 搜索，收集 projectID 与 fileID 对；
                  可勾选每个文件是否为必须安装。
                </p>
                <Button
                  className="mt-4 w-full gap-2"
                  onClick={() => openNewPack("curseforge")}
                >
                  <Plus className="size-4" />
                  新建 CurseForge 整合包
                </Button>
              </div>
            </motion.div>
          </div>

          {/* 已有实例列表 */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                我的整合包实例
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
                  刷新
                </Button>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder="搜索实例名称..."
                    value={instanceFilter}
                    onChange={(e) => setInstanceFilter(e.target.value)}
                    className="w-48 h-8 text-xs pl-8"
                  />
                </div>
              </div>
            </div>

            {dir && (
              <div className="mb-3 text-xs text-muted-foreground flex items-center gap-1">
                <Folder className="size-3" /> 保存位置：
                <span className="font-mono">{dir}</span>
              </div>
            )}

            {instLoading ? (
              <div className="py-8 flex items-center justify-center text-xs text-muted-foreground gap-2">
                <Loader2 className="size-4 animate-spin" /> 加载中...
              </div>
            ) : filteredInstances.length === 0 ? (
              <div className="py-8 text-center border border-dashed rounded-xl text-xs text-muted-foreground">
                {instances.length === 0
                  ? "暂无整合包实例，点击上方按钮创建第一个"
                  : "没有匹配此关键词的实例"}
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
                            {inst.file_count} 个文件 · MC {inst.game_version || "—"}
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
                              互联
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          更新：{formatTimestamp(inst.updated_at)}
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
                          编辑
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
              新建 {dialog.format === "modrinth" ? "Modrinth" : "CurseForge"} 整合包
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              给你的整合包取个名字，之后可随时修改。
            </p>
            <div className="mb-4">
              <label className="text-xs text-muted-foreground block mb-1">
                整合包名称 *
              </label>
              <Input
                autoFocus
                value={dialog.name}
                onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && confirmNewPack()}
                placeholder="如：My Fantastic Pack"
              />
              {dialog.error && (
                <div className="mt-1 text-xs text-red-500">{dialog.error}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog(null)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={confirmNewPack}
                disabled={!dialog.name.trim()}
              >
                开始制作
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="font-semibold text-base mb-1">确认删除？</h3>
            <p className="text-xs text-muted-foreground mb-4">
              将从磁盘永久删除：
              <span className="block font-mono mt-1 text-primary">{pendingDelete}.json</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPendingDelete(null)}
              >
                取消
              </Button>
              <Button size="sm" variant="destructive" onClick={doDelete}>
                删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
>>>>>>> 7e94b3d5fae96299a238ed4f26231cdffc1ac040
}