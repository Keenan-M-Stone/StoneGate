#include "devices/QECModuleDevice.hpp"

QECModuleDevice::QECModuleDevice(std::string id)
: dev_id(id), code_type("surface"), syndrome(0), correction_applied(false) {}

std::string QECModuleDevice::id() const { return dev_id; }
std::string QECModuleDevice::type() const { return "qec_module"; }

nlohmann::json QECModuleDevice::descriptor() const {
    return {
        {"id", dev_id},
        {"type", "qec_module"},
        {"code_type", code_type},
        {"status", "ok"},
        {"specs", {
             {"max_sampling_rate_hz", 10.0},
             {"manufacturer", "Stone Labs: BlackBox Division"},
             {"datasheet_url", "https://example.com/qec_module"}
        }},
        {"metrics", {
            {"syndrome", { {"kind", "integer"} }},
            {"correction_applied", { {"kind", "boolean"} }}
        }}
    };
}

nlohmann::json QECModuleDevice::read_measurement() {
    return {
        {"syndrome", syndrome},
        {"correction_applied", correction_applied}
    };
}

void QECModuleDevice::perform_action(const nlohmann::json& cmd) {
    if (cmd.contains("extract_syndrome")) syndrome = cmd["extract_syndrome"].get<int>();
    if (cmd.contains("apply_correction")) correction_applied = cmd["apply_correction"].get<bool>();
    if (cmd.contains("set_code_type")) code_type = cmd["set_code_type"].get<std::string>();
}
