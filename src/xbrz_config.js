const ScalerCfgDefault = {
    equalColorTolerance        : 30,
    centerDirectionBias        : 4,
    dominantDirectionThreshold : 3.6,
    steepDirectionThreshold    : 2.4,
    oobRead                    : 'auto' | 'duplicate' | 'transparent',
    testAttribute              : 0, //unused; test new parameters
};

module.exports = {
    ScalerCfgDefault,
};
