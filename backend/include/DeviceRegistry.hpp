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

    // Apply a function to each registered device (thread-safe)
    void for_each_device(const std::function<void(std::shared_ptr<Device>)>& fn);

    // Return all descriptors for FE discovery
    nlohmann::json get_descriptor_graph();

    // Poll live measurements
    nlohmann::json poll_all();

private:
    std::vector<std::shared_ptr<Device>> devices;
    std::mutex registry_mutex;
};
