"use client";

import ModDetailContent from "./ModDetailContent";
import { Suspense, useEffect, useState } from "react";

function ModDetailInner() {
  const [modId, setModId] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const mod = params.get("mod") || "";
      if (mod) setModId(mod);
    }
  }, []);

  if (!modId) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>请先选择一个 Mod</p>
      </div>
    );
  }
  return <ModDetailContent modId={modId} />;
}

export default function ModDetailPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-muted-foreground"><p>加载中...</p></div>}>
      <ModDetailInner />
    </Suspense>
  );
}