#!/usr/bin/env node
'use strict';

// 从 build/pome-panel-icon.png 生成多尺寸 build/pome-panel-icon.ico（P2-4）。
//
// 产物已经提交进仓库，CI 不需要每次重跑本脚本；改了源 PNG 之后手动执行
// `npm run make-ico` 重新生成即可。刻意不引入任何依赖：源图是 8 位 RGBA、
// 非隔行的 PNG，用 zlib 就能解码，缩放和 ICO 封装都只是算术。
//
// 尺寸 ≤ 64 写成经典 BMP(DIB) 条目、256 写成 PNG 条目：NSIS 的安装器图标只认
// BMP 条目，而 256 用 BMP 会让文件白白大出 250KB。

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = 4;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// Paeth 等滤镜的逆运算，见 PNG 规范 9.2。
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('不是 PNG 文件');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG 缺少 IHDR');
  if (header.bitDepth !== 8 || header.interlace !== 0 || ![2, 6].includes(header.colorType)) {
    throw new Error(`只支持 8 位非隔行的 RGB/RGBA PNG（当前 bitDepth=${header.bitDepth} colorType=${header.colorType} interlace=${header.interlace}）`);
  }

  const sourceChannels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * sourceChannels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(header.width * header.height * CHANNELS, 0xff);
  const line = Buffer.alloc(stride);
  const previous = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    raw.copy(line, 0, rowStart + 1, rowStart + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= sourceChannels ? line[i - sourceChannels] : 0;
      const up = previous[i];
      const upLeft = i >= sourceChannels ? previous[i - sourceChannels] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`未知的 PNG 滤镜 ${filter}`);
      line[i] = value & 0xff;
    }
    for (let x = 0; x < header.width; x++) {
      const from = x * sourceChannels;
      const to = (y * header.width + x) * CHANNELS;
      pixels[to] = line[from];
      pixels[to + 1] = line[from + 1];
      pixels[to + 2] = line[from + 2];
      if (sourceChannels === 4) pixels[to + 3] = line[from + 3];
    }
    line.copy(previous);
  }
  return { width: header.width, height: header.height, pixels };
}

function encodePng(image) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = image.width * CHANNELS;
  const scanlines = Buffer.alloc(image.height * (stride + 1));
  for (let y = 0; y < image.height; y++) {
    scanlines[y * (stride + 1)] = 0;
    image.pixels.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// 面积平均（box filter）重采样。颜色先乘 alpha 再平均，否则完全透明像素里的
// 垃圾颜色会在缩小后渗成一圈白边。
function resize(image, size) {
  const pixels = Buffer.alloc(size * size * CHANNELS);
  const scaleX = image.width / size;
  const scaleY = image.height / size;
  for (let y = 0; y < size; y++) {
    const top = y * scaleY;
    const bottom = (y + 1) * scaleY;
    for (let x = 0; x < size; x++) {
      const left = x * scaleX;
      const right = (x + 1) * scaleX;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;
      for (let sy = Math.floor(top); sy < Math.min(image.height, Math.ceil(bottom)); sy++) {
        const coverY = Math.min(bottom, sy + 1) - Math.max(top, sy);
        if (coverY <= 0) continue;
        for (let sx = Math.floor(left); sx < Math.min(image.width, Math.ceil(right)); sx++) {
          const coverX = Math.min(right, sx + 1) - Math.max(left, sx);
          if (coverX <= 0) continue;
          const cover = coverX * coverY;
          const from = (sy * image.width + sx) * CHANNELS;
          const alpha = image.pixels[from + 3] / 255;
          r += image.pixels[from] * alpha * cover;
          g += image.pixels[from + 1] * alpha * cover;
          b += image.pixels[from + 2] * alpha * cover;
          a += image.pixels[from + 3] * cover;
          weight += cover;
        }
      }
      const to = (y * size + x) * CHANNELS;
      const alpha = weight > 0 ? a / weight : 0;
      const unpremultiply = alpha > 0 ? 255 / (alpha * weight) : 0;
      pixels[to] = Math.round(Math.min(255, r * unpremultiply));
      pixels[to + 1] = Math.round(Math.min(255, g * unpremultiply));
      pixels[to + 2] = Math.round(Math.min(255, b * unpremultiply));
      pixels[to + 3] = Math.round(alpha);
    }
  }
  return { width: size, height: size, pixels };
}

// ICO 里的 BMP 条目：BITMAPINFOHEADER 的高度写两倍（XOR 位图 + AND 掩码），
// 像素自下而上、按 BGRA 排列；掩码全 0，每行按 4 字节对齐。
function encodeBmpEntry(image) {
  const { width, height } = image;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bpp
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(width * height * CHANNELS, 20);

  const xor = Buffer.alloc(width * height * CHANNELS);
  for (let y = 0; y < height; y++) {
    const sourceRow = (height - 1 - y) * width * CHANNELS;
    for (let x = 0; x < width; x++) {
      const from = sourceRow + x * CHANNELS;
      const to = (y * width + x) * CHANNELS;
      xor[to] = image.pixels[from + 2];
      xor[to + 1] = image.pixels[from + 1];
      xor[to + 2] = image.pixels[from];
      xor[to + 3] = image.pixels[from + 3];
    }
  }
  const maskStride = Math.ceil(width / 32) * 4;
  return Buffer.concat([header, xor, Buffer.alloc(maskStride * height, 0)]);
}

function buildIco(source, sizes) {
  const entries = sizes
    .slice()
    .sort((a, b) => a - b)
    .map((size) => {
      const image = size === source.width ? source : resize(source, size);
      return { size, data: size >= 256 ? encodePng(image) : encodeBmpEntry(image) };
    });

  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2); // 1 = icon
  directory.writeUInt16LE(entries.length, 4);
  let offset = directory.length;
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size; // 256 记作 0
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0; // 调色板颜色数
    directory[at + 3] = 0;
    directory.writeUInt16LE(1, at + 4); // planes
    directory.writeUInt16LE(32, at + 6); // bpp
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });
  return Buffer.concat([directory, ...entries.map((entry) => entry.data)]);
}

function main() {
  const root = path.join(__dirname, '..');
  const input = path.join(root, 'build', 'pome-panel-icon.png');
  const output = path.join(root, 'build', 'pome-panel-icon.ico');
  const source = decodePng(fs.readFileSync(input));
  if (source.width !== source.height) throw new Error('源图必须是正方形');
  if (source.width < Math.max(...ICON_SIZES)) throw new Error(`源图至少要 ${Math.max(...ICON_SIZES)}px`);
  const ico = buildIco(source, ICON_SIZES);
  fs.writeFileSync(output, ico);
  console.log(`已生成 ${path.relative(root, output)}：${ICON_SIZES.join(' / ')}，共 ${(ico.length / 1024).toFixed(1)} KB`);
}

if (require.main === module) main();

module.exports = { ICON_SIZES, decodePng, encodePng, resize, buildIco };
