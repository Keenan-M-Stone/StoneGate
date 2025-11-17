#pragma once
#include <nlohmann/json.hpp>
#include <string>

class DeviceRegistry;

class DescriptorProtocol {
public:
    DescriptorProtocol(DeviceRegistry& reg);
    nlohmann::json build_descriptor_message();
    nlohmann::json build_measurement_update();

private:
    DeviceRegistry& registry;
};
