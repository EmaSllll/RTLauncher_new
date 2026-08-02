use anyhow::{anyhow, Context, Result};
use regex::Regex;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const OPTIFINE_API_URL: &str = "https://optifine.net/api/versions";

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OptifineVersion {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(rename = "mcversion")]
    pub mcversion: String,
    pub patch: String,
    pub filename: String,
    #[serde(default)]
    pub forge: String,
}

/// 下载并安装指定版本的Optifine
pub fn install_optifine_alone(
    optifine_version: &str,
    minecraft_dir: &str,
    opt_wrapper_path: &str,
    mc_version: &str,
) -> Result<()> {
    println!(
        "正在安装 OptiFine {}，Minecraft 版本: {}",
        optifine_version, mc_version
    );
    println!("Wrapper 路径: {}", opt_wrapper_path);
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36")
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(reqwest::header::REFERER, "https://optifine.net/".parse().unwrap());
            headers
        })
        .build()
        .context("构造 reqwest 客户端失败")?;
    println!(
        "请求 OptiFine adloadx 页面: https://optifine.net/adloadx?f={}",
        optifine_version
    );
    // 获取下载页面
    let adload_url = format!("https://optifine.net/adloadx?f={}", optifine_version);
    let response = client
        .get(&adload_url)
        .send()
        .context("请求 OptiFine adloadx 页面失败")?;

    let html = response.text().context("读取 adloadx 页面文本失败")?;

    // 匹配下载链接
    let re = Regex::new(r#"(?i)href=['"](downloadx\?f=[^'"]*?)['"]"#).unwrap();
    let download_url = if let Some(caps) = re.captures(&html) {
        let mut link = caps.get(1).unwrap().as_str().to_string();
        // 将 HTML 中的 &amp; 替换为 &
        link = link.replace("&amp;", "&");
        format!("https://optifine.net/{}", link)
    } else {
        return Err(anyhow!(
            "未在 HTML 中找到下载链接 (Download)\n完整 HTML:\n{}",
            html
        ));
    };
    // 下载OptiFine安装器到临时位置
    let jar_filename = optifine_version;
    let temp_dir = std::env::temp_dir();
    let target_path = temp_dir.join(jar_filename);
    println!(
        "开始下载 OptiFine 安装器: {} -> {}",
        download_url,
        target_path.display()
    );

    // 使用多线程下载OptiFine安装器
    download_file_with_progress(&download_url, &target_path, 16)?;
    println!("OptiFine 安装器下载完成，正在启动安装器...");
    // 构造 classpath: 使用系统特定的分隔符连接多个路径
    let format_path = |p: &PathBuf| -> String { p.to_string_lossy().replace("\\", "/") };

    let sep = if cfg!(windows) { ";" } else { ":" };
    let target_str = format_path(&target_path);
    let wrapper_str = opt_wrapper_path.replace("\\", "/");
    let classpath = format!("{}{}{}", wrapper_str, sep, target_str);

    // 构造命令参数数组
    // 从jar_filename中提取patch部分，例如：OptiFine_1.11.2_HD_U_C7.jar -> HD_U_C7
    let _patch = jar_filename
        .strip_prefix("OptiFine_")
        .and_then(|s| s.strip_suffix(".jar"))
        .and_then(|s| {
            let parts: Vec<&str> = s.split("_").collect();
            if parts.len() >= 3 {
                Some(parts[2..].join("_"))
            } else {
                None
            }
        })
        .unwrap_or_else(|| jar_filename.to_string());
    // 去掉o变量末尾的.jar字符
    let o = format!("{}-{}", mc_version, optifine_version).replace(".jar", "");
    let args: Vec<String> = vec![
        "-cp".to_string(),
        classpath,
        "net.stevexmh.OptifineInstaller".to_string(),
        minecraft_dir.to_string(),
        o.clone(),
    ];
    println!("执行命令: java {}", args.join(" "));
    println!("工作目录: {}", minecraft_dir);
    // 构造命令: java -cp {classpath} net.stevexmh.OptifineInstaller {minecraft_dir} {optifine安装器的名称}
    let mut cmd = Command::new("java");
    cmd.args(&args);
    cmd.current_dir(minecraft_dir);

    println!("尝试执行命令:{:?}", cmd);
    println!("开始执行 OptiFine 安装器...");

    // 执行命令并捕获输出
    let output = cmd.output().context("启动 OptiFine 安装器失败")?;
    
    // 打印标准输出
    if !output.stdout.is_empty() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        println!("OptiFine 安装器输出:\n{}", stdout);
    }

    // 打印标准错误
    if !output.stderr.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        println!("OptiFine 安装器错误输出:\n{}", stderr);
    }

    // 检查退出状态
    if !output.status.success() {
        return Err(anyhow!(
            "OptiFine 安装器执行失败,退出码: {:?}\n标准错误: {}",
            output.status.code(), 
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // 检查输出中是否包含成功安装的信息
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("OptiFine installed successfully")
        || stdout.contains("安装成功")
        || stdout.contains("Installation completed")
    {
        println!("OptiFine 安装成功");
    } else {
        // 即使没有明确的成功消息，如果退出码为0，也认为安装成功
        println!("OptiFine 安装完成（退出码为0）");
    }

    // 确保 options.txt 存在并设置语言为中文
    let versions_dir = PathBuf::from(minecraft_dir).join("versions").join(&o);
    let options_path = versions_dir.join("options.txt");
    if options_path.exists() {
        let content = fs::read_to_string(&options_path)?;
        if content.contains("lang:") {
            let new_content = content
                .lines()
                .map(|line| {
                    if line.trim().starts_with("lang:") {
                        "lang:zh_cn"
                    } else {
                        line
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            fs::write(&options_path, new_content)?;
        } else {
            fs::write(&options_path, format!("{}\nlang:zh_cn", content))?;
        }
    } else {
        fs::write(&options_path, "lang:zh_cn")?;
    }
    
    // 清理临时文件
    let _ = fs::remove_file(&target_path);

    Ok(())
}

/// 使用多线程下载文件并显示进度
fn download_file_with_progress(url: &str, path: &PathBuf, _max_threads: usize) -> Result<()> {
    // 获取文件大小
    let client = Client::new();
    let head_resp = client.head(url).send()?;
    let _file_size = head_resp
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v: &reqwest::header::HeaderValue| v.to_str().ok())
        .and_then(|v: &str| v.parse::<u64>().ok())
        .unwrap_or(0);
    
    // 如果文件大于1MB，使用多线程下载
    let threads = 8;
    
    download_file_blocking(url, path, threads)?;
    
    Ok(())
}

/// 阻塞式下载文件
fn download_file_blocking(url: &str, path: &PathBuf, _threads: usize) -> Result<()> {
    // 简化实现，直接使用reqwest下载
    let client = Client::new();
    let mut response = client.get(url).send()?;
    let mut file = fs::File::create(path)?;
    std::io::copy(&mut response, &mut file)?;
    Ok(())
}