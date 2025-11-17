#pragma once
#include <string>
#include <nlohmann/json.hpp>

class Device {
public:
    virtual ~Device() = default;
    virtual std::string id() const = 0;
    virtual std::string type() const = 0;

    // JSON descriptor sent to FE describing this component
    virtual nlohmann::json descriptor() const = 0;

    // One-shot measurement read
    virtual nlohmann::json read_measurement() = 0;

    // Commands from FE
    virtual void perform_action(const nlohmann::json& cmd) = 0;
};
