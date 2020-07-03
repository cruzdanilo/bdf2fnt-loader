const { basename, parse: parsePath } = require('path').posix;
const { getOptions, interpolateName } = require('loader-utils');
const { create } = require('xmlbuilder2');
const { parse } = require('bdfjs');
const optipng = require('imagemin-optipng')();
const sharp = require('sharp');

const extRegex = /\.bdf(?!.*\.bdf)/;

const build = async (content, self) => {
  const {
    webp = true,
    immutable = true,
    prettyPrint = false,
    name = '[name].[contenthash:8].[ext]',
    context = self.rootContext,
    charset: charsetString = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.0123456789',
  } = getOptions(self) || {};
  const { resourcePath } = self;

  const charset = new Set([...charsetString]);
  const channels = 4;
  const chars = [];
  const font = parse(content);
  const { width: charWidth, height: charHeight, y: charY } = font.meta.boundingBox;
  const width = 2 ** Math.ceil(Math.log2(Math.sqrt(charset.size * charWidth * charHeight)));
  const columns = Math.floor(width / charWidth);
  const height = Math.ceil(charset.size / columns) * charHeight;
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

  const sharpline = sharp(pixels, { raw: { width, height, channels } });
  const textures = await Promise.all([
    ['.png', optipng, sharpline.clone().png({ compressionLevel: 0 })],
    ...webp ? [
      ['.webp', (b) => b, sharpline.clone().webp({ quality: 100, lossless: true, reductionEffort: 6 })],
    ] : [],
  ].map(async ([ext, optimizer, pipeline]) => {
    const data = await optimizer(await pipeline.toBuffer());
    const filepath = interpolateName({ ...self, resourcePath: resourcePath.replace(extRegex, ext) },
      name, { context, content: data });
    self.emitFile(filepath, data, false, { immutable });
    return filepath;
  }));

  const fontDataBuffer = chars.reduce(
    (xml, char) => {
      xml.ele('char', { id: char.id, x: char.x, y: 0, width: char.width, height, xoffset: 0, yoffset: 0, xadvance: char.width + 1, page: 0 }); // eslint-disable-line object-curly-newline
      return xml;
    },
    create().ele('font')
      .ele('info', { face: parsePath(resourcePath).name.split('.bdf')[0], size: height })
      .up()
      .ele('common', { lineHeight: height, base: height, scaleW: width, scaleH: height, pages: 1 }) // eslint-disable-line object-curly-newline
      .up()
      .ele('pages')
      .ele('page', { id: 0, file: basename(textures[0]) })
      .up()
      .up()
      .ele('chars', { count: chars.length }),
  ).end({ prettyPrint });
  const fontData = interpolateName({ ...self, resourcePath: resourcePath.replace(extRegex, '.xml') },
    name, { context, content: fontDataBuffer });
  self.emitFile(fontData, fontDataBuffer, false, { immutable });
  return { fontData, textures };
};

const done = new Map();

module.exports = async function loader(content) {
  this.async();
  const contenthash = interpolateName(this, '[contenthash]', { content });
  if (!done.has(contenthash)) done.set(contenthash, await build(content, this));
  const { fontData, textures } = done.get(contenthash);
  this.callback(null, `export default {
  fontData: __webpack_public_path__ + ${JSON.stringify(fontData)},
  textures: [${textures.map((t) => `__webpack_public_path__ + ${JSON.stringify(t)}`).join(', ')}],
};`);
};

module.exports.raw = true;
