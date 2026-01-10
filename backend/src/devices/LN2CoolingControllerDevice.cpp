#include "devices/LN2CoolingControllerDevice.hpp"
#include "core/PhysicsEngine.hpp"

LN2CoolingControllerDevice::LN2CoolingControllerDevice(std::string id, PhysicsEngine* physics)
: dev_id(id), setpoint_K(77.0), flow_rate(0.0), rng(std::random_device{}()), physics(physics) {}

std::string LN2CoolingControllerDevice::id() const { return dev_id; }
std::string LN2CoolingControllerDevice::type() const { return "ln2_cooling_controller"; }

nlohmann::json LN2CoolingControllerDevice::descriptor() const {
    return {
        {"id", dev_id},
        {"type", "ln2_cooling_controller"},
        {"status", "ok"},
        {"specs", {
            {"setpoint_range_K", {60, 300}},
            {"max_flow_rate", 10.0},
            {"max_sampling_rate_hz", 5.0},
            {"manufacturer", "Stone Labs: CryoTech division"},
            {"datasheet_url", "https://example.com/ln2controller"}
        }},
        {"metrics", {
            {"temperature_K", {
                {"kind", "number"},
                {"unit", "K"},
                {"backend_unit", "K"},
                {"precision", 0.1},
                {"min", 0.0},
                {"max", 500.0}
            }},
            {"flow_rate_Lmin", {
                {"kind", "number"},
                {"unit", "L/min"},
                {"backend_unit", "L/min"},
                {"precision", 0.1},
                {"min", 0.0},
                {"max", 10.0}
            }}
        }}
    };
}

nlohmann::json LN2CoolingControllerDevice::read_measurement() {
    double temp = setpoint_K + std::normal_distribution<double>(0, 0.2)(rng);
    double flow = flow_rate + std::normal_distribution<double>(0, 0.05)(rng);
    // update physics engine controller state if available
    if (physics) {
        try {
            nlohmann::json st = nlohmann::json::object();
            st["flow_rate_Lmin"] = flow;
            st["setpoint_K"] = setpoint_K;
            physics->update_controller_state(dev_id, st);
        } catch(...){}
    }
    return {
        {"temperature_K", temp},
        {"flow_rate_Lmin", flow}
    };
}

void LN2CoolingControllerDevice::perform_action(const nlohmann::json& cmd) {
    if (cmd.contains("set_setpoint")) setpoint_K = cmd["set_setpoint"].get<double>();
    if (cmd.contains("set_flow_rate")) flow_rate = cmd["set_flow_rate"].get<double>();
    // reflect in physics engine immediately
    if (physics) {
        try {
            nlohmann::json st = nlohmann::json::object();
            st["flow_rate_Lmin"] = flow_rate;
            st["setpoint_K"] = setpoint_K;
            physics->update_controller_state(dev_id, st);
        } catch(...){}
    }
}
