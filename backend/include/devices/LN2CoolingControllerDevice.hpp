#pragma once
#include "Device.hpp"
#include <random>
#include "core/PhysicsEngine.hpp"

// forward
class PhysicsEngine;

/**
 * @brief Liquid Nitrogen Cooling Controller device (real or simulated).
 *
 * Example controller device. Supports setpoint and flow control.
 */
class LN2CoolingControllerDevice : public Device {
public:
    LN2CoolingControllerDevice(std::string id, PhysicsEngine* physics = nullptr);
    std::string id() const override;
    std::string type() const override;
    nlohmann::json descriptor() const override;
    nlohmann::json read_measurement() override;
    void perform_action(const nlohmann::json& cmd) override;
private:
    std::string dev_id;
    double setpoint_K;
    double flow_rate;
    std::default_random_engine rng;
    PhysicsEngine* physics;
};
