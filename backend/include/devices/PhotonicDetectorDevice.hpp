#pragma once
#include "Device.hpp"
#include <random>

/**
 * @brief Simulated or real photonic detector device.
 *
 * Example of adding a new device type. See Device.hpp for instructions.
 */
class PhotonicDetectorDevice : public Device {
public:
    PhotonicDetectorDevice(std::string id);
    std::string id() const override;
    std::string type() const override;
    nlohmann::json descriptor() const override;
    nlohmann::json read_measurement() override;
    void perform_action(const nlohmann::json& cmd) override;
private:
    std::string dev_id;
    double dark_rate;
    std::default_random_engine rng;
};
