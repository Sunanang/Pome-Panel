const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.join(__dirname, '..');
const releasePolicyScript = path.join(projectRoot, 'scripts', 'release-policy.js');
const releaseWorkflowPath = path.join(projectRoot, '.github', 'workflows', 'release-dmg.yml');
const entitlementsPath = path.join(projectRoot, 'build', 'entitlements.mac.plist');
const readmePath = path.join(projectRoot, 'README.md');
const websiteDownloadPath = path.join(projectRoot, 'website', 'app', 'landingDownload.mjs');
const websiteContentPath = path.join(projectRoot, 'website', 'app', 'landingContent.ts');
const packageVersion = require(path.join(projectRoot, 'package.json')).version;
const packageConfig = require(path.join(projectRoot, 'package.json'));

function runReleasePolicy(t, environment) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-panel-release-policy-'));
  const outputPath = path.join(outputDir, 'github-output.txt');
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [releasePolicyScript], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      ...environment,
    },
  });

  return {
    ...result,
    output: fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '',
  };
}

test('manual workflow runs validate the package without publishing a release', (t) => {
  const result = runReleasePolicy(t, {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF_TYPE: 'branch',
    GITHUB_REF_NAME: 'main',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /^publish=false$/m);
  assert.match(result.output, new RegExp(`^version=${packageVersion.replaceAll('.', '\\.')}$`, 'm'));
});

test('a matching semantic version tag enables release publishing', (t) => {
  const result = runReleasePolicy(t, {
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: `v${packageVersion}`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /^publish=true$/m);
  assert.match(result.output, new RegExp(`^version=${packageVersion.replaceAll('.', '\\.')}$`, 'm'));
});

test('a pushed version tag that disagrees with package.json is rejected', (t) => {
  const result = runReleasePolicy(t, {
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: 'v9.9.9',
  });

  assert.notEqual(result.status, 0);
  assert.equal(
    result.stderr,
    `package.json version ${packageVersion} does not match tag v9.9.9\n`
  );
  assert.equal(result.output, '');
});

test('the release workflow lets manual runs verify artifacts while policy gates publishing', () => {
  const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');

  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(workflow, /id:\s*release[\s\S]*?run:\s*node scripts\/release-policy\.js/);
  assert.match(workflow, /name:\s*Build DMG[\s\S]*?run:\s*npm run build/);
  assert.match(workflow, /name:\s*Verify and checksum DMG/);
  assert.match(
    workflow,
    /name:\s*Publish GitHub Release\s*\n\s*if:\s*steps\.release\.outputs\.publish == 'true'/
  );
});

test('macOS packaging declares the Electron 44 minimum and least-privilege runtime entitlements', () => {
  const entitlements = fs.readFileSync(entitlementsPath, 'utf8');
  const readme = fs.readFileSync(readmePath, 'utf8');

  assert.equal(packageConfig.build.mac.minimumSystemVersion, '13.0');
  assert.match(readme, /macOS 13(?:\.0)?\+/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.cs\.allow-dyld-environment-variables/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.cs\.disable-executable-page-protection/);
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
});

// P3-1：卸载后残留的 Run 值会让系统反复尝试拉起已被删掉的 exe。
test('the NSIS uninstaller clears the auto-launch registry values, but not on upgrade', () => {
  const installerPath = path.join(projectRoot, 'build', 'installer.nsh');
  assert.ok(fs.existsSync(installerPath), 'electron-builder 从 buildResources 自动引入 build/installer.nsh');
  const installer = fs.readFileSync(installerPath, 'utf8');
  assert.match(installer, /!macro customUnInstall/);
  // 升级安装时旧版卸载器也会跑，没有 isUpdated 保护就会抹掉用户的自启设置。
  assert.match(installer, /\$\{ifNot\}\s+\$\{isUpdated\}/);
  for (const key of [
    'Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run',
    'Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Explorer\\\\StartupApproved\\\\Run',
  ]) {
    assert.match(installer, new RegExp(`DeleteRegValue HKCU "${key}" "${packageConfig.build.appId}"`));
  }
  // buildResources 目录下的文件由 electron-builder 自动识别，不该也不需要进 build.files。
  assert.ok(!packageConfig.build.files.includes('build/installer.nsh'));
});

test('Windows reads the effective login-item state instead of just the Run key', () => {
  const mainJs = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
  // openAtLogin 在用户于任务管理器里禁用后仍为 true，界面会显示"开"但实际不启动。
  assert.match(mainJs, /executableWillLaunchAtLogin/);
  // openAsHidden 已被 Electron 移除，不该再出现在 setLoginItemSettings 里。
  assert.doesNotMatch(mainJs, /openAsHidden\s*:/);
  // 首启判定必须先于任何写 app-settings.json 的代码，否则升级用户会被当成全新安装。
  const whenReady = mainJs.slice(mainJs.indexOf('app.whenReady().then('));
  assert.ok(
    whenReady.indexOf('ensureFirstRunAutoLaunch()') < whenReady.indexOf('migrateWindowsLayoutSettings()'),
    'ensureFirstRunAutoLaunch 必须排在写设置文件之前'
  );
});

// P3-4：Windows 用户装完之后要能自己配通知钩子、跨过 SmartScreen、知道哪些事做不到。
test('the README documents the Windows hooks, SmartScreen and known limits', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.match(readme, /%USERPROFILE%\\\.codex\\config\.toml/);
  assert.match(readme, /%USERPROFILE%\\\.claude\\settings\.json/);
  assert.match(readme, /%LOCALAPPDATA%\\Programs\\Pome Panel/);
  assert.match(readme, /SmartScreen/);
  assert.match(readme, /仍要运行/);
  for (const limit of ['不签名', '虚拟桌面', '汽水音乐', 'arm64', '9px']) {
    assert.match(readme, new RegExp(limit), `已知限制里缺少「${limit}」`);
  }
  // P1 之后 Windows 也能拖到四边，旧的"仍贴在工作区顶部居中"说明必须撤掉。
  assert.doesNotMatch(readme, /Windows 仍贴在工作区顶部居中/);
  assert.doesNotMatch(readme, /Windows 的折叠态是工作区顶部居中的 200×38/);
});

test('website download entry points stay on the latest release', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  const websiteDownload = fs.readFileSync(websiteDownloadPath, 'utf8');
  const websiteContent = fs.readFileSync(websiteContentPath, 'utf8');

  // The product README is an introduction. Download, changelog, and release notes stay on the website.
  assert.doesNotMatch(readme, /^##\s*(下载|安装|更新日志|发布|Changelog|Release)\b/im);
  assert.match(websiteContent, /DOWNLOAD_URL\s*=\s*"https:\/\/github\.com\/Sunanang\/Pome-Panel\/releases\/latest"/);
  assert.match(websiteDownload, /LATEST_RELEASE_API_URL\s*=\s*"https:\/\/api\.github\.com\/repos\/Sunanang\/Pome-Panel\/releases\/latest"/);
});
