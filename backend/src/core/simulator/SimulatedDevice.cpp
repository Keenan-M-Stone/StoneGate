#include "simulator/SimulatedDevice.hpp"
#include "core/PhysicsEngine.hpp"
#include <chrono>
#include <random>
#include <algorithm>

SimulatedDevice::SimulatedDevice(
    const std::string& id,
    const std::string& type, 
    const std::vector<std::string>& props, 
    uint64_t seed,
    PhysicsEngine* physics
): dev_id(id), dev_type(type), properties(props), physics(physics) {
    if (seed == 0) {
        rng.seed((unsigned)std::chrono::high_resolution_clock::now().time_since_epoch().count());
    } else {
        rng.seed(seed);
    }

    init_defaults();
}

std::string SimulatedDevice::id() const { return dev_id; }

std::string SimulatedDevice::type() const { return dev_type; }

nlohmann::json SimulatedDevice::descriptor() const {
    /**
     * To add a new simulated device type:
     * 1. Add its type and properties to shared/protocol/ComponentSchema.json.
     * 2. Add logic here if you want custom descriptor fields.
     * 3. Add measurement logic in read_measurement().
     */
    nlohmann::json j;
    j["id"] = dev_id;
    j["type"] = dev_type;
    j["simulated"] = true;
    j["properties"] = properties;

    // Provide a minimal metrics map so UI tooling (Macro Wizard) can offer fields.
    // This is intentionally generic; real device classes can provide richer metadata.
    nlohmann::json metrics = nlohmann::json::object();
    for (const auto& p : properties) {
        const std::string key = p;
        if (key == "state_vector" || key == "role") {
            metrics[key] = { {"kind", "string"} };
        } else if (key == "correction_applied") {
            metrics[key] = { {"kind", "boolean"} };
        } else {
            metrics[key] = { {"kind", "number"} };
        }
    }
    // QECModule helpers
    if (dev_type == "QECModule") {
        metrics["p_flip"] = { {"kind", "number"} };
        metrics["temperature_K"] = { {"kind", "number"} };
        metrics["pressure_kPa"] = { {"kind", "number"} };
        metrics["refractive_index"] = { {"kind", "number"} };
    }
    j["metrics"] = metrics;
    return j;
}


static double sample_normal(std::mt19937_64& rng, double mean = 1.0, double rel = 0.05) {
    std::normal_distribution<double> d(mean, std::abs(mean) * rel);
    return d(rng);
}

static double clamp01(double v) {
    return std::max(0.0, std::min(1.0, v));
}

double SimulatedDevice::get_temperature_K_fallback() const {
    // Try physics-derived temperature first.
    if (physics) {
        try {
            auto state = physics->get_cached_step();
            if (state.contains(dev_id) && state[dev_id].contains("temperature_K")) {
                return state[dev_id]["temperature_K"].get<double>();
            }
        } catch (...) {
        }
    }
    // Fallback to any existing state.
    auto it = numeric_state.find("temperature_K");
    if (it != numeric_state.end()) return it->second;
    return 77.0;
}

double SimulatedDevice::compute_p_flip(double temperature_K) const {
    // Toy-but-backend-owned noise model: warmer => higher flip probability.
    // Keep bounded so it remains stable for demos.
    const double t_ref = 77.0;
    const double base_p = 0.01;
    const double slope_per_K = 0.004;
    const double max_p = 0.35;
    const double p = base_p + slope_per_K * std::max(0.0, temperature_K - t_ref);
    return std::max(0.0, std::min(max_p, p));
}

void SimulatedDevice::init_defaults() {
    // Seed initial values so readings are stable until acted upon.
    for (const auto& p : properties) {
        const std::string key = p;
        if (key == "counts") numeric_state[key] = std::round(sample_normal(rng, 1000, 0.1));
        else if (key == "dark_rate") numeric_state[key] = sample_normal(rng, 0.02, 0.3);
        else if (key == "temperature") numeric_state[key] = sample_normal(rng, 4.2, 0.01);
        else if (key == "temperature_K") numeric_state[key] = sample_normal(rng, 77.0, 0.2);
        else if (key == "temperature_C") numeric_state[key] = sample_normal(rng, 27.0, 0.02);
        else if (key == "flow_rate_Lmin") numeric_state[key] = sample_normal(rng, 0.0, 0.5);
        else if (key == "optical_power") numeric_state[key] = sample_normal(rng, 12.0, 0.02);
        else if (key == "power") numeric_state[key] = sample_normal(rng, 12.0, 0.02);
        else if (key == "phase") numeric_state[key] = sample_normal(rng, 0.25, 0.02);
        else if (key == "state") int_state[key] = (sample_normal(rng, 0.5, 0.8) > 0.5) ? 1 : 0;
        else if (key == "current_step") int_state[key] = 0;
        else if (key == "running") bool_state[key] = false;
        else if (key == "syndrome") int_state[key] = 0;
        else if (key == "correction_applied") bool_state[key] = false;
        else if (key == "role") string_state[key] = "syndrome";
        else if (key == "state_vector") string_state[key] = "|00000>";
        else if (key == "pressure_kPa") numeric_state[key] = sample_normal(rng, 101.3, 0.01);
        else if (key == "pressure_setpoint_kPa") numeric_state[key] = 101.3;
        else if (key == "sealed") bool_state[key] = true;
        else if (key == "pump_enabled") bool_state[key] = true;
        else if (key == "ambient_lux") numeric_state[key] = sample_normal(rng, 30.0, 0.1);
        else if (key == "vibration_rms") numeric_state[key] = sample_normal(rng, 0.001, 0.2);
        else numeric_state[key] = sample_normal(rng, 1.0, 0.05);
    }

    if (dev_type == "QECModule") {
        int_state["logical_bit"] = 0;
        int_state["round"] = 0;
        string_state["code_type"] = "repetition";
    }
}

nlohmann::json SimulatedDevice::read_measurement() {
    /**
     * To add custom measurement logic for a new device type, extend this function.
     * By default, all properties get a random value.
     */
    nlohmann::json m;
    m["ts"] = (int64_t)std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    nlohmann::json meas = nlohmann::json::object();
    // consult physics engine (if present) for per-node computed values
    nlohmann::json phys_state = nlohmann::json::object();
    if (physics) {
        try { phys_state = physics->get_cached_step(); } catch (...) { phys_state = nlohmann::json::object(); }
    }

    for (const auto& p : properties) {
        std::string key = p;

        // Base value from internal state.
        bool is_bool = false;
        bool bool_val = false;
        bool is_int = false;
        int int_val = 0;
        bool is_string = false;
        std::string str_val;
        double val = 0.0;

        if (bool_state.count(key)) {
            is_bool = true;
            bool_val = bool_state[key];
            val = bool_val ? 1.0 : 0.0;
        } else if (int_state.count(key)) {
            is_int = true;
            int_val = int_state[key];
            val = (double)int_val;
        } else if (string_state.count(key)) {
            is_string = true;
            str_val = string_state[key];
        } else if (numeric_state.count(key)) {
            val = numeric_state[key];
        } else {
            val = sample_normal(rng, 1.0, 0.05);
        }

        // If physics override exists, use that value
        if (!phys_state.is_null() && phys_state.contains(dev_id)) {
            auto nodePhys = phys_state[dev_id];
            if (nodePhys.contains(key)) {
                val = nodePhys[key].get<double>();
            }
            // special-case temperature aliases
            if (nodePhys.contains("temperature_K")) {
                const double tK = nodePhys["temperature_K"].get<double>();
                if (key == "temperature_C") {
                    val = tK - 273.15;
                } else if (key == "temperature_K") {
                    val = tK;
                } else if (key.find("temp") != std::string::npos) {
                    // Generic fallback: treat as Kelvin unless an explicit unit is provided.
                    val = tK;
                }
            }
            // if physics provides noise_coeff, adjust uncertainty
            double noise_coeff = nodePhys.value("noise_coeff", 0.01);

            if (is_string) {
                meas[key] = { {"value", str_val}, {"uncertainty", 0.0} };
            } else if (is_bool) {
                meas[key] = { {"value", bool_val}, {"uncertainty", 0.0} };
            } else if (is_int) {
                meas[key] = { {"value", int_val}, {"uncertainty", 0.0} };
            } else {
                // add small read noise around the base value
                const double rel = std::max(0.0001, noise_coeff);
                const double noisy = sample_normal(rng, val, rel);
                meas[key] = { {"value", noisy}, {"uncertainty", std::abs(noisy) * rel} };
            }
        } else {
            if (is_string) {
                meas[key] = { {"value", str_val}, {"uncertainty", 0.0} };
            } else if (is_bool) {
                meas[key] = { {"value", bool_val}, {"uncertainty", 0.0} };
            } else if (is_int) {
                meas[key] = { {"value", int_val}, {"uncertainty", 0.0} };
            } else {
                const double rel = 0.01;
                const double noisy = sample_normal(rng, val, rel);
                meas[key] = { {"value", noisy}, {"uncertainty", std::abs(noisy) * rel} };
            }
        }
    }

    // Expose derived QEC quantities in sim mode.
    if (dev_type == "QECModule") {
        const double Tk = get_temperature_K_fallback();
        double pflip = compute_p_flip(Tk);
        double PkPa = 101.3;
        double n = 1.00027;
        if (physics) {
            try {
                auto state = physics->get_cached_step();
                if (state.contains(dev_id)) {
                    if (state[dev_id].contains("pressure_kPa")) PkPa = state[dev_id]["pressure_kPa"].get<double>();
                    if (state[dev_id].contains("refractive_index")) n = state[dev_id]["refractive_index"].get<double>();
                    if (state[dev_id].contains("p_flip")) pflip = state[dev_id]["p_flip"].get<double>();
                }
            } catch (...) {
            }
        }
        meas["temperature_K"] = { {"value", Tk}, {"uncertainty", 0.0} };
        meas["pressure_kPa"] = { {"value", PkPa}, {"uncertainty", 0.0} };
        meas["refractive_index"] = { {"value", n}, {"uncertainty", 0.0} };
        meas["p_flip"] = { {"value", pflip}, {"uncertainty", 0.0} };
    }
    // If no properties defined, provide a generic value
    if (properties.empty()) {
        meas["value"] = { {"value", sample_normal(rng, 1.0, 0.1)}, {"uncertainty", 0.1} };
    }
    m["measurements"] = meas;
    m["state"] = "nominal";
    return m;
}

void SimulatedDevice::perform_action(const nlohmann::json& cmd) {
    if (!cmd.is_object()) return;

    // Support explicit (non-set) interactive commands used by schema.
    try {
        if (cmd.contains("seal")) {
            bool_state["sealed"] = true;
        }
        if (cmd.contains("vent")) {
            bool_state["sealed"] = false;
        }
        if (cmd.contains("pump_enable")) {
            if (cmd["pump_enable"].is_boolean()) bool_state["pump_enabled"] = cmd["pump_enable"].get<bool>();
            else bool_state["pump_enabled"] = true;
        }
        if (cmd.contains("set_pressure_kPa")) {
            numeric_state["pressure_setpoint_kPa"] = cmd["set_pressure_kPa"].get<double>();
        }
    } catch (...) {
    }

    // Generic: apply set_* keys into state.
    for (auto it = cmd.begin(); it != cmd.end(); ++it) {
        const std::string k = it.key();
        const auto& v = it.value();
        if (k.rfind("set_", 0) == 0) {
            const std::string key = k.substr(4);
            try {
                if (v.is_boolean()) {
                    bool_state[key] = v.get<bool>();
                } else if (v.is_number_integer()) {
                    int_state[key] = v.get<int>();
                    numeric_state[key] = (double)int_state[key];
                } else if (v.is_number()) {
                    numeric_state[key] = v.get<double>();
                } else if (v.is_string()) {
                    string_state[key] = v.get<std::string>();
                }
            } catch (...) {
            }
            // Convenience aliases used by schema interactive names
            if (key == "power" && numeric_state.count("power")) {
                numeric_state["optical_power"] = numeric_state["power"];
            }
        }
    }

    // Common interactive commands
    if (cmd.contains("zero") || cmd.contains("reset")) {
        for (auto& kv : numeric_state) kv.second = 0.0;
        for (auto& kv : int_state) kv.second = 0;
        for (auto& kv : bool_state) kv.second = false;
    }

    // QECModule: simulate syndrome extraction + correction as hardware-like operations.
    if (dev_type == "QECModule") {
        if (cmd.contains("set_code_type") && cmd["set_code_type"].is_string()) {
            try { string_state["code_type"] = cmd["set_code_type"].get<std::string>(); } catch (...) {}
        }
        if (cmd.contains("apply_correction")) {
            try { bool_state["correction_applied"] = cmd["apply_correction"].get<bool>(); } catch (...) {}
        }
        if (cmd.contains("set_true_bit")) {
            try { int_state["logical_bit"] = cmd["set_true_bit"].get<int>() ? 1 : 0; } catch (...) {}
        }

        if (cmd.contains("extract_syndrome")) {
            // Determine base bit to measure. In real hardware this would come from the qubit register.
            int true_bit = int_state.count("logical_bit") ? (int_state["logical_bit"] ? 1 : 0) : 0;

            // Estimate temperature from physics (or fallback state) and derive noise.
            const double Tk = get_temperature_K_fallback();
            double pflip = compute_p_flip(Tk);
            if (physics) {
                try {
                    auto state = physics->get_cached_step();
                    if (state.contains(dev_id) && state[dev_id].contains("p_flip")) {
                        pflip = state[dev_id]["p_flip"].get<double>();
                    }
                } catch (...) {
                }
            }
            pflip = clamp01(pflip);

            // Sample a single syndrome bit (repetition-code style) with backend-owned noise.
            int measured = true_bit;
            std::uniform_real_distribution<double> u(0.0, 1.0);
            if (u(rng) < pflip) measured = 1 - measured;

            int_state["syndrome"] = measured;
            int_state["round"] = int_state.count("round") ? (int_state["round"] + 1) : 1;
            bool_state["correction_applied"] = false;
        }
    }

    // Feed relevant setpoints back into the physics engine so derived optics/noise respond.
    if (physics) {
        try {
            nlohmann::json st = nlohmann::json::object();
            if (dev_type == "Laser") {
                if (numeric_state.count("optical_power")) st["optical_power"] = numeric_state["optical_power"];
                if (numeric_state.count("power")) st["power"] = numeric_state["power"];
                if (bool_state.count("enabled")) st["enabled"] = bool_state["enabled"];
            }
            if (dev_type == "PhaseModulator") {
                if (numeric_state.count("phase")) st["phase"] = numeric_state["phase"];
                if (numeric_state.count("phase_rad")) st["phase_rad"] = numeric_state["phase_rad"];
            }
            if (dev_type == "PressureController") {
                if (numeric_state.count("pressure_setpoint_kPa")) st["pressure_setpoint_kPa"] = numeric_state["pressure_setpoint_kPa"];
                if (numeric_state.count("pressure_kPa")) st["pressure_kPa"] = numeric_state["pressure_kPa"];
                if (bool_state.count("sealed")) st["sealed"] = bool_state["sealed"];
                if (bool_state.count("pump_enabled")) st["pump_enabled"] = bool_state["pump_enabled"];
            }
            if (!st.empty()) physics->update_controller_state(dev_id, st);
        } catch (...) {
        }
    }
}

bool SimulatedDevice::trigger_reload_overrides() {
    if (!physics) return false;
    try {
        return physics->reload_overrides();
    } catch(...) { return false; }
}


double SimulatedDevice::noise_seed() {
    return sample_normal(rng, 0.0, 1.0);
}

