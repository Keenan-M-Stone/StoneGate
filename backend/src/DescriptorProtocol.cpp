#include "DescriptorProtocol.hpp"
#include "DeviceRegistry.hpp"

DescriptorProtocol::DescriptorProtocol(DeviceRegistry& reg)
: registry(reg) {}

nlohmann::json DescriptorProtocol::build_descriptor_message() {
    return {
        {"type", "descriptor"},
        {"devices", registry.get_descriptor_graph()}
    };
}

nlohmann::json DescriptorProtocol::build_measurement_update() {
    return {
        {"type", "measurement_update"},
        {"updates", registry.poll_all()}
    };
}