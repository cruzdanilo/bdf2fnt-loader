const path = require('path');
const loaderUtils = require('loader-utils');
const BDF = require('bdfjs');
const imagemin = require('imagemin');
const optipng = require('imagemin-optipng');
const sharp = require('sharp');
const xmlbuilder = require('xmlbuilder');

const done = new Set();

module.exports = async function loader(content) {
  this.async();
  const options = loaderUtils.getOptions(this) || {};
  const outputPath = options.outputPath || path.posix.relative(this.rootContext, this.context);
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
  const texture = await imagemin.buffer(
    await sharp(pixels, { raw: { width, height, channels } }).png().toBuffer(),
    { use: [optipng()] },
  );
  const name = options.name || '[name].[contenthash:8].[ext]';
  const textureName = loaderUtils.interpolateName(this, {
    ...this, resourcePath: this.resourcePath.replace(/\.bdf(?!.*\.bdf)/, '.png'),
  }, { content: texture });
  const fontData = chars.reduce(
    (xml, char) => {
      xml.ele('char', { id: char.id, x: char.x, y: char.y, width: charWidth, height: charHeight, xoffset: 0, yoffset: 0, xadvance: charWidth, page: 0 }); // eslint-disable-line object-curly-newline
      return xml;
    },
    xmlbuilder.create('font')
      .ele('info', { face: font.meta.name, size: font.meta.size.points })
      .up()
      .ele('common', { lineHeight: charHeight, base: charHeight + charY, scaleW: width, scaleH: height, pages: 1 }) // eslint-disable-line object-curly-newline
      .up()
      .ele('pages')
      .ele('page', { id: 0, file: textureName })
      .up()
      .up()
      .ele('chars', { count: chars.length }),
  ).end({ pretty: true });
  const texturePath = path.posix.join(outputPath, textureName);
  const fontDataPath = path.posix.join(outputPath, loaderUtils.interpolateName({
    ...this, resourcePath: this.resourcePath.replace(/\.bdf(?!.*\.bdf)/, '.xml'),
  }, name, { content: fontData }));
  if (!done.has(textureName)) {
    done.add(textureName);
    this.emitFile(texturePath, texture);
    this.emitFile(fontDataPath, fontData);
  }
  this.callback(null, `export default { texture: __webpack_public_path__ + ${JSON.stringify(texturePath)}, fontData: __webpack_public_path__ + ${JSON.stringify(fontDataPath)} };`);
};

module.exports.raw = true;
