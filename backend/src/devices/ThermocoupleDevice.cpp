#include "devices/ThermocoupleDevice.hpp"
#include "core/PhysicsEngine.hpp"

ThermocoupleDevice::ThermocoupleDevice(std::string id, PhysicsEngine* physics)
: dev_id(id), offset(0.0), rng(std::random_device{}()), noise(0.0, 0.02), physics(physics) {}

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
            {"manufacturer", "Stone Labs: Quantum Sensors and Measurements Division"},
            {"datasheet_url", "https://example.com/thermocouple"}
        }}
    };
}

nlohmann::json ThermocoupleDevice::read_measurement() {
    double T_C = 27.0 + offset + noise(rng);
    // if physics engine is present and has a computed temperature (in K), use it
    if (physics) {
        try {
            auto state = physics->get_cached_step();
            if (state.contains(dev_id) && state[dev_id].contains("temperature_K")) {
                double Tk = state[dev_id]["temperature_K"].get<double>();
                T_C = Tk - 273.15 + offset;
            }
        } catch(...){}
    }
    return {
        {"temperature_C", T_C}
    };
}

void ThermocoupleDevice::perform_action(const nlohmann::json& cmd) {
    if (cmd.contains("zero")) offset = 0.0;
}