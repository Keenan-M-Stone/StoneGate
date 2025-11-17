#pragma once
#include <vector>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <string>
#include <nlohmann/json.hpp>

class Device;

class DeviceRegistry {
public:
    DeviceRegistry();

    void register_device(std::shared_ptr<Device> dev);

    // Return all descriptors for FE discovery
    nlohmann::json get_descriptor_graph();

    // Poll live measurements
    nlohmann::json poll_all();

private:
    std::vector<std::shared_ptr<Device>> devices;
    std::mutex registry_mutex;
};
