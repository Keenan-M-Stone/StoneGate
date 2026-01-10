#pragma once
#include <string>
#include <cstdint>

#include "core/PhysicsEngine.hpp"
class DeviceRegistry;


#include <vector>
#include <memory>
#include "toolkit/IDeviceToolkit.hpp"

class Simulator {
public:
    explicit Simulator(uint64_t seed = 0);
    // Register a toolkit/plugin
    void register_toolkit(std::shared_ptr<IDeviceToolkit> toolkit);
    // Load devices from a DeviceGraph JSON and register simulated devices into registry
    bool load_from_graph(const std::string& deviceGraphPath, DeviceRegistry& registry);

    // Access the physics engine (for advanced usage)
    PhysicsEngine* physics() { return &phys_; }

private:
    uint64_t seed_;
    PhysicsEngine phys_;
    std::vector<std::shared_ptr<IDeviceToolkit>> toolkits_;
};
