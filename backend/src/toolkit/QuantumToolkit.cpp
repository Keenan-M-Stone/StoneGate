#include "toolkit/QuantumToolkit.hpp"
#include "devices/QECModuleDevice.hpp"
#include "simulator/qubit_sim.hpp"
#include "DeviceRegistry.hpp"
#include <memory>

void QuantumToolkit::register_devices(DeviceRegistry& registry, PhysicsEngine* physics) {
    // Example: register a default QEC module device
    auto dev = std::make_shared<QECModuleDevice>("qec_module_0");
    registry.register_device(dev);
    // Optionally: register qubit models, etc.
}

std::shared_ptr<Device> QuantumToolkit::create_device(const std::string& id, const std::string& type, const nlohmann::json& node, PhysicsEngine* physics) {
    if (type == "qec_module") {
        return std::make_shared<QECModuleDevice>(id);
    }
    // Optionally: handle qubit models, etc.
    return nullptr;
}
