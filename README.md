<div align="center">
  <img src="build/pome-panel-icon.png" width="88" alt="Pome Panel" />
  <h1>Pome Panel</h1>
  <p><strong>随手展开的桌面工作台。</strong></p>
  <p>待办、笔记、链接、录音与 AI 提醒，放在屏幕边缘，随时取用。</p>
  <p>
    <a href="https://github.com/Sunanang/Pome-Panel/releases">获取安装包</a> ·
    <a href="#开始使用">快速开始</a> ·
    <a href="docs/user-guide.md">使用指南</a> ·
    <a href="https://github.com/Sunanang/Pome-Panel/issues">反馈问题</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/macOS-13%2B%20Apple%20Silicon-111318?logo=apple" alt="macOS 13+ Apple Silicon" />
    <img src="https://img.shields.io/badge/Windows-10%2F11%20x64-0078D4" alt="Windows 10/11 x64" />
    <img src="https://img.shields.io/badge/License-MIT-35c58b" alt="MIT" />
  </p>
  <p>
    <strong>简体中文</strong> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <a href="README.en.md">English</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <a href="README.ru.md">Русский</a> ·
    <a href="README.pt-BR.md">Português (Brasil)</a>
  </p>
</div>

![Pome Panel 工作台预览](docs/screenshots/workspace-overview.png)

<p align="center"><sub>点击胶囊展开，收起后拖到屏幕四边；首页组件可以自由调整。</sub></p>

## 一个面板，处理日常小事

| 功能 | 能做什么 |
| --- | --- |
| **首页工作台** | 自定义组件与布局，集中查看专注计时、速记、黄历、日出日落与当前天气 |
| **待办与笔记** | 1–8 个待办分类、到期提醒，配合 Markdown 速记与笔记库 |
| **链接与录音** | 分类收藏网址，录制音频，可选实时转写与智能命名 |
| **AI 助手** | 查看多家 AI 剩余额度，接收已接入来源的任务完成提醒 |
| **剪贴板与密钥** | 按需开启剪贴板历史，用系统安全存储加密账号与密钥 |
| **NAS 多端同步** | 可选配对飞牛 NAS，在多台设备之间同步工作区内容 |

常用指令、待办、笔记、链接、录制和密钥在删除前统一弹出确认，显示内容预览与数量；录音、链接分组和待办分类会说明一并删除的内容。取消或按 Esc 保留原内容。

首页随笔记始终作为可恢复的编辑草稿。点击「保存」后，内容收进笔记库并从首页清空；整个随笔记组件保留背景、标题、按钮和正文，先收窄成弯曲漏斗，再吸入顶栏「笔记」；原位恢复空白组件。动画期间可继续写下一条，减少动态效果时改为轻量反馈。笔记库点击正文即可编辑，点击「保存」或按 Ctrl/Cmd+S 回到预览，保持当前阅读位置；后台自动保存不退出编辑。链接点击和拖选正文保持原用途，保存失败保留内容并在错误栏提供重试。

工作台采用轻量分类与内容索引：待办显示未完成数量；笔记和录制采用左侧列表、右侧详情的分栏，密钥页左侧新增、右侧搜索与管理。录音播放器支持播放、进度、音量和速度控制。

待办在截止前一小时提醒；错过窗口且尚未展示的任务会补提醒。一次积压至少 3 条过期任务时合并成一条摘要，点击进入待办并高亮对应条目。提醒实际展示后才保存状态，关闭提醒、排队或退出不会消耗未展示项；重新开启或启动后恢复。同一任务与截止时间的已提醒标记保存在工作区 `todo-reminders.json` 并参与待办同步，旧同步值不会回退标记；修改截止时间后重新计算。两台设备同时离线时仍可能各自提醒，联网后合并状态。Windows 原生能力关闭时，点击气泡仍按平台规则仅关闭提醒，可从待办页查看。

macOS 的「当前窗口」按系统辅助功能暴露的标准窗口枚举与聚焦，保留真实同名窗口，不按系统图形表的序号切换。点击已关闭或无法聚焦的窗口会提示刷新，不自动改开另一个窗口；最小化窗口可恢复。窗口名为主、应用名为辅，窄组件使用可滚动单列，全部条目均可滚动访问。长按拖出可单独隐藏窗口，点击「恢复」找回；旧的隐藏偏好继续保留。此功能使用辅助功能权限，不再为读取窗口标题申请屏幕录制权限。

macOS 安装版使用独立标识 `com.pomepanel.app`，可与旧 TO-DO Panel 并存。首次更新到此标识后，在「系统设置 → 隐私与安全性 → 辅助功能」为实际安装路径下的 Pome Panel 单独授权；旧应用的权限不会自动转移。资料目录仍为 `Pome Panel`。源码改动发布到 `dev` 后，需从该分支重新构建并替换安装版，仅拉取代码不会更新已经运行的应用。

## 开始使用

当前源码开发版本为 **0.11.0**。仓库尚无正式 Release 安装包，可按下方开发命令运行源码；正式安装包发布后将在 Releases 页面提供。

1. 在 [Releases](https://github.com/Sunanang/Pome-Panel/releases) 查看安装包：Mac 选择 `arm64.dmg`，Windows 选择 `windows-x64-setup.exe`。
2. 打开应用，点击屏幕边缘的胶囊展开；收起后可以拖动，调整停靠位置。
3. 在「设置」里选择需要的功能。AI 接入、录音转写和 NAS 同步均按需配置。

首页在窄窗口中可滚动查看全部已启用组件；从右键菜单调整组件大小或进入「编辑布局」换位，首页不常驻额外工具条。设置按常用任务提供定位入口，「资料与备份」无需 NAS 即可使用；温度单位与界面动态效果可独立选择。

原生窗口隐藏时会暂停天气与背景动效、停止镜子摄像头、暂停音频播放并收起密钥明文。重新显示后，镜子仍需主动点击开启；进行中的录音不会因隐藏面板而中断。

安装包以 Releases 实际发布为准；尚无安装包时可从源码运行。开发中的功能与修复见[更新日志](CHANGELOG.md)。

> 数据默认保存在本机 `Pome Panel` 文件夹，可自行更换；NAS 同步是可选功能。Windows 的部分原生能力默认关闭，详见[使用指南](docs/user-guide.md#windows-上的几件事)。

## 从源码运行

```bash
git clone --branch dev https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
npm install
npm run setup:hooks
npm start
```

使用 Node.js 18+。测试、NAS 伴侣与构建说明见[开发文档](docs/development.md)。

## 更多说明

[使用指南](docs/user-guide.md) · [开发文档](docs/development.md) · [更新日志](CHANGELOG.md) · [NAS 伴侣](fnos/)

界面支持简体中文、繁體中文、English、日本語、한국어、Español、Français、Deutsch、Русский、Português (Brasil)。新增翻译仍在校对，截图与黄历传统内容保留原语言。

---

基于 [TO-DO-Panel](https://github.com/xiaopu-ai/TO-DO-Panel) 二次开发，感谢原作者的开源贡献。

[MIT License](LICENSE) · [Sunanang](https://github.com/Sunanang)

## 官网源码

官网位于 [`website/`](website/README.md)，独立安装依赖与构建，支持与桌面端一致的十种语言。运行和验收方法见该目录说明；源码纳入本仓库不代表网站已部署。
