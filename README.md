xBRZ JavaScript version
=======================

xBRZ: "Scale by rules" - high quality pixel art upscaling by Zenju

Notes
* Original code is GPL3 licensed, the same license may apply here
* Currently updated to xBRZ v1.9
* Some code semi-automatically converted to JavaScript by Codex (AI)
* Only tested with `xbrzColorFormat.argb` (expects in-memory byte order of `R, G, B, A` or `B, G, R, A`)

<img src="https://github.com/Jimbly/xbrz-js/blob/HEAD/test/test-in-6x-nearest.png"><img src="https://github.com/Jimbly/xbrz-js/blob/HEAD/test/test-out.png">

## API
```ts
enum xbrzColorFormat {
  argb,
};

type XbrzConfig = {
  equalColorTolerance: number;
  centerDirectionBias: number;
  steepDirectionThreshold: number;
  dominantDirectionThreshold: number;
  oobRead: 'auto' | 'duplicate' | 'transparent',
};
function xbrzConfig(opts?: Partial<XbrzConfig>): XbrzConfig;

function xbrzScale(
  scale: number,
  src: Uint32Array,
  dst: Uint32Array,
  width: number,
  height: number,
  colorFormat: xbrzColorFormat,
  config?: XbrzConfig,
): void;
```

## Example usage

```js
const { xbrzScale, xbrzColorFormat, xbrzConfig } = require('xbrz-js');

let config = xbrzConfig({
  // these are the defaults, xbrzConfig({}) or null would work as well
  equalColorTolerance: 30,
  centerDirectionBias: 4,
  steepDirectionThreshold: 2.4,
  dominantDirectionThreshold: 3.6,
  oobRead: 'auto',
});

let src = new Uint32Array([
  // White on black "x"
  0xFFFFFFFF, 0x000000FF, 0xFFFFFFFF,
  0x000000FF, 0xFFFFFFFF, 0x000000FF,
  0xFFFFFFFF, 0x000000FF, 0xFFFFFFFF,
]);

let scale = 6;
let dst = new Uint32Array(3*scale * 3*scale);
xbrzScale(scale, src, dst, 3, 3, xbrzColorFormat.argb, config);
```

See [test/test.js](test/test.js) for an example including reading and writing from a PNG file.

## Links

https://sourceforge.net/projects/xbrz/
