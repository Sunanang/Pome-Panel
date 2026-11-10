#!/usr/bin/env node
// 读某个 Release 的资产清单，生成官网用的 website/public/downloads.json。
// 官网下载弹窗只读这个文件：有它就按平台列出直下链接，没有就显示「还没发布」。
//
//   node scripts/gen-downloads-json.mjs v1.2.3
//
// 平台判定按文件名后缀（electron-builder 的 artifactName 是 Pome-Panel-<ver>-<arch>.<ext>）。
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const repo = 'Sunanang/Pome-Panel'
const tag = process.argv[2] || process.env.GITHUB_REF_NAME
if (!tag) {
  console.error('用法: node scripts/gen-downloads-json.mjs <tag>')
  process.exit(1)
}

const raw = execFileSync('gh', ['release', 'view', tag, '-R', repo, '--json', 'tagName,publishedAt,assets'], {
  encoding: 'utf8',
})
const release = JSON.parse(raw)

function platformOf(name) {
  if (/\.sha256$/i.test(name)) return null
  if (/\.dmg$/i.test(name)) return /arm64/i.test(name) ? 'mac-arm64' : 'mac-x64'
  if (/\.exe$/i.test(name)) return 'win-x64'
  if (/\.fpk$/i.test(name)) return 'fnos-fpk'
  return null
}

const sizeHuman = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB')

const assets = release.assets
  .map((a) => {
    const platform = platformOf(a.name)
    if (!platform) return null
    return {
      name: a.name,
      platform,
      size: a.size,
      sizeHuman: sizeHuman(a.size),
      url: `https://github.com/${repo}/releases/download/${release.tagName}/${a.name}`,
    }
  })
  .filter(Boolean)

const manifest = {
  tag: release.tagName,
  publishedAt: release.publishedAt.slice(0, 10),
  releasePage: `https://github.com/${repo}/releases/tag/${release.tagName}`,
  assets,
}

const out = 'website/public/downloads.json'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`${out}: ${manifest.tag} → ${assets.map((a) => `${a.platform}:${a.name}`).join(', ') || '（无匹配资产）'}`)
