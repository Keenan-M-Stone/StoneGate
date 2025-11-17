#include "WebSocketServer.hpp"
#include "DeviceRegistry.hpp"
#include "devices/ThermocoupleDevice.hpp"
#include "devices/LaserControllerDevice.hpp"
#include <iostream>

int main(int argc, char** argv) {
    int port = 9001;
    if (argc > 1) port = std::stoi(argv[1]);

    DeviceRegistry registry;

    registry.register_device(std::make_shared<ThermocoupleDevice>("tc1"));
    registry.register_device(std::make_shared<LaserControllerDevice>("laser1"));

    WebSocketServer server(port, registry);
    server.start();

    std::cout << "Quantum backend running on port " << port << "..." << std::endl;

    // CTRL-C quits; block forever
    while (true) std::this_thread::sleep_for(std::chrono::seconds(1));
}