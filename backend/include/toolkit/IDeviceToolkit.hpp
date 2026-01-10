#pragma once
#include <string>
#include <memory>
#include <nlohmann/json.hpp>
class Device;
class DeviceRegistry;
class PhysicsEngine;

/**
 * @brief Abstract interface for device/simulator toolkits (plugins).
 * Toolkits can register new device types, provide custom logic, and extend the simulator.
 */
class IDeviceToolkit {
public:
    virtual ~IDeviceToolkit() = default;
    /** @brief Toolkit name (for logging/discovery) */
    virtual std::string name() const = 0;
    /** @brief Register all device types and logic with the registry/physics engine */
    virtual void register_devices(DeviceRegistry& registry, PhysicsEngine* physics = nullptr) = 0;
    /** @brief Optionally handle device creation for a given type (return nullptr if not handled) */
    virtual std::shared_ptr<Device> create_device(const std::string& id, const std::string& type, const nlohmann::json& node, PhysicsEngine* physics = nullptr) = 0;
};
