const fs = require('fs');
const { PNG } = require('pngjs');
const { xbrzScale, xbrzColorFormat, xbrzConfig } = require('../');

const PNG_RGBA = 6;

let src = PNG.sync.read(fs.readFileSync(__dirname + '/test-in.png'));

let scale = 6;
let dst = new PNG({ width: src.width * scale, height: src.height * scale, colorType: PNG_RGBA });
let config = xbrzConfig({
  // mostly defaults, xbrzConfig({}) or null would work as well
  equalColorTolerance: 30,
  centerDirectionBias: 4,
  steepDirectionThreshold: 2.4,
  dominantDirectionThreshold: 3.6,
  oobRead: 'duplicate', // default of "auto" will be incorrect if this is a (primarily) opaque image
});

xbrzScale(scale, new Uint32Array(src.data.buffer), new Uint32Array(dst.data.buffer), src.width, src.height, xbrzColorFormat.argb, config);
fs.writeFileSync(__dirname + '/test-out.png', PNG.sync.write(dst));

src = {
  width: 3,
  height: 3,
  data: new Uint32Array([
    // White on black "x"
    0xFFFFFFFF, 0x000000FF, 0xFFFFFFFF,
    0x000000FF, 0xFFFFFFFF, 0x000000FF,
    0xFFFFFFFF, 0x000000FF, 0xFFFFFFFF,
  ])
};

scale = 3;
dst = new PNG({ width: src.width * scale, height: src.height * scale, colorType: PNG_RGBA });
xbrzScale(scale, src.data, new Uint32Array(dst.data.buffer), 3, 3, xbrzColorFormat.argb, config);
fs.writeFileSync(__dirname + '/x-out.png', PNG.sync.write(dst));

console.log('Test complete.');
