#pragma once
#include "Device.hpp"
#include <string>

/**
 * @brief Quantum Error Correction module device.
 */
class QECModuleDevice : public Device {
public:
    QECModuleDevice(std::string id);
    std::string id() const override;
    std::string type() const override;
    nlohmann::json descriptor() const override;
    nlohmann::json read_measurement() override;
    void perform_action(const nlohmann::json& cmd) override;
private:
    std::string dev_id;
    std::string code_type;
    int syndrome;
    bool correction_applied;
};
