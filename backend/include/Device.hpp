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
    
    /** @brief JSON descriptor sent to FE describing this component*/
    virtual nlohmann::json descriptor() const = 0;
    
    /** @brief One-shot measurement read (returns JSON) */
    virtual nlohmann::json read_measurement() = 0;

    // Operation enum for commands from frontend/backend protocol
    enum class Operation {
        Unknown = 0,
        Reset,
        Zero,
        Enable,
        Disable,
        SetPower,
        SetPhase,
        Calibrate,
        ViewHistogram,
        SetIntensity
    };

    static Operation operation_from_string(const std::string& s) {
        if (s == "reset") return Operation::Reset;
        if (s == "zero") return Operation::Zero;
        if (s == "enable") return Operation::Enable;
        if (s == "disable") return Operation::Disable;
        if (s == "set_power") return Operation::SetPower;
        if (s == "set_phase") return Operation::SetPhase;
        if (s == "calibrate") return Operation::Calibrate;
        if (s == "view_histogram") return Operation::ViewHistogram;
        if (s == "set_intensity") return Operation::SetIntensity;
        return Operation::Unknown;
    }

    static std::string operation_to_string(Operation op) {
        switch (op) {
            case Operation::Reset: return "reset";
            case Operation::Zero: return "zero";
            case Operation::Enable: return "enable";
            case Operation::Disable: return "disable";
            case Operation::SetPower: return "set_power";
            case Operation::SetPhase: return "set_phase";
            case Operation::Calibrate: return "calibrate";
            case Operation::ViewHistogram: return "view_histogram";
            case Operation::SetIntensity: return "set_intensity";
            default: return "unknown";
        }
    }

    /** @brief Perform a control action (from FE or script) */
    virtual void perform_action(Operation op, const nlohmann::json& args) {
        // Default: translate to a JSON command. Devices that want structured ops
        // can override this; most devices only implement JSON-based control.
        nlohmann::json cmd = nlohmann::json::object();
        cmd[operation_to_string(op)] = args;
        perform_action(cmd);
    }

    /** @brief Perform a control action (from FE or script) */
    virtual void perform_action(const nlohmann::json& cmd) = 0;
};
