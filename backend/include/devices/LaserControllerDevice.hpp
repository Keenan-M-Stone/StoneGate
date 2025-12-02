#pragma once
#include "Device.hpp"
#include <random>

class LaserControllerDevice : public Device {
public:
    LaserControllerDevice(std::string id);

    std::string id() const override;
    std::string type() const override;
    nlohmann::json descriptor() const override;
    nlohmann::json read_measurement() override;
    void perform_action(const nlohmann::json& cmd) override;
    void perform_action(Operation op, const nlohmann::json& args) override;

private:
    std::string dev_id;
    double phase;
    double intensity;
    std::default_random_engine rng;
};