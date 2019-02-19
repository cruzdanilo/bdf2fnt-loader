const path = require('path');
const loaderUtils = require('loader-utils');
const BDF = require('bdfjs');
const imagemin = require('imagemin');
const optipng = require('imagemin-optipng');
const sharp = require('sharp');

const done = new Set();

module.exports = async function loader(content) {
  this.async();
  const options = loaderUtils.getOptions(this) || {};
  const font = BDF.parse(content);
  const charset = new Set([...(options.charset || ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.0123456789')]);
  const { width: charWidth, height: charHeight, y: charY } = font.meta.boundingBox;
  const width = 2 ** Math.ceil(Math.log2(Math.sqrt(charset.size * charWidth * charHeight)));
  const columns = Math.floor(width / charWidth);
  const height = Math.ceil(charset.size / columns) * charHeight;
  const channels = 4;
  const chars = [];
  const pixels = Buffer.alloc(width * height * channels);
  [...charset].forEach((char, i) => {
    const glyph = font.glyphs[char.charCodeAt()];
    const x = (i % columns) * charWidth;
    const y = Math.floor(i / columns) * charHeight;
    chars.push({ id: glyph.code, x, y });
    const { boundingBox: box } = glyph;
    const firstColumn = x + box.x;
    const firstRow = y + charHeight + charY - box.height - box.y;
    glyph.bitmap.forEach((row, r) => row.forEach((value, c) => {
      if (!value) return;
      const offset = ((firstRow + r) * width + firstColumn + c) * channels;
      pixels.fill(0xff, offset, offset + channels);
    }));
  });
  const png = await imagemin.buffer(
    await sharp(pixels, { raw: { width, height, channels } }).png().toBuffer(),
    { use: [optipng()] },
  );
  const pngName = loaderUtils.interpolateName(this, options.name || '[name].[hash:8].png', { content: png });
  const outputPath = options.outputPath || '';
  let fnt = `common lineHeight=${charHeight} base=${charHeight + charY} scaleW=${width} scaleH=${height} pages=1\n`;
  fnt += `page id=0 file="${pngName}"\n`;
  fnt += `chars count=${chars.length}\n`;
  chars.forEach((char) => {
    fnt += `char id=${char.id} x=${char.x} y=${char.y} width=${charWidth} height=${charHeight} xoffset=0 yoffset=0 xadvance=${charWidth} page=0 \n`;
  });
  const fntName = path.posix.join(outputPath, loaderUtils.interpolateName(this, '[name].[hash:8].fnt', { content: fnt }));
  if (!done.has(pngName)) {
    done.add(pngName);
    this.emitFile(path.posix.join(outputPath, pngName), png);
    this.emitFile(fntName, fnt);
  }
  this.callback(null, `export default __webpack_public_path__ + ${JSON.stringify(fntName)};`);
};

module.exports.raw = true;
