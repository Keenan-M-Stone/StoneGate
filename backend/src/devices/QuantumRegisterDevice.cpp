#include "devices/QuantumRegisterDevice.hpp"

QuantumRegisterDevice::QuantumRegisterDevice(std::string id, int size)
: dev_id(id), reg_size(size), state(size, 0) {}

std::string QuantumRegisterDevice::id() const { return dev_id; }
std::string QuantumRegisterDevice::type() const { return "quantum_register"; }

nlohmann::json QuantumRegisterDevice::descriptor() const {
    return {
        {"id", dev_id},
        {"type", "quantum_register"},
        {"size", reg_size},
        {"status", "ok"},
        {"specs", { {"max_sampling_rate_hz", 2.0} }},
        {"metrics", {
            {"state_vector", { {"kind", "vector"} }}
        }}
    };
}

nlohmann::json QuantumRegisterDevice::read_measurement() {
    return {
        {"state_vector", state}
    };
}

void QuantumRegisterDevice::perform_action(const nlohmann::json& cmd) {
    if (cmd.contains("reset_all")) std::fill(state.begin(), state.end(), 0);
    if (cmd.contains("apply_gate")) {
        // Example: flip all bits (not a real gate)
        for (auto& q : state) q = 1 - q;
    }
}
