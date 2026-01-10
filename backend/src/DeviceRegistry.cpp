#include "DeviceRegistry.hpp"
#include "Device.hpp"

DeviceRegistry::DeviceRegistry() {}

void DeviceRegistry::register_device(std::shared_ptr<Device> dev) {
    std::lock_guard<std::mutex> lock(registry_mutex);
    devices.push_back(dev);
}

void DeviceRegistry::for_each_device(const std::function<void(std::shared_ptr<Device>)>& fn) {
    std::lock_guard<std::mutex> lock(registry_mutex);
    for (auto& d : devices) fn(d);
}

std::shared_ptr<Device> DeviceRegistry::get_device(const std::string& id) {
    std::lock_guard<std::mutex> lock(registry_mutex);
    for (auto& d : devices) {
        if (d && d->id() == id) return d;
    }
    return nullptr;
}

nlohmann::json DeviceRegistry::get_descriptor_graph() {
    std::lock_guard<std::mutex> lock(registry_mutex);
    nlohmann::json graph = nlohmann::json::array();
    for (auto& d : devices) {
        graph.push_back(d->descriptor());
    }
    return graph;
}

nlohmann::json DeviceRegistry::poll_all() {
    std::lock_guard<std::mutex> lock(registry_mutex);
    nlohmann::json updates = nlohmann::json::array();
    for (auto& d : devices) {
        updates.push_back({ {"id", d->id()}, {"measurement", d->read_measurement()} });
    }
    return updates;
}