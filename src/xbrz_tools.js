// Ported from C++ code licensed under
// GNU General Public License: https://www.gnu.org/licenses/gpl-3.0

function getByte(val, n) { return val >>> (8 * n) & 0xff; }

function getAlpha(pix) { return getByte(pix, 3); }
function getRed  (pix) { return getByte(pix, 2); }
function getGreen(pix) { return getByte(pix, 1); }
function getBlue (pix) { return getByte(pix, 0); }

function makePixel(a, r, g, b) {
    if (b === undefined) {
        const rr = a >>> 0;
        const gg = r >>> 0;
        const bb = g >>> 0;
        return ((rr << 16) | (gg << 8) | bb) >>> 0;
    }
    return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

function rgb555to888(pix) {
    return (((pix & 0x7C00) << 9) | ((pix & 0x03E0) << 6) | ((pix & 0x001F) << 3)) >>> 0;
}

function rgb565to888(pix) {
    return (((pix & 0xF800) << 8) | ((pix & 0x07E0) << 5) | ((pix & 0x001F) << 3)) >>> 0;
}

function rgb888to555(pix) {
    return (((pix & 0xF80000) >>> 9) | ((pix & 0x00F800) >>> 6) | ((pix & 0x0000F8) >>> 3)) & 0xffff;
}

function rgb888to565(pix) {
    return (((pix & 0xF80000) >>> 8) | ((pix & 0x00FC00) >>> 5) | ((pix & 0x0000F8) >>> 3)) & 0xffff;
}

function unscaledCopy(pixRead, pixWrite, width, height) {
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            pixWrite(pixRead(x, y));
        }
    }
}

// Nearest-neighbor scaling by scanning target image.
function nearestNeighborScale(pixRead, srcWidth, srcHeight, pixWrite, trgWidth, trgHeight, yFirst, yLast) {
    yFirst = Math.max(yFirst, 0);
    yLast = Math.min(yLast, trgHeight);
    if (yFirst >= yLast || srcHeight <= 0 || srcWidth <= 0) return;

    for (let y = yFirst; y < yLast; ++y) {
        const ySrc = Math.floor(srcHeight * y / trgHeight);
        for (let x = 0; x < trgWidth; ++x) {
            const xSrc = Math.floor(srcWidth * x / trgWidth);
            pixWrite(pixRead(xSrc, ySrc));
        }
    }
}

function byteRound(v) {
    return Math.min(v + 0.5, 255) | 0;
}

function uintDivRound(num, den) {
    if (den === 0) throw new Error('Division by zero');
    return Math.floor((num + Math.floor(den / 2)) / den);
}

// Caveat: treats alpha channel like regular color! => caller needs to pre/de-multiply alpha.
function bilinearScale(pixRead, srcWidth, srcHeight, pixWrite, trgWidth, trgHeight, yFirst, yLast) {
    yFirst = Math.max(yFirst, 0);
    yLast = Math.min(yLast, trgHeight);
    if (yFirst >= yLast || srcHeight <= 0 || srcWidth <= 0) return;

    const scaleX = trgWidth / srcWidth;
    const scaleY = trgHeight / srcHeight;

    const buf = new Array(trgWidth);
    for (let x = 0; x < trgWidth; ++x) {
        const x1 = Math.floor(srcWidth * x / trgWidth);
        let x2 = x1 + 1;
        if (x2 === srcWidth) --x2;

        const xx1 = x / scaleX - x1;
        const x2x = 1 - xx1;

        buf[x] = { x1, x2, xx1, x2x };
    }

    for (let y = yFirst; y < yLast; ++y) {
        const y1 = Math.floor(srcHeight * y / trgHeight);
        let y2 = y1 + 1;
        if (y2 === srcHeight) --y2;

        const yy1 = y / scaleY - y1;
        const y2y = 1 - yy1;

        for (let x = 0; x < trgWidth; ++x) {
            const bufX = buf[x];
            const x1 = bufX.x1;
            const x2 = bufX.x2;
            const xx1 = bufX.xx1;
            const x2x = bufX.x2x;

            const x2xy2y = x2x * y2y;
            const xx1y2y = xx1 * y2y;
            const x2xyy1 = x2x * yy1;
            const xx1yy1 = xx1 * yy1;

            const pix11 = pixRead(x1, y1);
            const pix21 = pixRead(x2, y1);
            const pix12 = pixRead(x1, y2);
            const pix22 = pixRead(x2, y2);

            const interpolate = function(channel) {
                return pix11(channel) * x2xy2y + pix21(channel) * xx1y2y +
                    pix12(channel) * x2xyy1 + pix22(channel) * xx1yy1;
            };
            pixWrite(interpolate);
        }
    }
}

module.exports = {
    getByte,
    getAlpha,
    getRed,
    getGreen,
    getBlue,
    makePixel,
    rgb555to888,
    rgb565to888,
    rgb888to555,
    rgb888to565,
    unscaledCopy,
    nearestNeighborScale,
    byteRound,
    uintDivRound,
    bilinearScale,
};
