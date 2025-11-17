#include "devices/LaserControllerDevice.hpp"

LaserControllerDevice::LaserControllerDevice(std::string id)
: dev_id(id), phase(0.0), intensity(1.0) {}

std::string LaserControllerDevice::id() const { return dev_id; }
std::string LaserControllerDevice::type() const { return "laser_controller"; }

nlohmann::json LaserControllerDevice::descriptor() const {
    return {
        {"id", dev_id},
        {"type", "laser_controller"},
        {"status", "ok"},
        {"specs", {
            {"phase_precision", 0.001},
            {"intensity_precision", 0.01},
            {"manufacturer", "Photonix Labs"},
            {"datasheet_url", "https://example.com/laser"}
        }}
    };
}

nlohmann::json LaserControllerDevice::read_measurement() {
    return {
        {"phase_rad", phase},
        {"intensity", intensity}
    };
}

void LaserControllerDevice::perform_action(const nlohmann::json& cmd) {
    if (cmd.contains("set_phase")) phase = cmd["set_phase"].get<double>();
    if (cmd.contains("set_intensity")) intensity = cmd["set_intensity"].get<double>();
}