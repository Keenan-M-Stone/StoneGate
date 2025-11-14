/*
src/backend/diagnostic.cpp
Contains code intended to perform any device diagnostics that
can inform the health and reliability of the apparatus.
*/
#include "backend/diagnostic.h"
#include <thread>

namespace qm::backend {

DiagnosticManager::DiagnosticManager(core::StateCache& cache): cache_(cache) {}

void DiagnosticManager::registerProvider(std::shared_ptr<IDiagnosticProvider> p) {
    providers_.push_back(p);
}

void DiagnosticManager::startPolling(std::chrono::milliseconds interval) {
    running_ = true;
    std::thread([this, interval]() {
        while (running_) {
            for (auto &p: providers_) {
                try {
                    auto r = p->pollOnce();
                    core::Measurement m;
                    m.device_id = r.device_id;
                    m.ts = std::chrono::system_clock::now();
                    m.value = r.value;
                    m.units = r.units;
                    cache_.pushMeasurement(m);
                } catch(...) {
                    // log and continue
                }
            }
            std::this_thread::sleep_for(interval);
        }
    }).detach();
}

void DiagnosticManager::stop() { running_ = false; }

} // namespace