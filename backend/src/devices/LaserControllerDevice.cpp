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
            {"manufacturer", "Stone Labs: Photonix Division"},
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

void LaserControllerDevice::perform_action(Operation op, const nlohmann::json& args) {
    switch (op) {
        case Operation::SetPhase:
        {
            if (args.contains("phase")) phase = args["phase"].get<double>();
            else if (args.contains("value")) phase = args["value"].get<double>();
            break;
        }
        case Operation::SetIntensity:
        case Operation::SetPower:
        {
            if (args.contains("intensity")) intensity = args["intensity"].get<double>();
            else if (args.contains("power")) intensity = args["power"].get<double>();
            else if (args.contains("value")) intensity = args["value"].get<double>();
            break;
        }
        case Operation::Enable:
        case Operation::Disable:
        case Operation::Unknown:
        default:
            // not implemented for this device
            break;
    }
}