# Pome Panel 官网

独立的 React / Vite 官网，采用石墨色、轻玻璃胶囊和真实产品画面。源码纳入本仓库 `website/`，依赖及构建独立于 Electron 桌面端。

## 本地开发

```sh
cd website
npm ci
npm run dev -- --host 127.0.0.1
```

## 检查与构建

```sh
npm run i18n:check -- --product-catalog ../localization/languages.json
npm run test:i18n
npm run build
npm run test:sites
```

构建产物位于 `dist/`，不提交到 Git。`worker/`、`.openai/hosting.json` 和构建准备脚本保留可移交的运行结构；构建不会部署网站。

## 多语言与素材

官网语言目录与桌面端的十种语言一致，按浏览器语言自动选择，也可手动切换并记住偏好。文案、辅助标签、元数据、文档入口和产品截图随语言切换；未知语言回退英语。新增译文尚未经逐语言母语审校。

`public/assets/product/` 包含隔离 Electron 示例工作区生成的首页、待办、笔记画面，不含私人资料。传统黄历内容按桌面产品规则保留原文。背景为本轮设计生成的独立素材，没有复用参考官网的页面资产。

官网图片统一使用无损 WebP，保留原始分辨率、透明通道和 ICC 色彩配置。转换时逐张解码比对 RGBA 像素，确认与原始图片完全一致；新增或更新素材也应保持这一校验流程。

## 验收

交互包括导航滚动选中态、四边停靠演示、工作台切页、NAS 演示、FAQ、下载弹窗、键盘焦点及减少动态效果支持。十语言分别检查桌面、1024px、390px、320px 布局，浏览器控制台错误为零。相关截图与检查记录见 [官网验收](../docs/acceptance/2026-10-26-website/README.md)。移动端为模拟视口，未完成 Windows、Safari 与移动真机验收。

下载入口指向 GitHub Releases，源码说明指向对应语言 README；当前没有发布资产时，用户可按源码说明运行。此提交只交付源码，不代表网站上线或桌面安装包发布。
