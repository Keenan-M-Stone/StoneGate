#pragma once
#include "core/state_cache.h"
#include <random>

namespace qm::backend {

class DemoSimulator {
public:
    DemoSimulator(core::StateCache& cache);
    // generate simulated measurements and results; configurable noise
    void step();
    void setNoise(double stddev);
private:
    core::StateCache& cache_;
    std::mt19937 rng_;
    double noise_std_ = 0.01;
};

} // namespace qm::backend