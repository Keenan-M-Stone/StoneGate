#pragma once
#include <string>
#include <functional>
#include "core/state_cache.h"

namespace qm::backend {

struct DiagnosticReading {
    std::string device_id;
    double value;
    std::string units;
};

class IDiagnosticProvider {
public:
    virtual ~IDiagnosticProvider() = default;
    // poll once (blocking minimal) or push via callback when async
    virtual DiagnosticReading pollOnce() = 0;
};

// example manager that ties providers to the shared state cache
class DiagnosticManager {
public:
    DiagnosticManager(core::StateCache& cache);
    void registerProvider(std::shared_ptr<IDiagnosticProvider> p);
    // start continuous polling (spawns thread)
    void startPolling(std::chrono::milliseconds interval);
    void stop();
private:
    core::StateCache& cache_;
    std::vector<std::shared_ptr<IDiagnosticProvider>> providers_;
    bool running_ = false;
};

} // namespace qm::backend