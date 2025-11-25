#include "simulator/Simulator.hpp"
#include "DeviceRegistry.hpp"
#include "simulator/SimulatedDevice.hpp"
#include "devices/ThermocoupleDevice.hpp"
#include "devices/LN2CoolingControllerDevice.hpp"
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>
#include <filesystem>
#include <chrono>

using nlohmann::json;
using namespace std;

Simulator::Simulator(uint64_t seed)
: seed_(seed) {}

bool Simulator::load_from_graph(const std::string& deviceGraphPath, DeviceRegistry& registry) {
    try {
        std::ifstream f(deviceGraphPath);
        if (!f) {
            std::cerr << "Simulator: unable to open device graph: " << deviceGraphPath << std::endl;
            return false;
        }
        json graph = json::parse(f);

        // derive schema path: same folder
        std::filesystem::path p(deviceGraphPath);
        auto schema_path = p.parent_path() / "ComponentSchema.json";
        json schema;
        if (std::filesystem::exists(schema_path)) {
            std::ifstream sf(schema_path);
            if (sf) schema = json::parse(sf);
        }

        auto nodes = graph.contains("nodes") ? graph["nodes"] : json::array();
        // Setup physics engine and load parts library
        auto parts_path = p.parent_path() / "PartsLibrary.json";
        phys_.load_parts_library(parts_path.string());
        // load device overrides if present
        auto overrides_path = p.parent_path() / "device_overrides.json";
        if (std::filesystem::exists(overrides_path)) {
            phys_.load_device_overrides(overrides_path.string());
        }
        // start physics background update loop (cached state)
        phys_.start_background_loop(std::chrono::milliseconds(200));
        // also parse parts locally for selection logic
        json parts = json::object();
        if (std::filesystem::exists(parts_path)) {
            std::ifstream pf(parts_path);
            if (pf) parts = json::parse(pf);
        }

        for (const auto& n : nodes) {
            std::string id = n.value("id", "sim_dev");
            std::string type = n.value("type", "SimDevice");
            std::vector<std::string> props;
            if (schema.contains(type) && schema[type].contains("properties")) {
                for (const auto& p : schema[type]["properties"]) props.push_back(p.get<std::string>());
            }
            // determine part spec (optional override in graph)
            json partSpec = json::object();
            if (n.contains("part")) {
                std::string partName = n["part"].get<std::string>();
                if (parts.contains(partName)) partSpec = parts[partName];
            } else {
                // try default part by type
                for (auto it = parts.begin(); it != parts.end(); ++it) {
                    if (it.value().contains("type") && it.value()["type"] == type) { partSpec = it.value(); break; }
                }
            }

            // register in physics engine
            phys_.register_node(id, n, partSpec);

            // create simulated device with provided seed (or 0) and physics hook
            uint64_t device_seed = seed_ ? seed_ + std::hash<std::string>{}(id) : 0;
            // If concrete backend device classes exist for this type, instantiate them so they can
            // integrate with the PhysicsEngine (e.g., LN2 controller and Thermocouple).
            if (type == "Thermocouple") {
                auto dev = std::make_shared<ThermocoupleDevice>(id, &phys_);
                registry.register_device(dev);
            } else if (type == "LN2CoolingController" || type == "LN2CoolingControllerDevice" || type == "ln2_cooling_controller") {
                auto dev = std::make_shared<LN2CoolingControllerDevice>(id, &phys_);
                registry.register_device(dev);
            } else {
                auto dev = std::make_shared<SimulatedDevice>(id, type, props, device_seed, &phys_);
                registry.register_device(dev);
            }
        }

        // register edges
        if (graph.contains("edges")) {
            for (const auto& e : graph["edges"]) {
                std::string from = e.value("from", "");
                std::string to = e.value("to", "");
                if (!from.empty() && !to.empty()) phys_.register_edge(from, to);
            }
        }
        // compute an initial physics step and update controller states
        auto phys_state = phys_.compute_step();
        // push controller states into engine (if any)
        // for now we rely on SimulatedDevice to read phys_state when generating measurements
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Simulator load error: " << e.what() << std::endl;
        return false;
    }
}
