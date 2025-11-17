#pragma once
#include "Device.hpp"
#include <random>

class ThermocoupleDevice : public Device {
public:
    ThermocoupleDevice(std::string id);

    std::string id() const override;
    std::string type() const override;
    nlohmann::json descriptor() const override;
    nlohmann::json read_measurement() override;
    void perform_action(const nlohmann::json& cmd) override;

private:
    std::string dev_id;
    double offset;
    std::default_random_engine rng;
    std::normal_distribution<double> noise;
};