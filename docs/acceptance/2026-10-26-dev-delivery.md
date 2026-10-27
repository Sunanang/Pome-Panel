# 全量开发交付验收 · 2026-10-26

范围：用户明确要求提交当前仓库全部改动，并将此前独立预览的官网纳入 `website/`，目标为长期开发分支 `dev`。

## 验证

- `npm test`：退出码 0。980 项 Node 测试中 979 通过、1 项跳过、0 失败；49 次 Electron 验收运行及脚本所列 JavaScript 语法检查全部通过。Electron 包含隔离重启、多语言、删除确认、剪贴板、风效、卡片交互、通知与模拟 NAS 同步场景。
- `npm run i18n:check`：桌面/NAS 生成资源通过。
- `cd website && npm ci --no-audit --no-fund`：锁文件可安装。
- 官网语言目录与桌面完全一致，十语言每种 112 个键、参数占位符与 30 张产品截图完整。
- 官网 7 项语言单测、4 项运行结构测试和生产构建全部通过。
- 在仓库内官网构建的本地预览重新执行十语言与 1024/390/320px 布局矩阵、17 项核心交互回归，控制台错误 0。截图与结果见 [官网验收](2026-10-26-website/README.md)。
- `GITHUB_OUTPUT=/private/tmp/pome-delivery-release-policy.out node scripts/release-policy.js`：通过。桌面 package/lock 与两个 NAS manifest 均为 0.11.0；更新记录写入未发布区，README 保留 Releases 与无安装包时的源码说明。检查时 GitHub Releases 列表为空。
- 本地分支保护钩子已安装，检查目标为 `dev`；未绕过钩子。
- 测试期间源文件哈希未变化，仅更新官网验收截图、检查结果和说明；提交前执行暂存区差异与空白检查。

## 证据与边界

删除确认使用隔离用户目录、示例录音及密钥 IPC；未读取真实密钥或删除用户内容。风效最终状态见 [淡风微调](2026-10-26-wind-gentle/README.md)，早期风效目录保留迭代记录。桌面测试日志中的故意注入保存/读取失败用于验证错误处理，不代表断言失败。

本轮为 macOS 上的源码与隔离 Electron 验收，Windows 仅有模拟平台路径；未进行 Windows 或移动设备真机、Safari、安装包构建与安装验收。未部署 NAS 或官网，未创建发布标签或 Release。
