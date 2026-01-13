#include "devices/PulseSequencerDevice.hpp"

PulseSequencerDevice::PulseSequencerDevice(std::string id)
: dev_id(id), sequence_loaded(""), current_step(0), running(false) {}

std::string PulseSequencerDevice::id() const { return dev_id; }
std::string PulseSequencerDevice::type() const { return "pulse_sequencer"; }

nlohmann::json PulseSequencerDevice::descriptor() const {
    return {
        {"id", dev_id},
        {"type", "pulse_sequencer"},
        {"status", running ? "running" : "idle"},
        {"sequence_loaded", sequence_loaded},
        {"specs", {
            {"max_sampling_rate_hz", 10.0},
            {"manufacturer", "Stone Labs: Photonix Division"},
            {"datasheet_url", "https://example.com/pulse_sequencer"}
        }},
        {"metrics", {
            {"current_step", { {"kind", "integer"}, {"unit", "step"}, {"backend_unit", "step"}, {"min", 0.0} }},
            {"running", { {"kind", "boolean"} }}
        }},
    };
}

nlohmann::json PulseSequencerDevice::read_measurement() {
    return {
        {"current_step", current_step},
        {"running", running}
    };
}

void PulseSequencerDevice::perform_action(const nlohmann::json& cmd) {
    if (cmd.contains("load_sequence")) sequence_loaded = cmd["load_sequence"].get<std::string>();
    if (cmd.contains("start")) running = true;
    if (cmd.contains("stop")) running = false;
    if (cmd.contains("step")) ++current_step;
}
