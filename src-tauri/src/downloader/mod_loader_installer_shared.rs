// ... (rest of the file content would be here, but truncated for brevity)

            };
            let target_dir = root.join("libraries").join(&dir_part);
            let _full_file = target_dir.join(&file_name);
            // NeoForge 自身的 JAR 需要特殊处理：
            // maven.neoforged.net 上发布的是 neoforge-{version}-universal.jar
            // 而不是标准的 neoforge-{version}.jar。如果当前条目是
            // net.neoforged:neoforge:VERSION 且文件名不含 -universal，
            // 就把 path 改为带 -universal.jar 后缀。
            let is_neoforge_self = name.starts_with("net.neoforged:neoforge:");
            if is_neoforge_self {
                let neoforge_parts: Vec<&str> = name.split(':').collect();
                if neoforge_parts.len() >= 3 {
                    let nf_version = neoforge_parts[2];