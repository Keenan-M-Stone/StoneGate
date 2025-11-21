#include <iostream>
#include <cassert>
#include "simulator/Simulator.hpp"
#include <filesystem>
#include <fstream>
#include "DeviceRegistry.hpp"
#include <nlohmann/json.hpp>

using nlohmann::json;

int main() {
    std::cout << "Simulator CI-less tests starting...\n";
    try {
        DeviceRegistry registry;
        Simulator sim(42);
        // write a minimal device graph to temp
        json graph = {
            {"nodes", json::array({ { {"id","s1"}, {"type","Thermocouple"}, {"part","Thermocouple_v1"} } })},
            {"edges", json::array()}
        };
        auto p = std::filesystem::temp_directory_path() / "sim_graph_test.json";
        std::ofstream f(p);
        f << graph.dump(2);
        f.close();
        bool ok = sim.load_from_graph(p.string(), registry);
        if (!ok) { std::cerr << "Simulator failed to load graph\n"; return 2; }
        auto desc = registry.get_descriptor_graph();
        if (desc.empty()) { std::cerr << "Registry descriptors empty after simulator load\n"; return 3; }

        auto updates = registry.poll_all();
        if (updates.empty()) { std::cerr << "Registry poll_all returned empty\n"; return 4; }

        std::cout << "Simulator CI-less tests passed\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "exception: " << e.what() << std::endl;
        return 1;
    }
}
