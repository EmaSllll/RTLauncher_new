<<<<<<< HEAD
"use client";

import React from "react";
import { Image as ImageIcon } from "lucide-react";
import { createResourcePage } from "@/components/resource-page-factory";

export default createResourcePage({
  title: "资源包管理",
  leftIcon: <ImageIcon className="size-5 text-sky-500" />,
  leftIconBg: "bg-sky-500/10",
  leftIconColor: "text-sky-500",
  instanceSubdir: "resourcepacks",
  cacheKind: "resourcepack",
  extensions: ["zip", "jar"],
  simplifyName: (name) => name.replace(/\.(zip|jar)$/i, ""),
=======
"use client";

import React from "react";
import { Image as ImageIcon } from "lucide-react";
import { createResourcePage } from "@/components/resource-page-factory";

export default createResourcePage({
  title: "资源包管理",
  leftIcon: <ImageIcon className="size-5 text-sky-500" />,
  leftIconBg: "bg-sky-500/10",
  leftIconColor: "text-sky-500",
  instanceSubdir: "resourcepacks",
  cacheKind: "resourcepack",
  extensions: ["zip", "jar"],
  simplifyName: (name) => name.replace(/\.(zip|jar)$/i, ""),
>>>>>>> 7e94b3d5fae96299a238ed4f26231cdffc1ac040
});