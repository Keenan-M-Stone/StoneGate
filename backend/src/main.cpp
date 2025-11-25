#include "WebSocketServer.hpp"
#include "DeviceRegistry.hpp"
#include "devices/ThermocoupleDevice.hpp"
#include "devices/LaserControllerDevice.hpp"
#include "devices/PhotonicDetectorDevice.hpp"
#include "devices/LN2CoolingControllerDevice.hpp"
#include "devices/AncillaQubitDevice.hpp"
#include "devices/QuantumRegisterDevice.hpp"
#include "devices/PulseSequencerDevice.hpp"
#include "devices/QECModuleDevice.hpp"
#include "simulator/SimulatedDevice.hpp"
#include "simulator/Simulator.hpp"
#include <iostream>
#include <cstdio>
#include <unistd.h>

static void print_usage(const char* prog) {
    std::cout << "Usage: " << prog << " [options]\n"
              << "Options:\n"
              << "  -h, --help        Show this help message and exit\n"
              << "  -s, --sim         Run in simulator mode (registers simulated devices)\n"
              << "  -p, --port PORT   Set listening TCP port (default 9001)\n"
              << std::flush;
}

int main(int argc, char** argv) {
    int port = 9001;
    // Accept either a numeric first argument (legacy) or explicit flags
    if (argc > 1) {
        std::string first(argv[1]);
        bool is_number = !first.empty() && std::all_of(first.begin(), first.end(), [](unsigned char c){ return std::isdigit(c); });
        if (is_number) {
            try {
                port = std::stoi(first);
            } catch (...) {
                // leave default port
            }
        }
    }

    DeviceRegistry registry;

    bool sim_mode = false;
    for (int i = 1; i < argc; ++i) {
        std::string a(argv[i]);
        if (a == "-h" || a == "--help") {
            print_usage(argv[0]);
            return 0;
        }
        // Default sim port 8080.
        if (a == "--sim" || a == "-s"){ sim_mode = true; port=8080; }
        if ((a == "--port" || a == "-p") && i+1 < argc) {
            try { port = std::stoi(argv[i+1]); } catch(...) {}
        }
        if (a.rfind("--port=", 0) == 0) {
            try { port = std::stoi(a.substr(7)); } catch(...) {}
        }
    }

    if (sim_mode) {
        // Load simulator graph so device IDs match frontend `DeviceGraph.json`
        std::string graph_path = "/home/lemma137/dev/StoneGate/shared/protocol/DeviceGraph.json";
        static Simulator* global_sim = nullptr;
        if (!global_sim) global_sim = new Simulator(/*seed=*/0);
        if (!global_sim->load_from_graph(graph_path, registry)) {
            std::cerr << "Warning: failed to load device graph '" << graph_path << "' — falling back to hardcoded simulated devices" << std::endl;
            registry.register_device(std::make_shared<SimulatedDevice>("sim_tc1", "Thermocouple", std::vector<std::string>{"temp"}));
            registry.register_device(std::make_shared<SimulatedDevice>("sim_laser1", "LaserController", std::vector<std::string>{"power","phase"}));
            registry.register_device(std::make_shared<SimulatedDevice>("sim_det0", "PhotonicDetector", std::vector<std::string>{"counts","dark_rate","temperature"}));
            registry.register_device(std::make_shared<SimulatedDevice>("sim_ln2", "LN2CoolingController", std::vector<std::string>{"temperature_K","flow_rate_Lmin"}));
            registry.register_device(std::make_shared<SimulatedDevice>("sim_ancilla1", "AncillaQubit", std::vector<std::string>{"state","role"}));
            registry.register_device(std::make_shared<SimulatedDevice>("sim_qreg1", "QuantumRegister", std::vector<std::string>{"state_vector"}));
            registry.register_device(std::make_shared<SimulatedDevice>("sim_pulse1", "PulseSequencer", std::vector<std::string>{"current_step","running"}));
            registry.register_device(std::make_shared<SimulatedDevice>("sim_qec1", "QECModule", std::vector<std::string>{"syndrome","correction_applied"}));
        }
    } else {
        registry.register_device(std::make_shared<ThermocoupleDevice>("tc1"));
        registry.register_device(std::make_shared<LaserControllerDevice>("laser1"));
        registry.register_device(std::make_shared<PhotonicDetectorDevice>("det0"));
        registry.register_device(std::make_shared<LN2CoolingControllerDevice>("ln2"));
        registry.register_device(std::make_shared<AncillaQubitDevice>("ancilla1"));
        registry.register_device(std::make_shared<QuantumRegisterDevice>("qreg1", 5));
        registry.register_device(std::make_shared<PulseSequencerDevice>("pulse1"));
        registry.register_device(std::make_shared<QECModuleDevice>("qec1"));
    }

    WebSocketServer server(port, registry);
    server.start();

    std::cout << "Quantum backend running on port " << port << "..." << std::endl;

    // Start a small stdin control thread to accept JSON control lines for development
    // Only start this thread when stdin is a TTY; when run detached (nohup, systemd)
    // stdin will typically not be a TTY and we should avoid blocking on it.
    bool interactive_stdin = isatty(fileno(stdin));
    std::thread control_thread;
    if (interactive_stdin) {
        control_thread = std::thread([&](){
            std::string line;
            while (std::getline(std::cin, line)) {
                try {
                    if (line.empty()) continue;
                    auto j = nlohmann::json::parse(line);
                    server.handle_control(j);
                } catch (...) {
                    std::cerr << "control: failed to parse/handle input" << std::endl;
                }
            }
        });
    } else {
        std::cerr << "stdin not a TTY; skipping stdin control thread (detached/background mode)" << std::endl;
    }

    // CTRL-C quits; block forever
    while (true) std::this_thread::sleep_for(std::chrono::seconds(1));
    if (interactive_stdin && control_thread.joinable()) control_thread.join();
}