#include "core/PhysicsEngine.hpp"
#include <fstream>
#include <iostream>
#include <cmath>
#include <filesystem>
#include <thread>
#include <mutex>
#include <functional>

using nlohmann::json;

PhysicsEngine::PhysicsEngine() {
    // initialize to a well-defined min time to avoid uninitialized comparisons
    overridesLastWrite = std::filesystem::file_time_type::min();
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
    // re-use compute_and_cache logic but return fresh compute
    // find LN2 controllers and their flows
    std::unordered_map<std::string,double> ln2_flow;
    for (const auto& [id, st] : controllerStates) {
        if (st.contains("flow_rate_Lmin")) {
            try { ln2_flow[id] = st.at("flow_rate_Lmin").get<double>(); } catch(...){}
        }
    }

    json result = json::object();
    // helper: deep merge src -> dest
    std::function<void(json&, const json&)> deep_merge = [&](json& dest, const json& src) {
        if (!src.is_object() || !dest.is_object()) {
            dest = src;
            return;
        }
        for (auto it = src.begin(); it != src.end(); ++it) {
            const std::string key = it.key();
            if (dest.contains(key) && dest[key].is_object() && it.value().is_object()) {
                deep_merge(dest[key], it.value());
            } else {
                dest[key] = it.value();
            }
        }
    };

    for (const auto& [id, info] : nodes) {
        // start from partSpec then deep-merge deviceOverrides for this id (if any)
        json spec = info.partSpec;
        if (deviceOverrides.contains(id)) {
            deep_merge(spec, deviceOverrides[id]);
        }

        double tempK = 300.0; // fallback
        if (spec.contains("specs") && spec["specs"].contains("setpoint_default")) {
            try { tempK = spec["specs"]["setpoint_default"].get<double>(); } catch(...){}
        }

        double delta = 0.0;
        for (const auto& e : edges) {
            if (e.first == id && ln2_flow.count(e.second)) delta -= 0.5 * ln2_flow[e.second];
            if (e.second == id && ln2_flow.count(e.first)) delta -= 0.5 * ln2_flow[e.first];
        }

        double computed = std::max(1.0, tempK + delta);

        double noise_coeff = 0.01;
        if (spec.contains("specs") && spec["specs"].contains("noise_coeff")) {
            try { noise_coeff = spec["specs"]["noise_coeff"].get<double>(); } catch(...){}
        }

        result[id] = {
            {"temperature_K", computed},
            {"noise_coeff", noise_coeff}
        };
    }

    return result;
}

// internal compute and update cachedState
void PhysicsEngine::compute_and_cache() {
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
