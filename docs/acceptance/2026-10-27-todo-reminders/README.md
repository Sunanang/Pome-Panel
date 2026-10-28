# 待办到期提醒与点击定位

日期：2026-10-27。`dev` 工作区，隔离临时用户目录。

## 规则

- 到期前 1 小时顶部气泡 1 次
- 若截止后仍未提醒过，启动/调度时补弹 1 次「已过期」
- 同一截止时间最多 1 次；已收到到期前提醒时不再补弹过期提醒，改 DDL 后重置
- 点击气泡：展开面板 → 待办 Tab → 高亮对应条目

## 截图

![到期前提醒](todo-due-soon.png)

![过期补弹](todo-overdue.png)

![点击后定位待办](todo-open-focus.png)

## 检查

- `tests/main-services.test.js`、`tests/notification-domain.test.js` 通过
- `tests/notification.electron.js` 通过（含点击打开与 overdue 气泡）
