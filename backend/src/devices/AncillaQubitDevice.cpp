#include "devices/AncillaQubitDevice.hpp"

AncillaQubitDevice::AncillaQubitDevice(std::string id)
: dev_id(id), last_measurement(0), role("syndrome") {}

std::string AncillaQubitDevice::id() const { return dev_id; }
std::string AncillaQubitDevice::type() const { return "ancilla_qubit"; }

nlohmann::json AncillaQubitDevice::descriptor() const {
    return {
        {"id", dev_id},
        {"type", "ancilla_qubit"},
        {"role", role},
        {"status", "ok"}
    };
}

nlohmann::json AncillaQubitDevice::read_measurement() {
    last_measurement = std::uniform_int_distribution<int>(0,1)(rng);
    return {
        {"state", last_measurement},
        {"role", role}
    };
}

void AncillaQubitDevice::perform_action(const nlohmann::json& cmd) {
    if (cmd.contains("reset")) last_measurement = 0;
    if (cmd.contains("set_role")) role = cmd["set_role"].get<std::string>();
}
