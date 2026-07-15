"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ModpackBuilder } from "@/components/modpack/ModpackBuilder";
import {
  ModrinthFileEntry,
  CurseforgeFileEntry,
  loadInstance,
} from "@/components/modpack/modpack-api";
import { Loader2 } from "lucide-react";

function ModpackBuilderInner() {
  const router = useRouter();
  const search = useSearchParams();

  const type = search.get("type");
  const name = search.get("name") || undefined;
  const editExisting = search.get("edit") === "1";

  const [existingFiles, setExistingFiles] = useState<
    (ModrinthFileEntry | CurseforgeFileEntry)[] | null
  >(editExisting && name ? null : []);
  const [existingGV, setExistingGV] = useState<string>("");
  const [existingLoader, setExistingLoader] = useState<string>("");
  const [existingOptifine, setExistingOptifine] = useState<boolean>(false);
  const [existingOptifineVersion, setExistingOptifineVersion] = useState<string>("");
  const [existingCrossLoader, setExistingCrossLoader] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (type !== "modrinth" && type !== "curseforge") {
      router.push("/tools");
      return;
    }
    if (editExisting && name) {
      loadInstance(name)
        .then((inst) => {
          if ((inst as any).format !== type) {
            setLoadError("整合包类型不匹配");
            setExistingFiles([]);
            return;
          }
          setExistingFiles(inst.files as any);
          // Modrinth 新格式用 versionId/dependencies.minecraft，旧格式用 game_version
          const gv =
            (inst as any).versionId ||
            (inst as any).dependencies?.minecraft ||
            (inst as any).game_version ||
            "";
          setExistingGV(gv);
          setExistingLoader((inst as any).loader || "");
          setExistingOptifine((inst as any).optifine || false);
          setExistingOptifineVersion((inst as any).optifine_version || "");
          setExistingCrossLoader((inst as any).cross_loader || false);
        })
        .catch((e) => {
          setLoadError(String(e));
          setExistingFiles([]);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!type || (type !== "modrinth" && type !== "curseforge")) {
    return null;
  }

  if (existingFiles === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" /> 正在加载整合包数据...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-red-500">
        加载失败：{loadError}
      </div>
    );
  }

  return (
    <ModpackBuilder
      format={type}
      initialName={name}
      gameVersion={existingGV || undefined}
      initialLoader={existingLoader || undefined}
      initialOptifine={existingOptifine}
      initialOptifineVersion={existingOptifineVersion || undefined}
      initialCrossLoader={existingCrossLoader}
      existingFiles={existingFiles}
    />
  );
}

export default function ModpackBuilderPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" /> 正在加载...
      </div>
    }>
      <ModpackBuilderInner />
    </Suspense>
  );
}