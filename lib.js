const { ScalerCfgDefault } = require('./src/xbrz_config.js');
exports.xbrzScale = require('./src/xbrz.js').xbrzScale;
exports.xbrzConfig = function (params) {
  return {
    ...ScalerCfgDefault,
    ...params,
  };
}
exports.xbrzColorFormat = require('./src/xbrz_h.js').ColorFormat;
