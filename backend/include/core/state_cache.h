#pragma once
#include <string>
#include <unordered_map>
#include <shared_mutex>
#include <chrono>
#include <variant>
#include <vector>

namespace qm {

using TimePoint = std::chrono::system_clock::time_point;

struct Measurement {
    std::string device_id;
    TimePoint ts;
    // flexible payload: number, vector, or string
    std::variant<double, std::vector<double>, std::string> value;
    std::string units;
};

struct DeviceMeta {
    std::string device_id;
    std::string type; // e.g., "thermometer", "photometer", etc.
    double tolerance_low;
    double tolerance_high;
    double baseline_offset; // display-only zero offset
};

class StateCache {
public:
    void upsertDeviceMeta(const DeviceMeta& m);
    void pushMeasurement(const Measurement& m);
    std::vector<Measurement> getMeasurements(const std::string& device_id, size_t max = 100) const;
    std::optional<Measurement> getLast(const std::string& device_id) const;
    std::vector<DeviceMeta> listDeviceMeta() const;

private:
    mutable std::shared_mutex mu_;
    std::unordered_map<std::string, DeviceMeta> metas_;
    std::unordered_map<std::string, std::vector<Measurement>> store_;
};

} // namespace qm