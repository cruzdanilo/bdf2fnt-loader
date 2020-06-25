const { join, parse: parsePath, relative } = require('path').posix;
const { getOptions, interpolateName } = require('loader-utils');
const { create } = require('xmlbuilder2');
const { parse } = require('bdfjs');
const optipng = require('imagemin-optipng')();
const sharp = require('sharp');

const build = async (content, context) => {
  const {
    webp = true,
    prettyPrint = false,
    name = '[name].[contenthash:8].[ext]',
    outputPath = relative(context.rootContext, context.context),
    charset: charsetString = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.0123456789',
  } = getOptions(context) || {};
  const { resourcePath } = context;

  const font = parse(content);
  const { width: charWidth, height: charHeight, y: charY } = font.meta.boundingBox;
  const width = 2 ** Math.ceil(Math.log2(Math.sqrt(charset.size * charWidth * charHeight)));
  const columns = Math.floor(width / charWidth);
  const height = Math.ceil(charset.size / columns) * charHeight;
  const channels = 4;
  const charset = new Set([...charsetString]);
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

  const sharpline = sharp(pixels, { raw: { width, height, channels } });
  const textures = await Promise.all([
    ['.png', optipng, sharpline.clone().png({ compressionLevel: 0 })],
    ...webp ? [
      ['.webp', (b) => b, sharpline.clone().webp({ quality: 100, lossless: true, reductionEffort: 6 })],
    ] : [],
  ].map(async ([ext, optimizer, pipeline]) => {
    const data = await optimizer(await pipeline.toBuffer());
    const filepath = join(outputPath, interpolateName({
      ...context, resourcePath: resourcePath.replace(/\.bdf(?!.*\.bdf)/, ext),
    }, name, { content: data }));
    context.emitFile(filepath, data);
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
      .ele('page', { id: 0, file: relative(outputPath, textures[0]) })
      .up()
      .up()
      .ele('chars', { count: chars.length }),
  ).end({ prettyPrint });
  const fontData = join(outputPath, interpolateName({
    ...context, resourcePath: resourcePath.replace(/\.bdf(?!.*\.bdf)/, '.xml'),
  }, name, { content: fontDataBuffer }));
  context.emitFile(fontData, fontDataBuffer);
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
