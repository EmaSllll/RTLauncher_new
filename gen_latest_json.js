const fs = require('fs');
const path = require('path');

const sigPath = path.join(__dirname, 'src-tauri', 'target', 'release', 'bundle', 'nsis', 'RTLauncher_0.1.0_x64-setup.exe.sig');
const sigContent = fs.readFileSync(sigPath, 'utf8').trim();

// 读取 exe 文件大小
const exePath = path.join(__dirname, 'src-tauri', 'target', 'release', 'bundle', 'nsis', 'RTLauncher_0.1.0_x64-setup.exe');
const exeSize = fs.statSync(exePath).size;
const exeSizeMB = (exeSize / 1024 / 1024).toFixed(2);

const latestJson = {
  version: "0.1.0",
  notes: `RTLauncher v0.1.0 发布版本

✨ 功能特性：
- 我的世界整合包管理与安装
- 游戏版本自动下载与切换
- Mod 管理与依赖解析
- 系统内存清理工具
- 自动更新支持

📦 安装包大小：约 ${exeSizeMB} MB

📝 说明：
- NSIS 安装器，支持 Windows 10/11 x64
- 已使用 Ed25519 签名，可验证更新完整性`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: sigContent,
      url: "https://gitcode.com/bubulaladdi/RTLauncher/releases/download/v0.1.0/RTLauncher_0.1.0_x64-setup.exe"
    }
  }
};

const outputPath = path.join(__dirname, 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(latestJson, null, 2) + '\n', 'utf8');
console.log('✅ latest.json 已生成: ' + outputPath);
console.log('📦 安装包大小: ' + exeSizeMB + ' MB');
console.log('🔐 签名长度: ' + sigContent.length + ' 字符');

// 同时把 sig 内容复制到根目录方便上传
fs.copyFileSync(sigPath, path.join(__dirname, 'RTLauncher_0.1.0_x64-setup.exe.sig'));
console.log('✅ .sig 文件已复制到根目录');

// 同时把 exe 复制到根目录方便上传
fs.copyFileSync(exePath, path.join(__dirname, 'RTLauncher_0.1.0_x64-setup.exe'));
console.log('✅ .exe 文件已复制到根目录');