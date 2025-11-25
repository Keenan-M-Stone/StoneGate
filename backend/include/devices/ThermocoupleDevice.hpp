#pragma once
#include "Device.hpp"
#include "core/PhysicsEngine.hpp"
#include <random>

// forward
class PhysicsEngine;

class ThermocoupleDevice : public Device {
public:
    ThermocoupleDevice(std::string id, PhysicsEngine* physics = nullptr);

    std::string id() const override;
    std::string type() const override;
    nlohmann::json descriptor() const override;
    nlohmann::json read_measurement() override;
    void perform_action(const nlohmann::json& cmd) override;

private:
    std::string dev_id;
    double offset;
    std::default_random_engine rng;
    PhysicsEngine* physics;
    std::normal_distribution<double> noise;
};