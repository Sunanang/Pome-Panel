# 面板尺寸三档验收（2026-11-03）

实现分支：`dev`。使用隔离临时 userData、测试额度与天气数据；不替换已安装应用，不打包、不发布。原有会议模式等未提交改动保留。

## 设计与实现边界

已打开 Drive 的 r3.1 三张首页窗框、r3.2 面板尺寸设置、首页组件设置及 NOTES。窗框参考 r3.1；设置和容量交互参考 r3.2。模块尺寸、字段和背景以当前源码为准，没有照图重画内部 UI。

- [设计目录](https://drive.google.com/drive/folders/1P9hjyprLVKDIozgJmZTl4LNdL3jaLxf3)
- [标准首页 r3.1](https://drive.google.com/file/d/1Q1Z8oqOOQVfA13PWjXQPRcLXS76D0_I7/view)
- [适中首页 r3.1](https://drive.google.com/file/d/1c7SXX9Dl59g6gglBmUyckKDx3ZLNr0lY/view)
- [紧凑首页 r3.1](https://drive.google.com/file/d/1MI415MNe5CoBICRxfCJyu0Xz8kpOIqxX/view)
- [面板尺寸设置 r3.2](https://drive.google.com/file/d/1R9KGYRXrkSsWnsH2mXIkbFAWMIenYGAy/view)
- [首页组件设置 r3.2](https://drive.google.com/file/d/1SZypibApUyYN_myLLkbsllTfGSWG_5dC/view)
- [NOTES r3.2](https://drive.google.com/file/d/110QNslvcrFOqYNXYG1pJJFwjMJNm1EQ_/view)

## 本机验收

macOS / Electron 44.0.0 源码运行。截图为 Retina 2 倍像素；逻辑外框以实际 BrowserWindow 断言为准。

| 档位 | 原生逻辑窗口 | 容量 | 新默认实际占用 | 可见模块 |
| --- | --- | --- | --- | --- |
| 标准 | 1240×638 | 48 | 44 | 日出日落、番茄钟、AI 额度、黄历、AI 完成提醒、常用指令、镜子、随笔记 |
| 适中 | 1040×580 | 36 | 36 | 前七个 |
| 紧凑 | 880×520 | 24 | 18 | 前四个 |

紧凑还有 6 单位，但下一张 AI 完成提醒为 medium（8），因此严格截断，不跳过它插入后面的 mini。音乐和快速录音仅在新建/重置布局默认隐藏；旧布局顺序、所选尺寸和隐藏偏好保留。

设置存 `userData/app-settings.json` 的 `panelSize`，首页偏好继续保存在本机原有 LocalStorage 键。切档只产生渲染投影，不写卡片尺寸、顺序、隐藏列表或标准档位置。较小档只调整外层列数和排布；保持现有 `mini=2/small=4/medium=8/large=16`，large 仍为 4×4 足迹；无摘要字段、整体缩字、自由改窗大小或首页外滚。

`tests/panel-size.electron.js` 使用生产主进程与预加载桥，逐档点击实际设置控件，断言 BrowserWindow 尺寸、设置行不与语言重叠、容量 warning/禁用、首页边界、卡片背景/字号/尺寸标签、其它 tab 无横向外溢，验证 renderer reload 和真正进程重启恢复。用受控鼠标输入依次吸附四边，再在各边逐档切换并检查实际 BrowserWindow 边界；紧凑地点弹层边界、大卡片旧布局恢复及拖动预览也有覆盖。

`tests/panel-size.test.js` 覆盖两平台、四边、负坐标显示器、1/1.25/1.5/2 缩放因子的逻辑几何，并穷举 372 种容量内足迹组合，检查窄档网格能容纳且足迹不变。这些 Windows 检查是共享代码回归，不代表 Windows 原生验收。

## 截图

- [标准首页](standard-home.png)、[适中首页](medium-home.png)、[紧凑首页](compact-home.png)：保留模块内部视觉，按容量截断，无常驻无空间条。
- [紧凑面板尺寸设置](compact-settings.png)：本机设置独立成行，与语言、面板位置、默认展开页无叠字。
- [适中容量提示](medium-capacity.png)、[紧凑容量提示](compact-capacity.png)：只在显示功能首页区出现 warning，容量外开关禁用。
- [紧凑地点弹层](compact-popover.png)：位于窗口内且可操作。
- [紧凑日期弹层](compact-date-popover.png)、[紧凑转写设置](compact-transcription-dialog.png)：边界及操作按钮在窗口内；切档会关闭日期编辑并清除预览上下文。

## 检查结果

- 完整 `npm test` 通过：Node 1087 通过、2 项平台跳过；Electron 集成与 JavaScript 语法检查完成。
- 后续平台默认声明对齐的相关 Node 回归 21 项通过；补充的日期/转写弹层与三档 Electron 路径另行复验通过。
- 首轮完整运行曾遇日出日落总超时，独立复验通过；CI 绘制模式还暴露了旧动画测试按固定毫秒采样的问题。改为等待实际动画完成，并补充日出日落测试的原生焦点与超时定位后，正常模式的完整 `npm test` 通过，没有据此改动产品内部 UI。

## 待验项

- Windows 10/11 真机或虚拟机的窗口/DPI/任务栏与弹层验收。用户已明确当前无可用 Windows 环境，保留此项，不记为通过。
- 不同物理显示器与系统缩放档位的实机覆盖；现有多缩放因子断言属于逻辑几何验证。
- 已安装正式版未替换；当前结果针对源码运行的 Electron。
