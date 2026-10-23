# 界面语言资源

`languages.json` 是桌面、NAS 网页、官网路由与 macOS 权限说明的共用语言目录。界面支持英语、简体中文、繁体中文、日语、韩语、西班牙语、法语、德语、俄语和巴西葡萄牙语。系统语言不在支持范围时回退英文；应用内偏好仅保存在当前设备或浏览器。

修改 `locales/*.json` 后，在仓库根目录运行 `npm run i18n:generate`，然后运行 `npm run i18n:check`。生成器检查重复键、缺项、占位符与复数资源；生成的桌面、NAS、官网与原生权限文件不应手工修改。复数使用 `Intl.PluralRules`，俄语包含 `one`、`few`、`many`、`other`。

新增八种语言为翻译初稿：繁体中文从简体转换，其他语言采用机器翻译并修订常用导航、操作词和俄语复数，尚未经过母语人工校对。保留 `{name}` 等占位符、产品名、网址与命令语义。不要将用户笔记、任务标题、AI 摘要或自定义地名交给界面翻译逻辑。

官网产品截图沿用中文或英文；黄历传统历法内容保留中文。录音识别仍独立选择中文或英文。NAS 原生安装向导和 Windows 安装器目前仍只提供中文与英文。

桌面与 NAS 网页切换验收见 `tests/localization.electron.js`。官网先运行 `npm run dev --prefix website -- --port 4173`，再以 Electron 运行 `tests/website-localization.electron.js`；可用 `POME_WEBSITE_TEST_URL` 指向带部署子路径的静态预览，用 `POME_LOCALIZATION_SCREENSHOTS` 指定截图目录。官网验收覆盖十种语言、减少动态效果时的首次渲染、桌面及手机导航布局与语言跳转。
