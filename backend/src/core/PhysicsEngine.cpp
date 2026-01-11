#include "core/PhysicsEngine.hpp"
#include <fstream>
#include <iostream>
#include <cmath>
#include <filesystem>
#include <thread>
#include <mutex>
#include <functional>

using nlohmann::json;
using namespace std;

static void deep_merge_json(json& dest, const json& src) {
    if (!src.is_object() || !dest.is_object()) {
        dest = src;
        return;
    }
    for (auto it = src.begin(); it != src.end(); ++it) {
        const std::string key = it.key();
        if (dest.contains(key) && dest[key].is_object() && it.value().is_object()) {
            deep_merge_json(dest[key], it.value());
        } else {
            dest[key] = it.value();
        }
    }
}

PhysicsEngine::PhysicsEngine() {
    // initialize to a well-defined min time to avoid uninitialized comparisons
    overridesLastWrite = std::filesystem::file_time_type::min();
    runtimeOverrides = json::object();
}

PhysicsEngine::~PhysicsEngine() {
    stop_background_loop();
}

bool PhysicsEngine::load_parts_library(const std::string& path) {
    try {
        std::ifstream f(path);
        if (!f) return false;
        partsLib = json::parse(f);
        // also attempt to load user parts and merge them in (user parts override defaults)
        try {
            std::filesystem::path p(path);
            auto user_path = p.parent_path() / "user_parts.json";
            if (std::filesystem::exists(user_path)) {
                std::ifstream uf(user_path);
                if (uf) {
                    json user = json::parse(uf);
                    for (auto it = user.begin(); it != user.end(); ++it) partsLib[it.key()] = it.value();
                }
            }
        } catch (...) {
            // ignore user parts load failures
        }
        return true;
    } catch (...) {
        return false;
    }
}

bool PhysicsEngine::load_device_overrides(const std::string& path) {
    try {
        std::ifstream f(path);
        if (!f) return false;
        deviceOverrides = json::parse(f);
        overridesPath = path;
        // refresh cache with new overrides
        compute_and_cache();
        return true;
    } catch (...) {
        return false;
    }
}

bool PhysicsEngine::reload_overrides() {
    if (overridesPath.empty()) return false;
    return load_device_overrides(overridesPath);
}

void PhysicsEngine::register_node(const std::string& id, const json& node, const json& partSpec) {
    nodes[id] = { node, partSpec };
}

void PhysicsEngine::register_edge(const std::string& from, const std::string& to) {
    edges.emplace_back(from,to);
}

void PhysicsEngine::update_controller_state(const std::string& id, const json& state) {
    controllerStates[id] = state;
}

// compute properties and return them (one-off)
json PhysicsEngine::compute_step() {
    // Return a computed snapshot without mutating state.
    // Temperature/pressure dynamics are advanced in compute_and_cache().
    double T_K = 295.0;
    double P_kPa = 101.3;
    double ambient_lux = 30.0;
    double vibration_rms = 0.001;
    {
        std::lock_guard<std::mutex> lk(envMutex);
        T_K = env_temperature_K;
        P_kPa = env_pressure_kPa;
        ambient_lux = env_ambient_lux;
        vibration_rms = env_vibration_rms;
    }

    // Refractive index of air (toy, but grounded): (n-1) ∝ P/T.
    const double P0 = 101.3;
    const double T0 = 293.15;
    const double n0 = 1.00027;
    const double K = (n0 - 1.0) * (T0 / P0);
    const double n_air = 1.0 + K * (P_kPa / std::max(1.0, T_K));

    json result = json::object();
    // Snapshot runtime overrides once per compute to keep a consistent view.
    json runtime = json::object();
    {
        std::lock_guard<std::mutex> lk(runtimeOverridesMutex);
        runtime = runtimeOverrides;
    }

    for (const auto& [id, info] : nodes) {
        // start from partSpec then deep-merge deviceOverrides for this id (if any)
        json spec = info.partSpec;
        if (deviceOverrides.contains(id)) {
            deep_merge_json(spec, deviceOverrides[id]);
        }
        // runtime overrides are layered on top
        if (runtime.contains(id)) {
            deep_merge_json(spec, runtime[id]);
        }

        double noise_coeff = 0.01;
        if (spec.contains("specs") && spec["specs"].contains("noise_coeff")) {
            try { noise_coeff = spec["specs"]["noise_coeff"].get<double>(); } catch(...){}
        }

        const std::string type = info.node.value("type", std::string{});

        json node_out = json::object();
        node_out["temperature_K"] = T_K;
        node_out["pressure_kPa"] = P_kPa;
        node_out["refractive_index"] = n_air;
        node_out["noise_coeff"] = noise_coeff;

        if (type == "PressureSensor") {
            node_out["pressure_kPa"] = P_kPa;
        }
        if (type == "AmbientLightSensor") {
            node_out["ambient_lux"] = ambient_lux;
        }
        if (type == "VibrationSensor") {
            node_out["vibration_rms"] = vibration_rms;
        }

        // Laser / PhaseModulator controls are taken from controllerStates when present.
        double laser_power = 12.0;
        double pm_phase = 0.0;
        {
            auto it = controllerStates.find("laser0");
            if (it != controllerStates.end()) {
                const auto& st = it->second;
                if (st.contains("optical_power")) { try { laser_power = st.at("optical_power").get<double>(); } catch(...){} }
                if (st.contains("power")) { try { laser_power = st.at("power").get<double>(); } catch(...){} }
            }
            auto itp = controllerStates.find("pm0");
            if (itp != controllerStates.end()) {
                const auto& st = itp->second;
                if (st.contains("phase")) { try { pm_phase = st.at("phase").get<double>(); } catch(...){} }
                if (st.contains("phase_rad")) { try { pm_phase = st.at("phase_rad").get<double>(); } catch(...){} }
            }
        }

        // Apply refractive-index induced phase offset + vibration-induced jitter.
        const double beta_n = 2.0e3; // rad per (n-1) delta; scaled for visibility
        const double gamma_v = 50.0; // rad per vibration rms
        const double phase_actual = pm_phase + beta_n * (n_air - n0) + gamma_v * vibration_rms;

        if (type == "Laser") {
            // Temperature slightly reduces available power in this toy model.
            const double temp_factor = std::max(0.2, 1.0 - 0.0015 * std::max(0.0, T_K - 77.0));
            node_out["optical_power"] = laser_power * temp_factor;
        }
        if (type == "PhaseModulator") {
            node_out["phase"] = phase_actual;
        }

        if (type == "PhotonicDetector") {
            // Simple interferometric model:
            // counts ~ gain * power * (1 + cos(phase))/2 + ambient term.
            const double gain = 90.0;
            const double vis = 0.95;
            const double interference = 0.5 * (1.0 + vis * std::cos(phase_actual));
            const double ambient_counts = 0.8 * ambient_lux;
            const double counts = std::max(0.0, gain * std::max(0.0, laser_power) * interference + ambient_counts);

            const double dark_base = 0.02;
            const double dark = std::max(0.0, dark_base * (1.0 + ambient_lux / 200.0) * (1.0 + 5.0 * vibration_rms));

            node_out["counts"] = counts;
            node_out["dark_rate"] = dark;
            node_out["temperature"] = T_K; // schema uses "temperature" for detector
        }

        auto is_qec_related = [&](const std::string& t) {
            return t == "QECModule" || t == "SyndromeStream" || t == "SurfaceCodeController" || t == "LatticeSurgeryController" ||
                   t == "LeakageResetController" || t == "NoiseSpectrometer" || t == "ReadoutCalibrator" || t == "FaultInjector";
        };
        if (is_qec_related(type)) {
            // Backend-owned noise model for QEC: depends on temperature, pressure, and vibration.
            const double base_p = 0.01;
            const double aT = 0.0035; // per K above 77
            const double aP = 0.06;   // per fractional pressure deviation
            const double aV = 10.0;   // per vibration rms
            const double fracP = (P_kPa - P0) / P0;
            double p = base_p + aT * std::max(0.0, (T_K - 77.0)) + aP * std::abs(fracP) + aV * vibration_rms;
            p = std::max(0.0, std::min(0.35, p));
            node_out["p_flip"] = p;
        }

        result[id] = node_out;
    }

    return result;
}

bool PhysicsEngine::set_env_state(const json& env_patch) {
    if (!env_patch.is_object()) return false;
    bool any = false;
    {
        std::lock_guard<std::mutex> lk(envMutex);
        if (env_patch.contains("temperature_K") && env_patch["temperature_K"].is_number()) {
            env_temperature_K = clamp(env_patch["temperature_K"].get<double>(), 50.0, 350.0);
            any = true;
        }
        if (env_patch.contains("pressure_kPa") && env_patch["pressure_kPa"].is_number()) {
            env_pressure_kPa = clamp(env_patch["pressure_kPa"].get<double>(), 10.0, 200.0);
            any = true;
        }
        if (env_patch.contains("ambient_lux") && env_patch["ambient_lux"].is_number()) {
            env_ambient_lux = clamp(env_patch["ambient_lux"].get<double>(), 0.0, 10000.0);
            any = true;
        }
        if (env_patch.contains("vibration_rms") && env_patch["vibration_rms"].is_number()) {
            env_vibration_rms = clamp(env_patch["vibration_rms"].get<double>(), 0.0, 0.05);
            any = true;
        }
    }
    if (any) compute_and_cache();
    return any;
}

bool PhysicsEngine::apply_runtime_override(const std::string& device_id, const json& override_patch) {
    if (device_id.empty()) return false;
    if (!override_patch.is_object()) return false;
    {
        std::lock_guard<std::mutex> lk(runtimeOverridesMutex);
        if (!runtimeOverrides.is_object()) runtimeOverrides = json::object();
        if (!runtimeOverrides.contains(device_id) || !runtimeOverrides[device_id].is_object()) {
            runtimeOverrides[device_id] = json::object();
        }
        deep_merge_json(runtimeOverrides[device_id], override_patch);
    }
    compute_and_cache();
    return true;
}

bool PhysicsEngine::clear_runtime_overrides() {
    {
        std::lock_guard<std::mutex> lk(runtimeOverridesMutex);
        runtimeOverrides = json::object();
    }
    compute_and_cache();
    return true;
}

bool PhysicsEngine::clear_runtime_override(const std::string& device_id) {
    if (device_id.empty()) return false;
    bool any = false;
    {
        std::lock_guard<std::mutex> lk(runtimeOverridesMutex);
        if (runtimeOverrides.is_object() && runtimeOverrides.contains(device_id)) {
            runtimeOverrides.erase(device_id);
            any = true;
        }
    }
    if (any) compute_and_cache();
    return any;
}

json PhysicsEngine::get_runtime_overrides_snapshot() {
    std::lock_guard<std::mutex> lk(runtimeOverridesMutex);
    return runtimeOverrides;
}

double PhysicsEngine::clamp(double v, double lo, double hi) {
    return std::max(lo, std::min(hi, v));
}

void PhysicsEngine::advance_dynamics(double dt_s) {
    if (dt_s <= 0.0) return;

    // Read LN2 controller state if present.
    double ln2_flow = 0.0;
    double ln2_setpoint = 77.0;
    {
        auto it = controllerStates.find("ln2");
        if (it != controllerStates.end()) {
            const auto& st = it->second;
            if (st.contains("flow_rate_Lmin")) { try { ln2_flow = st.at("flow_rate_Lmin").get<double>(); } catch(...){} }
            if (st.contains("setpoint_K")) { try { ln2_setpoint = st.at("setpoint_K").get<double>(); } catch(...){} }
        }
    }

    // Read pressure controller state (if present).
    double P_set = 101.3;
    bool sealed = true;
    bool pump_enabled = true;
    double tau_pressure = 8.0;
    double leak_rate = 0.0002;
    {
        auto it = controllerStates.find("press_ctrl0");
        if (it != controllerStates.end()) {
            const auto& st = it->second;
            if (st.contains("pressure_setpoint_kPa")) { try { P_set = st.at("pressure_setpoint_kPa").get<double>(); } catch(...){} }
            if (st.contains("pressure_kPa")) { try { P_set = st.at("pressure_kPa").get<double>(); } catch(...){} }
            if (st.contains("sealed")) { try { sealed = st.at("sealed").get<bool>(); } catch(...){} }
            if (st.contains("pump_enabled")) { try { pump_enabled = st.at("pump_enabled").get<bool>(); } catch(...){} }
        }
    }

    // Pull controller specs if present.
    if (nodes.contains("press_ctrl0")) {
        const auto& spec = nodes.at("press_ctrl0").partSpec;
        if (spec.contains("specs")) {
            const auto& s = spec["specs"];
            if (s.contains("pressure_setpoint_default_kPa")) {
                try {
                    // Only apply if user hasn't set a controller state yet.
                    if (!controllerStates.contains("press_ctrl0") || !controllerStates["press_ctrl0"].is_object() || !controllerStates["press_ctrl0"].contains("pressure_setpoint_kPa")) {
                        P_set = s.at("pressure_setpoint_default_kPa").get<double>();
                    }
                } catch (...) {
                }
            }
            if (s.contains("tau_pressure_s")) { try { tau_pressure = s.at("tau_pressure_s").get<double>(); } catch(...){} }
            if (s.contains("leak_rate_per_s")) { try { leak_rate = s.at("leak_rate_per_s").get<double>(); } catch(...){} }
        }
    }

    // Environment evolution.
    const double P_atm = 101.3;
    const double T_env = 295.0;
    const double T_ln2 = clamp(ln2_setpoint, 60.0, 300.0);

    std::lock_guard<std::mutex> lk(envMutex);

    // Pressure dynamics.
    if (!sealed) {
        const double tau_vent = 1.5;
        env_pressure_kPa += (P_atm - env_pressure_kPa) * (dt_s / std::max(0.1, tau_vent));
    } else {
        const double leak_term = -leak_rate * (env_pressure_kPa - P_atm);
        double pump_term = 0.0;
        if (pump_enabled) pump_term = (P_set - env_pressure_kPa) * (dt_s / std::max(0.5, tau_pressure));
        env_pressure_kPa += pump_term + leak_term * dt_s;
    }
    env_pressure_kPa = clamp(env_pressure_kPa, 10.0, 200.0);

    // Cooling efficiency depends on pressure.
    const double eff = std::pow(clamp(env_pressure_kPa / P_atm, 0.2, 2.0), 0.35);

    // Temperature dynamics.
    const double tau_warm = 400.0;
    const double k_flow = 0.015;
    const double dT_warm = (T_env - env_temperature_K) * (dt_s / std::max(1.0, tau_warm));
    const double dT_cool = eff * k_flow * clamp(ln2_flow, 0.0, 10.0) * (T_ln2 - env_temperature_K) * dt_s;
    env_temperature_K += dT_warm + dT_cool;
    env_temperature_K = clamp(env_temperature_K, 50.0, 350.0);

    // Ambient + vibration.
    double amb_base = 30.0;
    if (nodes.contains("amb0")) {
        const auto& spec = nodes.at("amb0").partSpec;
        if (spec.contains("specs") && spec["specs"].contains("ambient_lux_default")) {
            try { amb_base = spec["specs"]["ambient_lux_default"].get<double>(); } catch(...){}
        }
    }
    env_ambient_lux = clamp(amb_base, 0.0, 10000.0);

    double vib_base = 0.001;
    if (nodes.contains("vib0")) {
        try {
            const auto& spec = nodes.at("vib0").partSpec;
            if (spec.contains("specs") && spec["specs"].contains("vibration_rms_default")) {
                vib_base = spec["specs"]["vibration_rms_default"].get<double>();
            }
        } catch (...) {
        }
    }
    const double pump_vib = pump_enabled ? 0.0015 : 0.0003;
    env_vibration_rms = clamp(vib_base + pump_vib + 0.0005 * std::abs(P_set - env_pressure_kPa) / 50.0, 0.0, 0.05);
}

// internal compute and update cachedState
void PhysicsEngine::compute_and_cache() {
    // Advance dynamics using wall-clock dt.
    const auto now = std::chrono::steady_clock::now();
    double dt_s = 0.0;
    if (lastStep != std::chrono::steady_clock::time_point::min()) {
        dt_s = std::chrono::duration<double>(now - lastStep).count();
    }
    lastStep = now;
    if (dt_s > 0.0) advance_dynamics(dt_s);

    json computed = compute_step();
    std::lock_guard<std::mutex> lk(cacheMutex);
    cachedState = computed;
}

void PhysicsEngine::start_background_loop(std::chrono::milliseconds interval_) {
    interval = interval_;
    if (running.load()) return;
    running.store(true);
    // initialize overridesLastWrite if possible
    try {
        if (!overridesPath.empty()) {
            std::filesystem::path op(overridesPath);
            if (std::filesystem::exists(op)) {
                overridesLastWrite = std::filesystem::last_write_time(op);
            }
        }
    } catch(...) {}

    worker = std::thread([this]() {
        while (running.load()) {
            try {
                // check overrides file mtime and reload if changed
                if (!overridesPath.empty()) {
                    try {
                        std::filesystem::path op(overridesPath);
                        if (std::filesystem::exists(op)) {
                            auto now = std::filesystem::last_write_time(op);
                            if (now != overridesLastWrite) {
                                // reload overrides and update tracked time
                                load_device_overrides(overridesPath);
                                overridesLastWrite = now;
                            }
                        }
                    } catch(...) {}
                }
                compute_and_cache();
            } catch(...) {}
            std::this_thread::sleep_for(interval);
        }
    });
}

void PhysicsEngine::stop_background_loop() {
    if (!running.load()) return;
    running.store(false);
    try {
        if (worker.joinable()) worker.join();
    } catch(...) {}
}

json PhysicsEngine::get_cached_step() {
    std::lock_guard<std::mutex> lk(cacheMutex);
    return cachedState;
}

json PhysicsEngine::get_env_state() {
    std::lock_guard<std::mutex> lk(envMutex);
    return json{
        {"temperature_K", env_temperature_K},
        {"pressure_kPa", env_pressure_kPa},
        {"ambient_lux", env_ambient_lux},
        {"vibration_rms", env_vibration_rms}
    };
}
