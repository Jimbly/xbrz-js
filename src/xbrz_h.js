// Ported from C++ code licensed under
// GNU General Public License: https://www.gnu.org/licenses/gpl-3.0

const ColorFormat = //from high bits -> low bits, 8 bit per channel
{
    rgb: 'rgb',  //8 bit for each red, green, blue, upper 8 bits unused
    argb: 'argb', //including alpha channel, BGRA byte order on little-endian machines
    argbUnbuffered: 'argbUnbuffered', //like ARGB, but without the one-time buffer creation overhead (ca. 100 - 300 ms) at the expense of a slightly slower scaling time
};

const SCALE_FACTOR_MAX = 6;

module.exports = {
  ColorFormat,
  SCALE_FACTOR_MAX,
};
