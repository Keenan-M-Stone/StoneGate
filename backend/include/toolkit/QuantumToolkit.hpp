#pragma once
#include "toolkit/IDeviceToolkit.hpp"
#include <memory>
#include <string>
#include <nlohmann/json.hpp>
class Device;
class DeviceRegistry;
class PhysicsEngine;

/**
 * @brief Quantum-specific toolkit: QEC, QubitModel, etc.
 */
class QuantumToolkit : public IDeviceToolkit {
public:
    std::string name() const override { return "QuantumToolkit"; }
    void register_devices(DeviceRegistry& registry, PhysicsEngine* physics = nullptr) override;
    std::shared_ptr<Device> create_device(const std::string& id, const std::string& type, const nlohmann::json& node, PhysicsEngine* physics = nullptr) override;
};
