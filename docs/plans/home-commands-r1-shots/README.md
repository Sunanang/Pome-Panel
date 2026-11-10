# 常用指令 r1 验收证据

日期：2026-11-04。基线：`8b9d477`；仅在 `dev` 修改列表行、备注编辑与悬停提示。设计参考：[home-commands-r1](https://drive.google.com/drive/folders/1j9floC6_oCcLt9mTxVD58r5Z1itSP3ig)。以最新提示词的「6 字仅提示，不拦截」覆盖参考稿的旧限制。

截图来自 macOS 上的真实 Electron 44，使用隔离用户目录、模拟额度数据及剪贴板写入，未改真实 AI 配置、账户或工作区。四档固定大小夹具用于前后内部布局对比，不定义新的生产卡片尺寸；生产继续使用现有 Bento 规则。真实首页三档布局另由 `home-layout-regression.electron.js` 验证。

## 截图对照

| 内容 | 改动前 | 改动后 |
| --- | --- | --- |
| mini | [基线](baseline-mini.png) | [单行指令，无胶囊/操作按钮](review-mini.png) |
| small | [基线](baseline-small.png) | [窄指令与备注胶囊](review-small.png) |
| medium | [基线](baseline-medium.png) | [单行列表](review-medium.png) |
| large | [基线](baseline-large.png) | [单行列表](review-large.png) |

`baseline.json` / `review.json` 对比模块外壳、标题和输入框的相对位置、尺寸、样式与内部 DOM，四档完全一致。行高从基线实际约 50.5px 降为 30px，保留 5px 列表间距。基线 large 的画布底部受测试窗口裁切，改后夹具已校正祖先包含块偏移，完整展示卡片。

- [空备注悬停「＋」](hover-add.png)：18×18；未悬停时不占位置。
- [无备注浮层](tip-none.png)：只有指令全文。
- [有备注浮层](tip-note.png)：截断指令和备注显示全文。
- [旧长备注](tip-long.png)：胶囊截断，浮层保留完整备注。
- [mini 备注浮层](tip-mini.png)：指令未截断、有备注时仍出现。
- [边缘翻转](tip-flipped.png)：模拟底部/右侧边缘，向上显示并限制在面板内；夹具部分卡片在视口外，用于边界验证。
- [超过 6 字的原位编辑](edit-long.png)：76×20，警示计数，仍可保存。

## 回归结果

- Node：1108 项，1106 通过、2 跳过、0 失败。
- 原完整清单的 57 份 Electron 测试全部完成（含重启共 70 次），136 项 JavaScript 语法检查通过。初次运行在旧 `title` 断言处停下，更新该断言后从 `home-card-hover` 接续原清单；此前已通过项复用，未宣称单次 `npm test` 从头绿到底。清单与方法见 [validation.json](validation.json)。
- 最终再次单独运行 `command-comments.electron.js` 通过，截图/几何数据已同步；完整长备注也保留在无障碍标签中。
- 翻译资源、版本一致性、`git diff --check` 通过。开发版本继续为 0.11.0，变更进入未发布记录。
- 三处旧测试同步对齐：原生筛选点击消费后再等待动画；当前窗口按实际拉伸宽度和足够样本验溢出滚动；卡片悬停不再要求系统 `title`。不涉及这些模块的产品逻辑改动。

## 已覆盖交互

`tests/command-comments.electron.js` 验证真实鼠标悬停、截断条件、约 450ms 延迟与 140ms 动画配置、开启卡片悬停动效后仍能提示、移开立即隐藏，以及编辑/布局调整/拖拽/滚动/切页时关闭提示。覆盖 Enter/失焦保存、Esc 取消、中文输入法 Enter 不误保存、Unicode 字数计数、清空移除、超过 6 字仍保存、旧长备注完整保留、复制仅正文、指令编辑/新增/删除确认/批量清空。

旧两行 `.command-content` 包装及样式已删除；沿用 `text` / `comment` 字段及原备注 1000 字符安全上限，未增加 6 字硬限制。同步格式与复制载荷保持原样。

本机验证命令（不安装、不打包）：

```sh
command_profile=$(mktemp -d /tmp/pome-command-check-XXXXXX)
env -u ELECTRON_RUN_AS_NODE TODO_TEST_USER_DATA="$command_profile" ./node_modules/.bin/electron tests/command-comments.electron.js
npm test
```

手工点验：`npm start` → 首页 → 编辑布局把常用指令依次设为四档；新增短/长指令和长备注，悬停空备注点「＋」，分别用 Enter、失焦、Esc 和清空测试。未截断的普通行不出现提示；mini 有备注时出现。把卡片放到首页底部/右侧后检查浮层，再检查复制、删除及保存/取消布局。

未做：Windows 真机、安装版替换与打包验收。Windows 原生环境目前不可用。
