const loaderUtils = require('loader-utils');
const BDF = require('bdfjs');
const Jimp = require('jimp');
const imagemin = require('imagemin');
const optipng = require('imagemin-optipng');


module.exports = function main(source) {
  const options = loaderUtils.getOptions(this) || {};
  const font = BDF.parse(source);
  const charset = [...' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.0123456789'];
  const box = font.meta.boundingBox;
  const side = 2 ** Math.ceil(Math.log2(Math.sqrt(charset.length * box.width * box.height)));
  const image = new Jimp(side, side);
  const chars = [];
  let x = 0;
  let y = 0;
  const baseline = box.height + box.y;
  charset.forEach((char) => {
    const glyph = font.glyphs[char.charCodeAt()];
    const rowStart = baseline - glyph.boundingBox.y - glyph.boundingBox.height;
    glyph.bitmap.forEach((row, i) => row.forEach((value, j) => {
      if (value) image.setPixelColor(0xffffffff, x + glyph.boundingBox.x + j, y + rowStart + i);
    }));
    chars.push({ id: glyph.code, x, y });
    x += box.width;
    if (x + box.width > image.bitmap.width) {
      x = 0;
      y += box.height;
    }
  });
  this.async();
  image.getBuffer(Jimp.MIME_PNG, (err, buf) => {
    if (err) {
      this.callback(err);
    } else {
      imagemin.buffer(buf, { use: [optipng()] }).then((png) => {
        const pngName = loaderUtils.interpolateName(this, '[hash].png', { content: png });
        this.emitFile(pngName, png);
        let fnt = `common lineHeight=${box.height} base=${box.height} scaleW=${image.bitmap.width} scaleH=${image.bitmap.height} pages=1\n`;
        fnt += `page id=0 file="${pngName}"\n`;
        fnt += `chars count=${chars.length}\n`;
        chars.forEach((char) => {
          fnt += `char id=${char.id} x=${char.x} y=${char.y} width=${box.width} height=${box.height} xoffset=0 yoffset=0 xadvance=${box.width} page=0 \n`;
        });
        const fntName = loaderUtils.interpolateName(this, '[hash].fnt', { content: fnt });
        this.emitFile(fntName, fnt);
        this.callback(null, `module.exports = __webpack_public_path__ + ${JSON.stringify(fntName)};`);
      }).catch(e => this.callback(e));
    }
  });
};
