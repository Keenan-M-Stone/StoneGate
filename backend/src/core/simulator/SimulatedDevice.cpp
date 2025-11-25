#include "simulator/SimulatedDevice.hpp"
#include "core/PhysicsEngine.hpp"
#include <chrono>
#include <random>

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
    return j;
}


static double sample_normal(std::mt19937_64& rng, double mean = 1.0, double rel = 0.05) {
    std::normal_distribution<double> d(mean, std::abs(mean) * rel);
    return d(rng);
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
        double val = sample_normal(rng, 1.0, 0.05);
        // Custom logic for common property names and controllers
        if (key == "counts") val = std::round(sample_normal(rng, 1000, 0.1));
        if (key == "dark_rate") val = sample_normal(rng, 0.02, 0.3);
        if (key == "temperature") val = sample_normal(rng, 4.2, 0.01);
        if (key == "temperature_K") val = sample_normal(rng, 77.0, 0.2);
        if (key == "flow_rate_Lmin") val = sample_normal(rng, 2.0, 0.2);
        if (key == "optical_power") val = sample_normal(rng, 12.0, 0.02);
        if (key == "phase") val = sample_normal(rng, 0.25, 0.02);
        if (key == "state") val = std::round(sample_normal(rng, 0.0, 1.0));
        if (key == "current_step") val = std::round(sample_normal(rng, 0, 1));
        if (key == "running") val = (sample_normal(rng, 0.5, 0.5) > 0.5) ? 1 : 0;
        if (key == "syndrome") val = std::round(sample_normal(rng, 0, 1));
        if (key == "correction_applied") val = (sample_normal(rng, 0.5, 0.5) > 0.5) ? 1 : 0;
        // If physics override exists, use that value
        if (!phys_state.is_null() && phys_state.contains(dev_id)) {
            auto nodePhys = phys_state[dev_id];
            if (nodePhys.contains(key)) {
                val = nodePhys[key].get<double>();
            }
            // special-case temperature aliases
            if (key.find("temp") != std::string::npos && nodePhys.contains("temperature_K")) {
                val = nodePhys["temperature_K"].get<double>();
            }
            // if physics provides noise_coeff, adjust uncertainty
            double noise_coeff = nodePhys.value("noise_coeff", 0.01);
            meas[key] = { {"value", val}, {"uncertainty", std::abs(val) * noise_coeff} };
        } else {
            meas[key] = { {"value", val}, {"uncertainty", std::abs(val) * 0.01} };
        }
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
    // Basic stub: accept 'zero' or 'reset' commands
    if (cmd.is_object()) {
        auto it = cmd.find("action");
        if (it != cmd.end()) {
            std::string a = (*it).get<std::string>();
            if (a == "zero" || a == "reset") {
                // no-op for stub; could modify internal state in future
            }
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

