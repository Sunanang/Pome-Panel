# AI 额度 final 布局与动画验收（2026-10-21）

## 设计依据与实现

- [final 文件夹](https://drive.google.com/drive/folders/1qVfRukQmWUAZWPnn2xiv84WkmT23diTz)、[总览](https://drive.google.com/file/d/1Fo8qYllnPckfS0vYs5zpv9YRkvBrZnul/view)、[开发标注](https://drive.google.com/file/d/19PMfK9-qEOW3kr_VLunr26gRmTdwViMT/view)。34 张来源图保存在 `dist.noindex/quota-final/references/`。
- 保留 `renderer/ai-usage-animation.js` 原有 720ms ease-out / rAF / store API；布局修改集中在 `ai-usage.js` 的挂接和独立 `ai-usage-final.css`。没有删除或替换动画模块。沿用缓存先显、后台刷新、手动刷新、30 秒防抖、首次从 0、中途续接、失败/同值不重播、减少动态效果直接切换及 60ms 行错峰。
- 主值与环长使用最短统计窗口；瓶颈用于颜色、紧急排序与过期判断。优先级为失效、用完、告急、偏低、过期、正常；新鲜度独立保留，因此过期的低额度仍保持其紧急级别，同时显示灰色年龄和 45% 透明度。
- 非 mini 每格：名字与图标 → 按行留位的角标 → 居中环 → 窗口条/文字 → 底部说明。mini/small 紧急排序，中/大号设置顺序。small 3/4 家 2×2，5/6 家 2×3；中/大号 3/4 家单排，5/6 家 3×2。空格不放接入或摘要占位。
- 环径目标为 mini 30；small 40/26；medium 56/46/30；large 118/96/58 逻辑像素。同卡统一，角标高度与环间距按开发标注。标题保留品牌图标，单行缩字/省略；窗口标题左对齐、数值等宽右对齐、共同 grid 列，轨道不随数值位数或动画改变。
- 失效显示红色虚线环及中心叹号，底部仅保留失效/设置，旧值可在详情查看。mini 失效摘要直接打开对应设置。用完为灰环、淡红轨、淡数字与一条完整划线；划线和灰色延后至原动画结束。
- 过期沿用原阈值，头部灰色时钟与真实数据年龄，不使用橙色过期提示。缺失 resetAt 不显示虚构时间；日期型数据不推测时分。恢复时间的星期与时刻之间保留空格。

## 实机尺寸与有意差异

开发标注对应外框为 mini 189×126、small 189×264、medium 389×264、large 782×480。实机首页格为 196×118、196×248、404×248、404×510，两组均已验证；没有改首页框尺寸、全局顶栏或其他模块。

- 实机高度不足时按整卡统一缩环；短 small 的 5/6 家格压缩上下留白以保留 26px 环。
- 实机 large 宽度为 404px，四列时采用较紧的窗口文字/数值列，保证 Other、Week 和 100% 能同时容纳。开发标注宽度下保留原字号。
- 超过本次设计范围的 6 家时，中/大号保留组件内滚动以免环被压到不可读；small 显示六家及其余来源入口，mini 沿用 3 环 +N。
- Grok Bot 保留现有正确头像，设计源图中的旧 Grok 字形不复用。图标与失效叹号按实际边界居中；时钟取自 Lucide 官方素材。
- 设计示意时间/百分比没有写入产品逻辑。验收使用隔离接口夹具；排序失效优先遵循用户文字要求。

## 回归证据

- `tests/ai-usage.test.js` / `tests/ai-usage-animation.test.js`：35 项通过，覆盖 5h 100%/周 0%、摘要优先级、全部/多家用完、用完+告急、无重置时间、失效、过期、相同/失败/中途续接/减少动态效果。
- `tests/ai-usage-final.electron.js`：参考与实机外框各 32 组状态（四尺寸 × 3–6 家及正常、偏低、告急、用完、多家用完、全部用完、失效、过期），另有 16 组英文实机截图；检查环径/等格/角标不压环、同行底部对齐、无占位、短窗口名完整、mini 居中及设置跳转。
- 进度条在 0%、8%、100% 以及中间动画帧的轨道长度完全不变，同格左右端一致。
- 既有 `ai-usage` 与 `quota-refresh` Electron 回归保留，覆盖八来源、金额/积分、未知数据、详情、来源移除与缩放、手动刷新、真实展开、缓存/防抖及动画。
- 完整工作区 `npm test`：850 pass / 0 fail / 1 platform skip；最终待提交副本独立完整 `npm test`：847 pass / 0 fail / 1 platform skip。两轮均有 31 次 Electron 检查及语言/语法检查，exit 0。数量差异来自仍留在工作区的其它修改。截图对照结论见根目录 `design-qa.md` 最新报告。

## 截图与录屏

- 实现：`dist.noindex/quota-final/after/{size}-{count}ai-{state}[-real].png`；英文附 `-en-real`。
- 同画面对照：`dist.noindex/quota-final/comparisons/compare-{size}-{count}ai-{state}.png`；左 final 源图、右同尺寸实现。
- 四尺寸实机合图：`dist.noindex/quota-final/four-sizes-real.png`。
- 改前：`dist.noindex/quota-final/before/panel-refresh.webm`；改后：`dist.noindex/quota-final/animation-after/panel-refresh.webm`，同目录含录屏抽帧和 rAF 时间采样。

仅在 macOS Electron 与隔离临时配置中验收。未测试 Windows 真机、真实账号的在线额度刷新或 MINI 安装；没有打包或发布。测试夹具不读写用户实际凭据或工作区。
