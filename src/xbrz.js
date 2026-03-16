// Ported from C++ code licensed under
// GNU General Public License: https://www.gnu.org/licenses/gpl-3.0

const assert = require('assert');
const {
    getByte,
    getAlpha,
    getRed,
    getGreen,
    getBlue,
    makePixel,
    byteRound,
    uintDivRound,
    bilinearScale: bilinearScaleGeneric,
    nearestNeighborScale: nearestNeighborScaleGeneric,
} = require('./xbrz_tools');
const { ColorFormat, SCALE_FACTOR_MAX } = require('./xbrz_h');
const { ScalerCfgDefault } = require('./xbrz_config');

function stdcopy(src, start, end, trg) {
    for (let ii = 0; ii < end - start; ++ii) {
        trg[ii] = src[start + ii];
    }
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function square(v) { return v * v; }

function gradientRGB(pixFront, pixBack, M, N) {
    const calcColor = (colFront, colBack) => uintDivRound(colFront * M + colBack * (N - M), N);
    return makePixel(
        calcColor(getRed(pixFront), getRed(pixBack)),
        calcColor(getGreen(pixFront), getGreen(pixBack)),
        calcColor(getBlue(pixFront), getBlue(pixBack))
    );
}

function gradientARGB(pixFront, pixBack, M, N) {
    const weightFront = getAlpha(pixFront) * M;
    const weightBack = getAlpha(pixBack) * (N - M);
    const weightSum = weightFront + weightBack;
    if (weightSum === 0) return 0;

    const calcColor = (colFront, colBack) => uintDivRound(colFront * weightFront + colBack * weightBack, weightSum);

    return makePixel(
        uintDivRound(weightSum, N),
        calcColor(getRed(pixFront), getRed(pixBack)),
        calcColor(getGreen(pixFront), getGreen(pixBack)),
        calcColor(getBlue(pixFront), getBlue(pixBack))
    );
}

function distYCbCr(pix1, pix2, _testAttribute) {
    const r_diff = getRed(pix1) - getRed(pix2);
    const g_diff = getGreen(pix1) - getGreen(pix2);
    const b_diff = getBlue(pix1) - getBlue(pix2);

    const k_b = 0.0593;
    const k_r = 0.2627;
    const k_g = 1 - k_b - k_r;

    const scale_b = 0.5 / (1 - k_b);
    const scale_r = 0.5 / (1 - k_r);

    const y = k_r * r_diff + k_g * g_diff + k_b * b_diff;
    const c_b = scale_b * (b_diff - y);
    const c_r = scale_r * (r_diff - y);

    return Math.sqrt(square(y) + square(c_b) + square(c_r));
}

let diffToDist = null;
function buildDiffToDist() {
    const size = 1 << 24;
    const arr = new Float32Array(size);

    const k_b = 0.0593;
    const k_r = 0.2627;
    const k_g = 1 - k_b - k_r;
    const scale_b = 0.5 / (1 - k_b);
    const scale_r = 0.5 / (1 - k_r);

    for (let i = 0; i < size; ++i) {
        const r_byte = (i >>> 16) & 0xff;
        const g_byte = (i >>> 8) & 0xff;
        const b_byte = i & 0xff;

        const r_diff = ((r_byte << 24) >> 24) * 2;
        const g_diff = ((g_byte << 24) >> 24) * 2;
        const b_diff = ((b_byte << 24) >> 24) * 2;

        const y = k_r * r_diff + k_g * g_diff + k_b * b_diff;
        const c_b = scale_b * (b_diff - y);
        const c_r = scale_r * (r_diff - y);

        arr[i] = Math.sqrt(square(y) + square(c_b) + square(c_r));
    }
    return arr;
}

function distYCbCrBuffered(pix1, pix2, testAttribute) {
    if (!diffToDist) diffToDist = buildDiffToDist();

    const r_diff = getRed(pix1) - getRed(pix2);
    const g_diff = getGreen(pix1) - getGreen(pix2);
    const b_diff = getBlue(pix1) - getBlue(pix2);

    const index = (((r_diff / 2) | 0) & 0xff) << 16 |
                  (((g_diff / 2) | 0) & 0xff) << 8 |
                  (((b_diff / 2) | 0) & 0xff);

    return diffToDist[index];
}

const ColorDistanceRGB = {
    dist(pix1, pix2, testAttribute) {
        return distYCbCrBuffered(pix1, pix2, testAttribute);
    },
};

const ColorDistanceARGB = {
    dist(pix1, pix2, testAttribute) {
        const a1 = getAlpha(pix1) / 255.0;
        const a2 = getAlpha(pix2) / 255.0;

        const d = distYCbCrBuffered(pix1, pix2, testAttribute);
        if (a1 < a2)
            return a1 * d + 255 * (a2 - a1);
        return a2 * d + 255 * (a1 - a2);
    },
};

const ColorDistanceUnbufferedARGB = {
    dist(pix1, pix2, testAttribute) {
        const a1 = getAlpha(pix1) / 255.0;
        const a2 = getAlpha(pix2) / 255.0;

        const d = distYCbCr(pix1, pix2, testAttribute);
        if (a1 < a2)
            return a1 * d + 255 * (a2 - a1);
        return a2 * d + 255 * (a1 - a2);
    },
};

function alphaGrad(out, i, j, pixFront, M, N, gradientFn) {
    const idx = out.index(i, j);
    out.trg[idx] = gradientFn(pixFront, out.trg[idx], M, N);
}

function setOut(out, i, j, col) {
    out.trg[out.index(i, j)] = col;
}

function makeScaler2x(gradientFn) {
    return {
        scale: 2,
        blendLineShallow(col, out) {
            alphaGrad(out, 1, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 1, 1, col, 3, 4, gradientFn);
        },
        blendLineSteep(col, out) {
            alphaGrad(out, 0, 1, col, 1, 4, gradientFn);
            alphaGrad(out, 1, 1, col, 3, 4, gradientFn);
        },
        blendLineSteepAndShallow(col, out) {
            alphaGrad(out, 1, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 0, 1, col, 1, 4, gradientFn);
            alphaGrad(out, 1, 1, col, 5, 6, gradientFn);
        },
        blendLineDiagonal(col, out) {
            alphaGrad(out, 1, 1, col, 1, 2, gradientFn);
        },
        blendCorner(col, out) {
            alphaGrad(out, 1, 1, col, 21, 100, gradientFn);
        },
    };
}

function makeScaler3x(gradientFn) {
    return {
        scale: 3,
        blendLineShallow(col, out) {
            alphaGrad(out, 2, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 1, 2, col, 1, 4, gradientFn);

            alphaGrad(out, 2, 1, col, 3, 4, gradientFn);
            setOut(out, 2, 2, col);
        },
        blendLineSteep(col, out) {
            alphaGrad(out, 0, 2, col, 1, 4, gradientFn);
            alphaGrad(out, 2, 1, col, 1, 4, gradientFn);

            alphaGrad(out, 1, 2, col, 3, 4, gradientFn);
            setOut(out, 2, 2, col);
        },
        blendLineSteepAndShallow(col, out) {
            alphaGrad(out, 2, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 0, 2, col, 1, 4, gradientFn);
            alphaGrad(out, 2, 1, col, 3, 4, gradientFn);
            alphaGrad(out, 1, 2, col, 3, 4, gradientFn);
            setOut(out, 2, 2, col);
        },
        blendLineDiagonal(col, out) {
            alphaGrad(out, 1, 2, col, 1, 8, gradientFn);
            alphaGrad(out, 2, 1, col, 1, 8, gradientFn);
            alphaGrad(out, 2, 2, col, 7, 8, gradientFn);
        },
        blendCorner(col, out) {
            alphaGrad(out, 2, 2, col, 45, 100, gradientFn);
        },
    };
}

function makeScaler4x(gradientFn) {
    return {
        scale: 4,
        blendLineShallow(col, out) {
            alphaGrad(out, 3, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 2, 2, col, 1, 4, gradientFn);

            alphaGrad(out, 3, 1, col, 3, 4, gradientFn);
            alphaGrad(out, 2, 3, col, 3, 4, gradientFn);

            setOut(out, 3, 2, col);
            setOut(out, 3, 3, col);
        },
        blendLineSteep(col, out) {
            alphaGrad(out, 0, 3, col, 1, 4, gradientFn);
            alphaGrad(out, 2, 2, col, 1, 4, gradientFn);

            alphaGrad(out, 1, 3, col, 3, 4, gradientFn);
            alphaGrad(out, 3, 2, col, 3, 4, gradientFn);

            setOut(out, 2, 3, col);
            setOut(out, 3, 3, col);
        },
        blendLineSteepAndShallow(col, out) {
            alphaGrad(out, 3, 1, col, 3, 4, gradientFn);
            alphaGrad(out, 1, 3, col, 3, 4, gradientFn);
            alphaGrad(out, 3, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 0, 3, col, 1, 4, gradientFn);

            alphaGrad(out, 2, 2, col, 1, 3, gradientFn);

            setOut(out, 3, 3, col);
            setOut(out, 3, 2, col);
            setOut(out, 2, 3, col);
        },
        blendLineDiagonal(col, out) {
            alphaGrad(out, 3, 2, col, 1, 2, gradientFn);
            alphaGrad(out, 2, 3, col, 1, 2, gradientFn);
            setOut(out, 3, 3, col);
        },
        blendCorner(col, out) {
            alphaGrad(out, 3, 3, col, 68, 100, gradientFn);
            alphaGrad(out, 3, 2, col, 9, 100, gradientFn);
            alphaGrad(out, 2, 3, col, 9, 100, gradientFn);
        },
    };
}

function makeScaler5x(gradientFn) {
    return {
        scale: 5,
        blendLineShallow(col, out) {
            alphaGrad(out, 4, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 3, 2, col, 1, 4, gradientFn);
            alphaGrad(out, 2, 4, col, 1, 4, gradientFn);

            alphaGrad(out, 4, 1, col, 3, 4, gradientFn);
            alphaGrad(out, 3, 3, col, 3, 4, gradientFn);

            setOut(out, 4, 2, col);
            setOut(out, 4, 3, col);
            setOut(out, 4, 4, col);
            setOut(out, 3, 4, col);
        },
        blendLineSteep(col, out) {
            alphaGrad(out, 0, 4, col, 1, 4, gradientFn);
            alphaGrad(out, 2, 3, col, 1, 4, gradientFn);
            alphaGrad(out, 4, 2, col, 1, 4, gradientFn);

            alphaGrad(out, 1, 4, col, 3, 4, gradientFn);
            alphaGrad(out, 3, 3, col, 3, 4, gradientFn);

            setOut(out, 2, 4, col);
            setOut(out, 3, 4, col);
            setOut(out, 4, 4, col);
            setOut(out, 4, 3, col);
        },
        blendLineSteepAndShallow(col, out) {
            alphaGrad(out, 0, 4, col, 1, 4, gradientFn);
            alphaGrad(out, 2, 3, col, 1, 4, gradientFn);
            alphaGrad(out, 1, 4, col, 3, 4, gradientFn);

            alphaGrad(out, 4, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 3, 2, col, 1, 4, gradientFn);
            alphaGrad(out, 4, 1, col, 3, 4, gradientFn);

            alphaGrad(out, 3, 3, col, 2, 3, gradientFn);

            setOut(out, 2, 4, col);
            setOut(out, 3, 4, col);
            setOut(out, 4, 4, col);

            setOut(out, 4, 2, col);
            setOut(out, 4, 3, col);
        },
        blendLineDiagonal(col, out) {
            alphaGrad(out, 4, 2, col, 1, 8, gradientFn);
            alphaGrad(out, 3, 3, col, 1, 8, gradientFn);
            alphaGrad(out, 2, 4, col, 1, 8, gradientFn);

            alphaGrad(out, 4, 3, col, 7, 8, gradientFn);
            alphaGrad(out, 3, 4, col, 7, 8, gradientFn);

            setOut(out, 4, 4, col);
        },
        blendCorner(col, out) {
            alphaGrad(out, 4, 4, col, 86, 100, gradientFn);
            alphaGrad(out, 4, 3, col, 23, 100, gradientFn);
            alphaGrad(out, 3, 4, col, 23, 100, gradientFn);
        },
    };
}

function makeScaler6x(gradientFn) {
    return {
        scale: 6,
        blendLineShallow(col, out) {
            alphaGrad(out, 5, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 4, 2, col, 1, 4, gradientFn);
            alphaGrad(out, 3, 4, col, 1, 4, gradientFn);

            alphaGrad(out, 5, 1, col, 3, 4, gradientFn);
            alphaGrad(out, 4, 3, col, 3, 4, gradientFn);
            alphaGrad(out, 3, 5, col, 3, 4, gradientFn);

            setOut(out, 5, 2, col);
            setOut(out, 5, 3, col);
            setOut(out, 5, 4, col);
            setOut(out, 5, 5, col);

            setOut(out, 4, 4, col);
            setOut(out, 4, 5, col);
        },
        blendLineSteep(col, out) {
            alphaGrad(out, 0, 5, col, 1, 4, gradientFn);
            alphaGrad(out, 2, 4, col, 1, 4, gradientFn);
            alphaGrad(out, 4, 3, col, 1, 4, gradientFn);

            alphaGrad(out, 1, 5, col, 3, 4, gradientFn);
            alphaGrad(out, 3, 4, col, 3, 4, gradientFn);
            alphaGrad(out, 5, 3, col, 3, 4, gradientFn);

            setOut(out, 2, 5, col);
            setOut(out, 3, 5, col);
            setOut(out, 4, 5, col);
            setOut(out, 5, 5, col);

            setOut(out, 4, 4, col);
            setOut(out, 5, 4, col);
        },
        blendLineSteepAndShallow(col, out) {
            alphaGrad(out, 0, 5, col, 1, 4, gradientFn);
            alphaGrad(out, 2, 4, col, 1, 4, gradientFn);
            alphaGrad(out, 1, 5, col, 3, 4, gradientFn);
            alphaGrad(out, 3, 4, col, 3, 4, gradientFn);

            alphaGrad(out, 5, 0, col, 1, 4, gradientFn);
            alphaGrad(out, 4, 2, col, 1, 4, gradientFn);
            alphaGrad(out, 5, 1, col, 3, 4, gradientFn);
            alphaGrad(out, 4, 3, col, 3, 4, gradientFn);

            setOut(out, 2, 5, col);
            setOut(out, 3, 5, col);
            setOut(out, 4, 5, col);
            setOut(out, 5, 5, col);

            setOut(out, 4, 4, col);
            setOut(out, 5, 4, col);

            setOut(out, 5, 2, col);
            setOut(out, 5, 3, col);
        },
        blendLineDiagonal(col, out) {
            alphaGrad(out, 5, 3, col, 1, 2, gradientFn);
            alphaGrad(out, 4, 4, col, 1, 2, gradientFn);
            alphaGrad(out, 3, 5, col, 1, 2, gradientFn);

            setOut(out, 4, 5, col);
            setOut(out, 5, 5, col);
            setOut(out, 5, 4, col);
        },
        blendCorner(col, out) {
            alphaGrad(out, 5, 5, col, 97, 100, gradientFn);
            alphaGrad(out, 4, 5, col, 42, 100, gradientFn);
            alphaGrad(out, 5, 4, col, 42, 100, gradientFn);
            alphaGrad(out, 5, 3, col, 6, 100, gradientFn);
            alphaGrad(out, 3, 5, col, 6, 100, gradientFn);
        },
    };
}

const ROT_MAP = [
    { a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', g: 'g', h: 'h', i: 'i' },
    { a: 'g', b: 'd', c: 'a', d: 'h', e: 'e', f: 'b', g: 'i', h: 'f', i: 'c' },
    { a: 'i', b: 'h', c: 'g', d: 'f', e: 'e', f: 'd', g: 'c', h: 'b', i: 'a' },
    { a: 'c', b: 'f', c: 'i', d: 'b', e: 'e', f: 'h', g: 'a', h: 'd', i: 'g' },
];

function rotateIndex(N, rotDeg, i, j) {
    switch (rotDeg) {
        case 0: return [i, j];
        case 1: return [N - 1 - j, i];
        case 2: return [N - 1 - i, N - 1 - j];
        case 3: return [j, N - 1 - i];
        default: return [i, j];
    }
}

function createOutputMatrix(trg, baseIndex, trgWidth, scale, rotDeg) {
    return {
        trg,
        baseIndex,
        trgWidth,
        scale,
        rotDeg,
        index(i, j) {
            const [io, jo] = rotateIndex(scale, rotDeg, i, j);
            return baseIndex + jo + io * trgWidth;
        },
    };
}

const BLEND_NONE = 0;
const BLEND_NORMAL = 1;
const BLEND_DOMINANT = 2;

function getTopR(b) { return (b >>> 2) & 0x3; }
function getBottomR(b) { return (b >>> 4) & 0x3; }
function getBottomL(b) { return (b >>> 6) & 0x3; }

function clearAddTopL(_b, bt) { return bt & 0x3; }
function addTopR(b, bt) { return b | (bt << 2); }
function addBottomR(b, bt) { return b | (bt << 4); }
function addBottomL(b, bt) { return b | (bt << 6); }

function blendingNeeded(b) { return b !== 0; }

function rotateBlendInfo(b, rotDeg) {
    switch (rotDeg) {
        case 0: return b;
        case 1: return ((b << 2) | (b >>> 6)) & 0xff;
        case 2: return ((b << 4) | (b >>> 4)) & 0xff;
        case 3: return ((b << 6) | (b >>> 2)) & 0xff;
        default: return b;
    }
}

function preProcessCorners(ker, cfg, ColorDistance) {
    if ((ker.e === ker.f && ker.h === ker.i) || (ker.e === ker.h && ker.f === ker.i))
        return { blend_e: 0, blend_f: 0, blend_h: 0, blend_i: 0 };

    const dist = (p1, p2) => ColorDistance.dist(p1, p2, cfg.testAttribute);

    const hf = dist(ker.g, ker.e) + dist(ker.e, ker.c) + dist(ker.k, ker.i) + dist(ker.i, ker.o) + cfg.centerDirectionBias * dist(ker.h, ker.f);
    const ei = dist(ker.d, ker.h) + dist(ker.h, ker.l) + dist(ker.b, ker.f) + dist(ker.f, ker.n) + cfg.centerDirectionBias * dist(ker.e, ker.i);

    const result = { blend_e: 0, blend_f: 0, blend_h: 0, blend_i: 0 };
    if (hf < ei) {
        const dominantGradient = cfg.dominantDirectionThreshold * hf < ei;
        if (ker.e !== ker.f && ker.e !== ker.h)
            result.blend_e = dominantGradient ? BLEND_DOMINANT : BLEND_NORMAL;

        if (ker.i !== ker.h && ker.i !== ker.f)
            result.blend_i = dominantGradient ? BLEND_DOMINANT : BLEND_NORMAL;
    } else if (ei < hf) {
        const dominantGradient = cfg.dominantDirectionThreshold * ei < hf;
        if (ker.h !== ker.e && ker.h !== ker.i)
            result.blend_h = dominantGradient ? BLEND_DOMINANT : BLEND_NORMAL;

        if (ker.f !== ker.e && ker.f !== ker.i)
            result.blend_f = dominantGradient ? BLEND_DOMINANT : BLEND_NORMAL;
    }
    return result;
}

function blendPixel(ker, blendInfo, cfg, Scaler, ColorDistance, out, rotDeg) {
    const blend = rotateBlendInfo(blendInfo, rotDeg);
    if (getBottomR(blend) < BLEND_NORMAL) return;

    const map = ROT_MAP[rotDeg];
    const b = ker[map.b];
    const c = ker[map.c];
    const d = ker[map.d];
    const e = ker[map.e];
    const f = ker[map.f];
    const g = ker[map.g];
    const h = ker[map.h];
    const i = ker[map.i];

    const dist = (p1, p2) => ColorDistance.dist(p1, p2, cfg.testAttribute);
    const eq = (p1, p2) => dist(p1, p2) < cfg.equalColorTolerance;

    const doLineBlend = (() => {
        if (getBottomR(blend) >= BLEND_DOMINANT) return true;
        if (getTopR(blend) !== BLEND_NONE && !eq(e, g)) return false;
        if (getBottomL(blend) !== BLEND_NONE && !eq(e, c)) return false;
        if (!eq(e, i) && eq(g, h) && eq(h, i) && eq(i, f) && eq(f, c)) return false;
        return true;
    })();

    const px = dist(e, f) <= dist(e, h) ? f : h;

    if (doLineBlend) {
        const fg = dist(f, g);
        const hc = dist(h, c);

        const haveShallowLine = cfg.steepDirectionThreshold * fg <= hc && e !== g && d !== g;
        const haveSteepLine = cfg.steepDirectionThreshold * hc <= fg && e !== c && b !== c;

        if (haveShallowLine) {
            if (haveSteepLine) Scaler.blendLineSteepAndShallow(px, out);
            else Scaler.blendLineShallow(px, out);
        } else {
            if (haveSteepLine) Scaler.blendLineSteep(px, out);
            else Scaler.blendLineDiagonal(px, out);
        }
    } else {
        Scaler.blendCorner(px, out);
    }
}

class OobReaderTransparent {
    constructor(src, srcWidth, srcHeight, y) {
        this.s_m1 = 0 <= y - 1 && y - 1 < srcHeight ? src.subarray(srcWidth * (y - 1), srcWidth * y) : null;
        this.s_0 = 0 <= y && y < srcHeight ? src.subarray(srcWidth * y, srcWidth * (y + 1)) : null;
        this.s_p1 = 0 <= y + 1 && y + 1 < srcHeight ? src.subarray(srcWidth * (y + 1), srcWidth * (y + 2)) : null;
        this.s_p2 = 0 <= y + 2 && y + 2 < srcHeight ? src.subarray(srcWidth * (y + 2), srcWidth * (y + 3)) : null;
        this.srcWidth = srcWidth;
    }

    readPonm(ker, x) {
        const x_p2 = x + 2;
        if (0 <= x_p2 && x_p2 < this.srcWidth) {
            ker.p = this.s_m1 ? this.s_m1[x_p2] : 0;
            ker.o = this.s_0 ? this.s_0[x_p2] : 0;
            ker.n = this.s_p1 ? this.s_p1[x_p2] : 0;
            ker.m = this.s_p2 ? this.s_p2[x_p2] : 0;
        } else {
            ker.p = 0;
            ker.o = 0;
            ker.n = 0;
            ker.m = 0;
        }
    }
}

class OobReaderDuplicate {
    constructor(src, srcWidth, srcHeight, y) {
        this.s_m1 = src.subarray(srcWidth * clamp(y - 1, 0, srcHeight - 1), srcWidth * (clamp(y - 1, 0, srcHeight - 1) + 1));
        this.s_0 = src.subarray(srcWidth * clamp(y, 0, srcHeight - 1), srcWidth * (clamp(y, 0, srcHeight - 1) + 1));
        this.s_p1 = src.subarray(srcWidth * clamp(y + 1, 0, srcHeight - 1), srcWidth * (clamp(y + 1, 0, srcHeight - 1) + 1));
        this.s_p2 = src.subarray(srcWidth * clamp(y + 2, 0, srcHeight - 1), srcWidth * (clamp(y + 2, 0, srcHeight - 1) + 1));
        this.srcWidth = srcWidth;
    }

    readPonm(ker, x) {
        const x_p2 = clamp(x + 2, 0, this.srcWidth - 1);
        ker.p = this.s_m1[x_p2];
        ker.o = this.s_0[x_p2];
        ker.n = this.s_p1[x_p2];
        ker.m = this.s_p2[x_p2];
    }
}

function fillBlock(trg, trgWidth, baseIndex, col, blockSize) {
    for (let y = 0; y < blockSize; ++y) {
        const row = baseIndex + y * trgWidth;
        for (let x = 0; x < blockSize; ++x) {
            trg[row + x] = col;
        }
    }
}

function scaleImage(Scaler, ColorDistance, OobReader, src, trg, srcWidth, srcHeight, cfg, yFirst, yLast) {
    yFirst = Math.max(yFirst, 0);
    yLast = Math.min(yLast, srcHeight);
    if (yFirst >= yLast || srcWidth <= 0) return;

    const trgWidth = srcWidth * Scaler.scale;
    const preProcBuf = new Uint8Array(srcWidth);

    {
        const oobReader = new OobReader(src, srcWidth, srcHeight, yFirst - 1);
        const ker4 = {
            a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, i: 0,
            j: 0, k: 0, l: 0, m: 0, n: 0, o: 0, p: 0,
        };

        oobReader.readPonm(ker4, -4);
        ker4.a = ker4.p;
        ker4.d = ker4.o;
        ker4.g = ker4.n;
        ker4.j = ker4.m;

        oobReader.readPonm(ker4, -3);
        ker4.b = ker4.p;
        ker4.e = ker4.o;
        ker4.h = ker4.n;
        ker4.k = ker4.m;

        oobReader.readPonm(ker4, -2);
        ker4.c = ker4.p;
        ker4.f = ker4.o;
        ker4.i = ker4.n;
        ker4.l = ker4.m;

        oobReader.readPonm(ker4, -1);

        {
            const res = preProcessCorners(ker4, cfg, ColorDistance);
            preProcBuf[0] = clearAddTopL(preProcBuf[0], res.blend_i);
        }

        for (let x = 0; x < srcWidth; ++x) {
            ker4.a = ker4.b;
            ker4.d = ker4.e;
            ker4.g = ker4.h;
            ker4.j = ker4.k;
            ker4.b = ker4.c;
            ker4.e = ker4.f;
            ker4.h = ker4.i;
            ker4.k = ker4.l;
            ker4.c = ker4.p;
            ker4.f = ker4.o;
            ker4.i = ker4.n;
            ker4.l = ker4.m;

            oobReader.readPonm(ker4, x);

            const res = preProcessCorners(ker4, cfg, ColorDistance);
            preProcBuf[x] = addTopR(preProcBuf[x], res.blend_h);

            if (x + 1 < srcWidth)
                preProcBuf[x + 1] = clearAddTopL(preProcBuf[x + 1], res.blend_i);
        }
    }

    for (let y = yFirst; y < yLast; ++y) {
        const oobReader = new OobReader(src, srcWidth, srcHeight, y);

        const ker4 = {
            a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, i: 0,
            j: 0, k: 0, l: 0, m: 0, n: 0, o: 0, p: 0,
        };

        oobReader.readPonm(ker4, -4);
        ker4.a = ker4.p;
        ker4.d = ker4.o;
        ker4.g = ker4.n;
        ker4.j = ker4.m;

        oobReader.readPonm(ker4, -3);
        ker4.b = ker4.p;
        ker4.e = ker4.o;
        ker4.h = ker4.n;
        ker4.k = ker4.m;

        oobReader.readPonm(ker4, -2);
        ker4.c = ker4.p;
        ker4.f = ker4.o;
        ker4.i = ker4.n;
        ker4.l = ker4.m;

        oobReader.readPonm(ker4, -1);

        let blend_xy1 = 0;
        {
            const res = preProcessCorners(ker4, cfg, ColorDistance);
            blend_xy1 = clearAddTopL(blend_xy1, res.blend_i);
            preProcBuf[0] = addBottomL(preProcBuf[0], res.blend_f);
        }

        let outBase = Scaler.scale * y * trgWidth;
        for (let x = 0; x < srcWidth; ++x, outBase += Scaler.scale) {
            ker4.a = ker4.b;
            ker4.d = ker4.e;
            ker4.g = ker4.h;
            ker4.j = ker4.k;
            ker4.b = ker4.c;
            ker4.e = ker4.f;
            ker4.h = ker4.i;
            ker4.k = ker4.l;
            ker4.c = ker4.p;
            ker4.f = ker4.o;
            ker4.i = ker4.n;
            ker4.l = ker4.m;

            oobReader.readPonm(ker4, x);

            let blend_xy = preProcBuf[x];
            {
                const res = preProcessCorners(ker4, cfg, ColorDistance);
                blend_xy = addBottomR(blend_xy, res.blend_e);

                blend_xy1 = addTopR(blend_xy1, res.blend_h);
                preProcBuf[x] = blend_xy1;

                if (x + 1 < srcWidth) {
                    blend_xy1 = clearAddTopL(blend_xy1, res.blend_i);
                    preProcBuf[x + 1] = addBottomL(preProcBuf[x + 1], res.blend_f);
                }
            }

            fillBlock(trg, trgWidth, outBase, ker4.e, Scaler.scale);

            if (blendingNeeded(blend_xy)) {
                const ker3 = ker4;

                const out0 = createOutputMatrix(trg, outBase, trgWidth, Scaler.scale, 0);
                blendPixel(ker3, blend_xy, cfg, Scaler, ColorDistance, out0, 0);

                const out1 = createOutputMatrix(trg, outBase, trgWidth, Scaler.scale, 1);
                blendPixel(ker3, blend_xy, cfg, Scaler, ColorDistance, out1, 1);

                const out2 = createOutputMatrix(trg, outBase, trgWidth, Scaler.scale, 2);
                blendPixel(ker3, blend_xy, cfg, Scaler, ColorDistance, out2, 2);

                const out3 = createOutputMatrix(trg, outBase, trgWidth, Scaler.scale, 3);
                blendPixel(ker3, blend_xy, cfg, Scaler, ColorDistance, out3, 3);
            }
        }
    }
}

function makeScalerForFormat(scale, colFmt) {
    const gradientFn = colFmt === ColorFormat.rgb ? gradientRGB : gradientARGB;
    switch (scale) {
        case 2: return makeScaler2x(gradientFn);
        case 3: return makeScaler3x(gradientFn);
        case 4: return makeScaler4x(gradientFn);
        case 5: return makeScaler5x(gradientFn);
        case 6: return makeScaler6x(gradientFn);
        default: return null;
    }
}

function xbrzScale(factor, src, trg, srcWidth, srcHeight, colFmt, cfg, yFirst, yLast) {
    if (factor === 1) {
        stdcopy(src, yFirst * srcWidth, yLast * srcWidth, trg);
        return;
    }

    const cfgUse = cfg || ScalerCfgDefault;
    const yFirstUse = yFirst == null ? 0 : yFirst;
    const yLastUse = yLast == null ? srcHeight : Math.min(yLast, srcHeight);

    assert.equal(SCALE_FACTOR_MAX, 6);

    switch (colFmt) {
        case ColorFormat.rgb: {
            const scaler = makeScalerForFormat(factor, ColorFormat.rgb);
            if (!scaler) break;
            scaleImage(scaler, ColorDistanceRGB, OobReaderDuplicate, src, trg, srcWidth, srcHeight, cfgUse, yFirstUse, yLastUse);
            return;
        }
        case ColorFormat.argb: {
            const scaler = makeScalerForFormat(factor, ColorFormat.argb);
            if (!scaler) break;
            scaleImage(scaler, ColorDistanceARGB, OobReaderTransparent, src, trg, srcWidth, srcHeight, cfgUse, yFirstUse, yLastUse);
            return;
        }
        case ColorFormat.argbUnbuffered: {
            const scaler = makeScalerForFormat(factor, ColorFormat.argb);
            if (!scaler) break;
            scaleImage(scaler, ColorDistanceUnbufferedARGB, OobReaderTransparent, src, trg, srcWidth, srcHeight, cfgUse, yFirstUse, yLastUse);
            return;
        }
    }
    assert(false);
}

function equalColorTest2(col1, col2, colFmt, equalColorTolerance, testAttribute) {
    switch (colFmt) {
        case ColorFormat.rgb:
            return ColorDistanceRGB.dist(col1, col2, testAttribute) < equalColorTolerance;
        case ColorFormat.argb:
            return ColorDistanceARGB.dist(col1, col2, testAttribute) < equalColorTolerance;
        case ColorFormat.argbUnbuffered:
            return ColorDistanceUnbufferedARGB.dist(col1, col2, testAttribute) < equalColorTolerance;
    }
    assert(false);
    return false;
}

function bilinearScale(src, srcWidth, srcHeight, trg, trgWidth, trgHeight) {
    let outIndex = 0;
    const pixRead = (x, y) => {
        const pixSrc = src[y * srcWidth + x];
        const a = getAlpha(pixSrc);
        return (channel) => {
            if (channel === 3) return a;
            return getByte(pixSrc, channel) * a;
        };
    };

    const pixWrite = (interpolate) => {
        const a = interpolate(3);
        if (a <= 0.0) {
            trg[outIndex++] = 0;
        } else {
            trg[outIndex++] = makePixel(
                byteRound(a),
                byteRound(interpolate(2) / a),
                byteRound(interpolate(1) / a),
                byteRound(interpolate(0) / a)
            );
        }
    };

    bilinearScaleGeneric(pixRead, srcWidth, srcHeight, pixWrite, trgWidth, trgHeight, 0, trgHeight);
}

function nearestNeighborScale(src, srcWidth, srcHeight, trg, trgWidth, trgHeight) {
    let outIndex = 0;
    const pixRead = (x, y) => src[y * srcWidth + x];
    const pixWrite = (pix) => { trg[outIndex++] = pix; };

    nearestNeighborScaleGeneric(pixRead, srcWidth, srcHeight, pixWrite, trgWidth, trgHeight, 0, trgHeight);
}

module.exports = {
    xbrzScale,
    equalColorTest2,
    bilinearScale,
    nearestNeighborScale,
};
