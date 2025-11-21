#include <iostream>
#include "DeviceRegistry.hpp"
#include "simulator/Simulator.hpp"
#include <cstdlib>

int main(int argc, char** argv) {
    std::string graph = "../shared/protocol/DeviceGraph.json";
    uint64_t seed = 0;
    for (int i = 1; i < argc; ++i) {
        std::string s(argv[i]);
        if (s == "--graph" && i + 1 < argc) { graph = argv[++i]; }
        if (s == "--seed" && i + 1 < argc) { seed = std::stoull(argv[++i]); }
    }

    DeviceRegistry registry;
    Simulator sim(seed);
    if (!sim.load_from_graph(graph, registry)) {
        std::cerr << "Failed to load graph: " << graph << std::endl;
        return 2;
    }

    // Demonstrate physics coupling: add a temporary LN2 controller node, connect it to first device, and set flow
    auto desc = registry.get_descriptor_graph();
    if (!desc.empty()) {
        std::string target = desc[0].value("id", "");
        if (!target.empty()) {
            nlohmann::json controllerNode = { {"id", "test_ln2"}, {"type", "LN2CoolingController"} };
            nlohmann::json partSpec = { {"type", "LN2CoolingController"}, {"specs", { {"setpoint_default", 77.0}, {"max_flow", 10.0}, {"thermal_conductance", 0.1} } } };
            sim.physics()->register_node("test_ln2", controllerNode, partSpec);
            sim.physics()->register_edge("test_ln2", target);
            sim.physics()->update_controller_state("test_ln2", nlohmann::json::object({{"flow_rate_Lmin", 5.0}}));
        }
    }

    // Print descriptor graph
    std::cout << registry.get_descriptor_graph().dump(2) << std::endl;

    // Print a single poll for predictable measurements
    std::cout << registry.poll_all().dump(2) << std::endl;

    return 0;
}
