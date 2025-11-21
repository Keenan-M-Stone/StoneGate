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
#include <iostream>

int main(int argc, char** argv) {
    int port = 9001;
    if (argc > 1) port = std::stoi(argv[1]);

    DeviceRegistry registry;

    bool sim_mode = false;
    for (int i = 1; i < argc; ++i) {
        std::string a(argv[i]);
        if (a == "--sim" || a == "-s") sim_mode = true;
    }

    if (sim_mode) {
        // Register simulated devices and affiliated components
        registry.register_device(std::make_shared<SimulatedDevice>("sim_tc1", "Thermocouple", std::vector<std::string>{"temp"}));
        registry.register_device(std::make_shared<SimulatedDevice>("sim_laser1", "LaserController", std::vector<std::string>{"power","phase"}));
        registry.register_device(std::make_shared<SimulatedDevice>("sim_det0", "PhotonicDetector", std::vector<std::string>{"counts","dark_rate","temperature"}));
        registry.register_device(std::make_shared<SimulatedDevice>("sim_ln2", "LN2CoolingController", std::vector<std::string>{"temperature_K","flow_rate_Lmin"}));
        registry.register_device(std::make_shared<SimulatedDevice>("sim_ancilla1", "AncillaQubit", std::vector<std::string>{"state","role"}));
        registry.register_device(std::make_shared<SimulatedDevice>("sim_qreg1", "QuantumRegister", std::vector<std::string>{"state_vector"}));
        registry.register_device(std::make_shared<SimulatedDevice>("sim_pulse1", "PulseSequencer", std::vector<std::string>{"current_step","running"}));
        registry.register_device(std::make_shared<SimulatedDevice>("sim_qec1", "QECModule", std::vector<std::string>{"syndrome","correction_applied"}));
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
    std::thread control_thread([&](){
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

    // CTRL-C quits; block forever
    while (true) std::this_thread::sleep_for(std::chrono::seconds(1));
    if (control_thread.joinable()) control_thread.join();
}