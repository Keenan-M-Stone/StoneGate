#pragma once
#include "Device.hpp"
#include <string>

/**
 * @brief Pulse sequencer for controlling quantum operations.
 */
class PulseSequencerDevice : public Device {
public:
    PulseSequencerDevice(std::string id);
    std::string id() const override;
    std::string type() const override;
    nlohmann::json descriptor() const override;
    nlohmann::json read_measurement() override;
    void perform_action(const nlohmann::json& cmd) override;
private:
    std::string dev_id;
    std::string sequence_loaded;
    int current_step;
    bool running;
};
