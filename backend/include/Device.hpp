#pragma once
#include <string>
#include <nlohmann/json.hpp>

/**
 * @brief Abstract base class for all quantum/classical devices.
 *
 * To add a new device:
 *  1. Inherit from Device and implement all pure virtual methods.
 *  2. Add your device to DeviceRegistry in main.cpp or via Simulator.
 *  3. Update shared/protocol/ComponentSchema.json for FE support.
 *  4. Optionally, add a driver class for hardware communication.
 */
class Device {
public:
    virtual ~Device() = default;
    /** @brief Unique device identifier */
    virtual std::string id() const = 0;
    /** @brief Device type string (matches schema) */
    virtual std::string type() const = 0;
    /** @brief JSON descriptor for frontend discovery */
    virtual nlohmann::json descriptor() const = 0;
    /** @brief One-shot measurement read (returns JSON) */
    virtual nlohmann::json read_measurement() = 0;
    /** @brief Perform a control action (from FE or script) */
    virtual void perform_action(const nlohmann::json& cmd) = 0;
};
