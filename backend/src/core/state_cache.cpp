/*
src/core/state_cache.cpp
Functions for accessing and storing signals that will be sent
to the frontend to update the frontends schematic display of the 
backend.
*/
#include "core/state_cache.h"
#include <algorithm>

namespace qm {

void StateCache::upsertDeviceMeta(const DeviceMeta& m) {
    std::unique_lock lock(mu_);
    metas_[m.device_id] = m;
}

void StateCache::pushMeasurement(const Measurement& m) {
    std::unique_lock lock(mu_);
    auto& vec = store_[m.device_id];
    vec.push_back(m);
    if (vec.size() > 1000) vec.erase(vec.begin(), vec.begin() + (vec.size() - 1000));
}

std::vector<Measurement> StateCache::getMeasurements(const std::string& device_id, size_t max) const {
    std::shared_lock lock(mu_);
    std::vector<Measurement> out;
    auto it = store_.find(device_id);
    if (it == store_.end()) return out;
    auto begin = (it->second.size() > max) ? it->second.end() - max : it->second.begin();
    out.assign(begin, it->second.end());
    return out;
}

std::optional<Measurement> StateCache::getLast(const std::string& device_id) const {
    std::shared_lock lock(mu_);
    auto it = store_.find(device_id);
    if (it == store_.end() || it->second.empty()) return std::nullopt;
    return it->second.back();
}

std::vector<DeviceMeta> StateCache::listDeviceMeta() const {
    std::shared_lock lock(mu_);
    std::vector<DeviceMeta> out;
    out.reserve(metas_.size());
    for (auto &p : metas_) out.push_back(p.second);
    return out;
}

} // namespace qm