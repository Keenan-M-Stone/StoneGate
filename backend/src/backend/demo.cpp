#include "backend/demo.h"
#include <chrono>

namespace qm::backend {

DemoSimulator::DemoSimulator(core::StateCache& cache): cache_(cache) {
    rng_.seed((unsigned)std::chrono::system_clock::now().time_since_epoch().count());
}

void DemoSimulator::setNoise(double s) { noise_std_ = s; }

void DemoSimulator::step() {
    // fake thermometer
    std::normal_distribution<double> d(4.0, noise_std_);
    core::Measurement m;
    m.device_id = "therm_1";
    m.ts = std::chrono::system_clock::now();
    m.value = d(rng_);
    m.units = "K";
    cache_.pushMeasurement(m);

    // fake qubit measurement results (probabilities or binary counts)
    core::Measurement q;
    q.device_id = "result_0";
    q.ts = std::chrono::system_clock::now();
    q.value = std::vector<double>{0.5 + std::normal_distribution<double>(0.0, noise_std_)(rng_), 0.5};
    q.units = "P(0),P(1)";
    cache_.pushMeasurement(q);
}

} // namespace