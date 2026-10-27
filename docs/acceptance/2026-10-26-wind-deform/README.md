# 风片形变与局部消散验收

2026-10-26，macOS Electron，隔离用户目录与固定天气响应。截图中的城市、天气和日期为测试数据。

本目录保留第一轮实现。用户复看后指出风片过于明显、仍像云烟；现行实现与后续证据见 `../2026-10-26-wind-subtle/`。

- `wind.gif` / `wind-strong.gif`：中卡片普通风与大风，检查不规则薄片、局部弯折、拉薄与不同位置的消散。
- `wind-large.gif`：大卡片下的同一效果，检查放大后衔接与柔边。
- `rain-wind.gif`：风雨叠加，检查降低透明度的风片与原有倾斜雨线。
- 对应 `*-frame.png` 为各序列第 21 帧原始 Electron 截图。每段动图来自 48 张连续截图，按逻辑像素尺寸缩小，便于预览。

验证：

- `node --test tests/sun-weather.test.js tests/sun.test.js`：28 项通过。包含固定风片位置时的内部弯折、局部厚度变化、不同位置独立消散、相邻片段连续衔接、纹理复用与 30/60/120 Hz 轨迹一致性。
- `tests/sun-weather.electron.js`：四尺寸、十语言、全部天气特效族、开关、reduced motion、切页、收起与窗口隐藏回归通过。设置 `POME_WEATHER_MOTION=1` 可输出连续截图。
- 大风 16 片、DPR 2，热身 20 次后采样 120 次绘制：CPU 提交耗时中位数约 0.3 ms、P95 约 0.5 ms；不代表 GPU 完成耗时或跨设备性能保证。
- JavaScript 语法与 `git diff --check` 通过。

未做：Windows 真机验收、安装包构建与安装测试。
