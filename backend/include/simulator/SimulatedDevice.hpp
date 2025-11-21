#pragma once
#include "Device.hpp"
#include <string>
#include <vector>
#include <random>
#include <nlohmann/json.hpp>

class PhysicsEngine;

class SimulatedDevice : public Device {
public:
    // physics may be nullptr for standalone devices; node_id is used to query physics results
    SimulatedDevice(const std::string& id, const std::string& type, const std::vector<std::string>& props = {}, uint64_t seed = 0, PhysicsEngine* physics = nullptr);
    ~SimulatedDevice() override = default;

    std::string id() const override;
    std::string type() const override;
    nlohmann::json descriptor() const override;
    nlohmann::json read_measurement() override;
    void perform_action(const nlohmann::json& cmd) override;
    // Trigger reload of device overrides in the attached PhysicsEngine (if any)
    bool trigger_reload_overrides();

private:
    std::string dev_id;
    std::string dev_type;
    std::vector<std::string> properties;
    double noise_seed();
    std::mt19937_64 rng;
    PhysicsEngine* physics = nullptr;
};
