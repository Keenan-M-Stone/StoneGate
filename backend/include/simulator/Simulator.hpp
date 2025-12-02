#pragma once
#include <string>
#include <cstdint>

class PhysicsEngine;
class DeviceRegistry;

class Simulator {
public:
    explicit Simulator(uint64_t seed = 0);
    // Load devices from a DeviceGraph JSON and register simulated devices into registry
    bool load_from_graph(const std::string& deviceGraphPath, DeviceRegistry& registry);

    // Access the physics engine (for advanced usage)
    PhysicsEngine* physics() { return &phys_; }

private:
    uint64_t seed_;
    PhysicsEngine phys_;
};
