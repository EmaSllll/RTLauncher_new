"use client";

import React from "react";
import { Box } from "lucide-react";
import { createResourcePage } from "@/components/resource-page-factory";

export default createResourcePage({
  title: "投影原理图管理",
  leftIcon: <Box className="size-5 text-rose-500" />,
  leftIconBg: "bg-rose-500/10",
  leftIconColor: "text-rose-500",
  instanceSubdir: "schematics",
  cacheKind: "world",
  extensions: ["schem", "schematic", "litematic", "nbt"],
  directoryNavigation: true,
  simplifyName: (name) => name.replace(/\.(schem|schematic|litematic|nbt)$/i, ""),
});
