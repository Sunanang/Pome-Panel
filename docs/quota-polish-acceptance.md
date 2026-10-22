# 额度名称、长名与底部时间修复 · 2026-10-22

## 最终行为

- 遵循最新要求保留英文池名：Cursor 的第一池从 Auto 改为 Cursor，第二池为 Other；紧凑窗口行统一 Cur / Oth，中英文一致。接口字段、池键、缓存键仍为 auto / other，主窗口及瓶颈逻辑不变。
- 来源名称优先完整显示；可读字号放不下时采用 Claude / Antigrav 短名，悬停和无障碍标签始终保留 Claude Code / Antigravity。以实际字体和字形宽度检查替代单纯 Canvas 估算，避免可变字体光学尺寸造成的省略；放宽卡片后恢复完整名字。
- 所有非 mini 底部时间保持一行。空间不足时从末尾省略，标题保留完整时间；small 中文说明去掉空格（如「周日11:19重置」）并将字距收紧 0.1px，中大号及英文空格保留，避免多行内容被单行高度从上方裁切后只留下“置”。环、条、页头布局及原刷新动画保留。
- 删除 model 中未被消费的 constraintLine/constraintTime/reset/vertical/expanded 字段和相关计算、无调用的非 mini 角标分支、两个失去运行引用的旧文案 key，以及无使用的 CSS 令牌/选择器。仍使用的动画模块保持原样。

## 验收

新增中英文池名/缩写与稳定 API 键测试、每个状态中实际字形不溢出及完整无障碍名称检查、窄格短名和放宽恢复测试、窄格时间一行可见检查。四尺寸矩阵覆盖设计/实机比例，另外测试 166px 宽的小卡边界；`after/small-narrow-brand-aliases.png` 核对短名与无空格单行时间，`after/small-wide-brand-names.png` 验证宽度恢复后显示完整名字，`labels/naming-zh-CN-cursor-details.png` 验证完整 Cursor / Other 池名。详情面板仍展示完整池名与真实重置时间。

完整 `npm test`：856 pass / 0 fail / 1 Windows-only skip，31 次 Electron 运行、语言与语法检查通过。最新 small 中文去空格调整后，额度矩阵、原交互与刷新动画三组 Electron 再次通过；43 项领域/动画/catalog 相关单测通过。原动画模块 SHA-256 保持 1ce31412ccd39aa11ad2142dceec17b68f00bc51e9d980714f34e01067a06aae。证据在 `dist.noindex/quota-polish/`：`after/` 为最终状态截图，`labels/` 为中英文详情与来源名称回归，`animation/` 为唤出/手动刷新录像，`full-test.log` 为最终完整日志；最新三组回归日志为 `final-quota-tests.log`。

## 文件与提交边界

清理独立提交：`renderer/styles.css` 中已被替代的 114 行布局、14 张未引用 PNG、`renderer/assets/README.md`、`docs/quota-cleanup-acceptance.md`。

额度修复另行提交：`aiProviderCatalog.js`、`renderer/ai-usage-domain.js`、`renderer/ai-usage.js`、`renderer/ai-usage-final.css`，`tests/ai-usage.test.js`、`tests/ai-usage.electron.js`、`tests/ai-usage-final.electron.js`，两份语言源文件中删除的旧 key 及两个生成资源，以及 README 中英文、`docs/quota-vocabulary.md`、`design-qa.md` 和本记录。部分暂存仅包含本轮的额度段落和 key 删除，保留工作区原有文案改动。

全程在 dev，不推送、不改 main。未做 Windows 真机、真实账号联网与安装包验证，使用隔离配置和接口夹具。
