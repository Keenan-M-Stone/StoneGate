#include "devices/ThermocoupleDevice.hpp"

ThermocoupleDevice::ThermocoupleDevice(std::string id)
: dev_id(id), offset(0.0), noise(0.0, 0.02) {}

std::string ThermocoupleDevice::id() const { return dev_id; }
std::string ThermocoupleDevice::type() const { return "thermocouple"; }

nlohmann::json ThermocoupleDevice::descriptor() const {
    return {
        {"id", dev_id},
        {"type", "thermocouple"},
        {"status", "ok"},
        {"specs", {
            {"precision", 0.01},
            {"range", {-200, 500}},
            {"manufacturer", "Acme Quantum Sensors"},
            {"datasheet_url", "https://example.com/thermocouple"}
        }}
    };
}

nlohmann::json ThermocoupleDevice::read_measurement() {
    double T = 300.0 + offset + noise(rng);
    return {
        {"temperature_C", T}
    };
}

void ThermocoupleDevice::perform_action(const nlohmann::json& cmd) {
    if (cmd.contains("zero")) offset = 0.0;
}