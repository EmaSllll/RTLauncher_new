use std::sync::{Arc, atomic::AtomicBool};
use std::time::Instant;

#[tokio::main]
async fn main() {
    let url = "https://cdn.modrinth.com/data/Ha28R6CL/versions/MrMwCJlh/fabric-language-kotlin-1.8.3%2Bkotlin.1.7.10.jar";

    println!("=== 测试 1: HEAD 请求看状态和重定向 ===");
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; RTLauncher/1.0)")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .unwrap();

    let start = Instant::now();
    let resp = client.head(url).send().await;
    match resp {
        Ok(r) => {
            println!("HEAD 状态: {} | 耗时: {:.1}s", r.status(), start.elapsed().as_secs_f64());
            println!("最终 URL: {}", r.url());
            println!("Headers:");
            for (k, v) in r.headers() {
                let vs = v.to_str().unwrap_or("<binary>");
                if k.as_str().contains("content") || k.as_str().contains("range") || k.as_str().contains("location") || k.as_str().contains("accept") {
                    println!("  {}: {}", k, vs);
                }
            }
        }
        Err(e) => println!("HEAD 失败: {}", e),
    }

    println!("\n=== 测试 2: GET + Range 请求 ===");
    let start = Instant::now();
    let resp = client.get(url).header(reqwest::header::RANGE, "bytes=0-2097151").timeout(std::time::Duration::from_secs(15)).send().await;
    match resp {
        Ok(r) => {
            println!("GET+Range 状态: {} | 耗时: {:.1}s", r.status(), start.elapsed().as_secs_f64());
            println!("最终 URL: {}", r.url());
            println!("Content-Length: {:?}", r.content_length());
            println!("Content-Range: {:?}", r.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()));
            let start_body = Instant::now();
            let body = r.bytes().await;
            match body {
                Ok(b) => println!("Body 大小: {} bytes | 读取耗时: {:.1}s", b.len(), start_body.elapsed().as_secs_f64()),
                Err(e) => println!("Body 读取失败: {}", e),
            }
        }
        Err(e) => println!("GET+Range 失败: {}", e),
    }

    println!("\n=== 测试 3: 裸 GET（不带 Range，模拟浏览器） ===");
    let start = Instant::now();
    let resp = client.get(url).timeout(std::time::Duration::from_secs(60)).send().await;
    match resp {
        Ok(r) => {
            println!("GET 状态: {} | 耗时: {:.1}s", r.status(), start.elapsed().as_secs_f64());
            println!("最终 URL: {}", r.url());
            let size = r.content_length().unwrap_or(0);
            println!("Content-Length: {} bytes", size);

            use futures::stream::StreamExt;
            let mut stream = r.bytes_stream();
            let mut received: u64 = 0;
            let mut last_report = Instant::now();
            while let Ok(Some(chunk_result)) = tokio::time::timeout(std::time::Duration::from_secs(30), stream.next()).await {
                match chunk_result {
                    Ok(data) => {
                        received += data.len() as u64;
                        if last_report.elapsed() > std::time::Duration::from_millis(500) {
                            let pct = if size > 0 { received as f64 / size as f64 * 100.0 } else { 0.0 };
                            println!("  进度: {:.1}% ({}/{})", pct, received, size);
                            last_report = Instant::now();
                        }
                    }
                    Err(e) => { println!("  流错误: {}", e); break; }
                }
            }
            println!("总下载: {} bytes | 总耗时: {:.1}s", received, start.elapsed().as_secs_f64());
            let out = std::path::PathBuf::from(".\\test_download_fabrickotlin.jar");
            let _ = std::fs::remove_file(&out);
        }
        Err(e) => println!("GET 失败: {}", e),
    }

    println!("\n=== 测试 4: resolve_redirect_url ===");
    let start = Instant::now();
    let resp = client.head(url).send().await;
    match resp {
        Ok(r) => {
            let final_url = r.url().to_string();
            println!("原URL: {}", url);
            println!("解析后: {}", final_url);
            println!("是否相同: {}", final_url == url);
            println!("耗时: {:.1}s", start.elapsed().as_secs_f64());
        }
        Err(e) => println!("失败: {}", e),
    }

    println!("\n=== 全部测试完成 ===");
}