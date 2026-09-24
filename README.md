# Pome Panel

Mac 与 Windows 的贴顶本地工作台（Electron）。默认折叠贴顶，点击展开；数据留在本机。

> 当前稳定版本：**0.9.12** · **macOS 13.0+ Apple Silicon** / **Windows 10/11 x64**

- 下载：[GitHub Releases（latest）](https://github.com/Sunanang/Pome-Panel/releases/latest)
- 开发：`npm install && npm start`
- 检查：`npm test`
- 飞牛打包前：`scripts/pack-fpk.sh` 把 `packages/sync-protocol` 同步到 `fnos/app/packages/sync-protocol`（fnpack 会把它放进 `TRIM_APPDEST`）。fpk 在 NAS 上打。
- 产品行为准绳：以本 README 与 `AGENTS.md` 为准；冲突时以本 README 为准。

更完整的功能说明、权限与更新日志见 [CHANGELOG.md](CHANGELOG.md) 与官网。
