"use client";

import { useState, useEffect } from "react";
import { LayoutGrid, Copy, Check, X, Plus } from "lucide-react";
import { useLaunchContext } from "@/components/launch/launch-provider";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";

interface SchematicFile {
  name: string;
  path: string;
  size: number;
}

export default function GameSettingsSchematics() {
  const { config, configLoaded } = useLaunchContext();
  const [schematics, setSchematics] = useState<SchematicFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<SchematicFile | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const schematicsDir = config.minecraftPath
    ? `${config.minecraftPath}/schematics`
    : undefined;

  useEffect(() => {
    if (!configLoaded || !schematicsDir) {
      setLoading(false);
      return;
    }

    const loadSchematics = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const files = await invoke<Array<{ name: string; path: string; size: number; is_dir: boolean }>>(
          "vm_list_dir", 
          { dirPath: schematicsDir, extensionsFilter: ["schematic", "schem"] }
        );
        
        const schematicFiles = files
          .filter(f => !f.is_dir)
          .sort((a, b) => a.name.localeCompare(b.name));
        
        setSchematics(schematicFiles);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    loadSchematics();
  }, [configLoaded, schematicsDir]);

  const handleCopyToClipboard = async (path: string, index: number) => {
    try {
      const base64 = await invoke<string>("read_file_base64", { path });
      const blob = await fetch(`data:application/octet-stream;base64,${base64}`).then(r => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ "application/octet-stream": blob })]);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleUploadFiles = async () => {
    if (!schematicsDir) return;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ".schematic,.schem";
    input.style.display = 'none';
    
    document.body.appendChild(input);
    
    input.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) {
        document.body.removeChild(input);
        return;
      }

      for (const file of Array.from(files)) {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const base64 = btoa(String.fromCharCode(...bytes));
        
        await invoke("vm_write_file_base64", {
          dirPath: schematicsDir,
          fileName: file.name,
          contentBase64: base64,
        });
      }
      
      // 刷新投影列表
      const refreshedFiles = await invoke<Array<{ name: string; path: string; size: number; is_dir: boolean }>>(
        "vm_list_dir", 
        { dirPath: schematicsDir, extensionsFilter: ["schematic", "schem"] }
      );
      
      const schematicFiles = refreshedFiles
        .filter(f => !f.is_dir)
        .sort((a, b) => a.name.localeCompare(b.name));
      
      setSchematics(schematicFiles);
      
      document.body.removeChild(input);
    });
    
    input.click();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  if (!configLoaded) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (!config.minecraftPath) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-4">
        <LayoutGrid className="size-12 text-muted-foreground" />
        <p className="text-sm font-medium">未配置游戏目录</p>
        <p className="text-xs text-muted-foreground">请先配置游戏目录路径</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-blue-500/10">
            <LayoutGrid className="size-5 text-blue-500" />
          </div>
          <div>
            <h1 className="text-base font-semibold">投影管理</h1>
            <p className="text-xs text-muted-foreground">{schematics.length} 个投影文件</p>
          </div>
        </div>
        <Button variant="default" size="icon" className="size-8" onClick={handleUploadFiles} title="上传投影文件">
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="size-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-medium">加载投影失败</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        ) : schematics.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <LayoutGrid className="size-12 text-muted-foreground" />
            <p className="text-sm font-medium">暂无投影文件</p>
            <p className="text-xs text-muted-foreground">将投影文件放入 schematics 文件夹即可</p>
          </div>
        ) : (
          <div className="space-y-2">
            {schematics.map((file, index) => (
              <div
                key={file.path}
                className="flex items-center justify-between p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors cursor-pointer group"
                onClick={() => setSelectedFile(file)}
              >
                <div className="flex items-center gap-3">
                  <LayoutGrid className="size-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium truncate max-w-xs">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); handleCopyToClipboard(file.path, index); }}
                >
                  {copiedIndex === index ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedFile && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setSelectedFile(null)}>
          <div className="bg-background rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <LayoutGrid className="size-6 text-muted-foreground" />
                <div>
                  <h3 className="font-semibold">{selectedFile.name}</h3>
                  <p className="text-sm text-muted-foreground">{formatSize(selectedFile.size)}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedFile(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-3">
              <Button className="w-full" onClick={() => { handleCopyToClipboard(selectedFile.path, -1); setSelectedFile(null); }}>
                <Copy className="size-4 mr-2" />
                复制文件
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
