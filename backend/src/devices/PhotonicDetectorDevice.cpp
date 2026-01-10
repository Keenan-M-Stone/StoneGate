#include "devices/PhotonicDetectorDevice.hpp"

PhotonicDetectorDevice::PhotonicDetectorDevice(std::string id)
: dev_id(id), dark_rate(0.02) {}

std::string PhotonicDetectorDevice::id() const { return dev_id; }
std::string PhotonicDetectorDevice::type() const { return "photonic_detector"; }

nlohmann::json PhotonicDetectorDevice::descriptor() const {
    return {
        {"id", dev_id},
        {"type", "photonic_detector"},
        {"status", "ok"},
        {"specs", {
            {"dark_rate", dark_rate},
            {"max_sampling_rate_hz", 50.0},
            {"manufacturer", "Stone Labs: Photonix Division"},
            {"datasheet_url", "https://example.com/detector"}
        }},
        {"metrics", {
            {"counts", {
                {"kind", "number"},
                {"unit", "counts"},
                {"backend_unit", "counts"},
                {"precision", 1.0},
                {"min", 0.0}
            }},
            {"dark_rate", {
                {"kind", "number"},
                {"unit", "cps"},
                {"backend_unit", "cps"},
                {"precision", 0.001},
                {"min", 0.0}
            }}
        }}
    };
}

nlohmann::json PhotonicDetectorDevice::read_measurement() {
    double counts = 1000.0 + std::normal_distribution<double>(0, 20)(rng);
    double dark = dark_rate + std::normal_distribution<double>(0, 0.005)(rng);
    return {
        {"counts", counts},
        {"dark_rate", dark}
    };
}

void PhotonicDetectorDevice::perform_action(const nlohmann::json& cmd) {
    if (cmd.contains("zero")) dark_rate = 0.0;
}
