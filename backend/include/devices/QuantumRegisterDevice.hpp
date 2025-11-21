#pragma once
#include "Device.hpp"
#include <vector>
#include <string>

/**
 * @brief Quantum register device representing a collection of qubits.
 */
class QuantumRegisterDevice : public Device {
public:
    QuantumRegisterDevice(std::string id, int size);
    std::string id() const override;
    std::string type() const override;
    nlohmann::json descriptor() const override;
    nlohmann::json read_measurement() override;
    void perform_action(const nlohmann::json& cmd) override;
private:
    std::string dev_id;
    int reg_size;
    std::vector<int> state;
};
