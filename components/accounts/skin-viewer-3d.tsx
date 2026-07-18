"use client";

import { useEffect, useRef, useState } from "react";
import * as skinview3d from "skinview3d";

/**
 * Minecraft 3D 皮肤查看器（基于 skinview3d 库，该库使用 three.js）
 *
 * skinview3d 是成熟的 Minecraft 皮肤渲染库，支持：
 *  - 64x64（1.8+）双层皮肤（帽子/外套/外袖/外裤）
 *  - 64x32（1.8 前）旧格式
 *  - slim（细胳膊）与 classic（粗胳膊）两种模型
 *  - 披风渲染
 *  - 鼠标拖拽旋转
 *  - 自动旋转动画
 */

type SkinViewer3DProps = {
  skinSrc: string;          // PNG 皮肤的 URL 或 base64 (data:image/png;base64,...)
  capeSrc?: string;         // 披风贴图（可选）
  playerName?: string;
  width?: number;
  height?: number;
  modelType?: "classic" | "slim";
  autoRotate?: boolean;
};

export function SkinViewer3D({
  skinSrc,
  capeSrc,
  width = 320,
  height = 400,
  modelType = "classic",
  autoRotate = true,
}: SkinViewer3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [libReady, setLibReady] = useState(true);

  // 检查 skinview3d 库是否可用
  useEffect(() => {
    try {
      if (!skinview3d || !skinview3d.SkinViewer) {
        setLibReady(false);
      }
    } catch {
      setLibReady(false);
    }
  }, []);

  // 初始化 viewer
  useEffect(() => {
    if (!libReady) return;
    if (!canvasRef.current) return;

    let cancelled = false;
    try {
      // skinview3d v3.4.x 的构造 API
      const viewer = new skinview3d.SkinViewer({
        canvas: canvasRef.current,
        width,
        height,
        skin: skinSrc || null,
        cape: capeSrc || null,
        // model: modelType === "slim" ? "slim" : "default",
        controls: {
          enabled: true,
          zoom: true,
          rotate: true,
          pan: false,
        },
      } as any);

      // 设置模型类型（slim=细胳膊，default=粗胳膊）
      // skinview3d 会自动从皮肤中检测，但我们可以显式设置
      try {
        (viewer as any).model = modelType === "slim" ? "slim" : "default";
      } catch {}

      // 初始视角
      try {
        viewer.camera.rotation.x = -0.15;
        viewer.camera.position.y = 0;
        viewer.camera.position.z = 55;
      } catch {}

      // 动画
      if (autoRotate) {
        try {
          viewer.animation = new skinview3d.WalkingAnimation();
          (viewer.animation as any).speed = 0.6;
        } catch {
          try {
            viewer.animation = new skinview3d.IdleAnimation();
          } catch {}
        }
      }

      viewerRef.current = viewer;
      setTimeout(() => {
        if (!cancelled) setLoaded(true);
      }, 100);
    } catch (e) {
      console.error("SkinViewer 初始化失败:", e);
      setError(true);
    }

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        try {
          viewerRef.current.dispose();
        } catch {}
        viewerRef.current = null;
      }
    };
  }, [libReady]);

  // 更新皮肤
  useEffect(() => {
    if (!viewerRef.current || !skinSrc) return;
    try {
      viewerRef.current.skin = skinSrc;
      setError(false);
    } catch (e) {
      console.error("加载皮肤失败:", e);
      setError(true);
    }
  }, [skinSrc]);

  // 更新披风
  useEffect(() => {
    if (!viewerRef.current) return;
    try {
      viewerRef.current.cape = capeSrc || null;
    } catch (e) {
      console.error("加载披风失败:", e);
    }
  }, [capeSrc]);

  // 更新模型类型
  useEffect(() => {
    if (!viewerRef.current) return;
    try {
      viewerRef.current.model = modelType === "slim" ? "slim" : "default";
    } catch {}
  }, [modelType]);

  // 更新尺寸
  useEffect(() => {
    if (!viewerRef.current) return;
    try {
      viewerRef.current.width = width;
      viewerRef.current.height = height;
    } catch {}
  }, [width, height]);

  if (!libReady) {
    return (
      <div
        ref={containerRef}
        className="flex items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 text-sm text-muted-foreground select-none"
        style={{ width, height }}
      >
        <div className="text-center p-4">
          <p>skinview3d 库未安装</p>
          <p className="mt-2 text-xs opacity-70">请运行: npm install skinview3d three</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center select-none"
      style={{ width, height }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded-lg bg-gradient-to-b from-transparent to-black/5"
      />
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          加载皮肤中...
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          皮肤加载失败
        </div>
      )}
    </div>
  );
}