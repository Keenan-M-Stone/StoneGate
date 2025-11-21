#include "WebSocketServer.hpp"
#include "DescriptorProtocol.hpp"
#include "DeviceRegistry.hpp"
#include "simulator/SimulatedDevice.hpp"
#include <iostream>
#include <chrono>

WebSocketServer::WebSocketServer(int p, DeviceRegistry& reg)
: port(p), running(false), registry(reg) {}

WebSocketServer::~WebSocketServer() {
    stop();
}

void WebSocketServer::start() {
    if (running) return;
    running = true;
    protocol = std::make_unique<DescriptorProtocol>(registry);

    event_thread = std::thread(&WebSocketServer::run_event_loop, this);
    broadcast_thread = std::thread(&WebSocketServer::broadcast_measurements_loop, this);
}

void WebSocketServer::stop() {
    running = false;
    if (event_thread.joinable()) event_thread.join();
    if (broadcast_thread.joinable()) broadcast_thread.join();
}

void WebSocketServer::run_event_loop() {
    // TODO: Hook up websocketpp handlers
    while (running) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}

void WebSocketServer::handle_control(const nlohmann::json& msg) {
    try {
        if (msg.contains("cmd") && msg["cmd"] == "reload_overrides") {
            bool any = false;
            registry.for_each_device([&](std::shared_ptr<Device> d){
                auto sd = std::dynamic_pointer_cast<SimulatedDevice>(d);
                if (sd) {
                    if (sd->trigger_reload_overrides()) any = true;
                }
            });
            std::cout << "WebSocketServer: reload_overrides triggered via control (any=" << any << ")\n";
        }
    } catch (const std::exception& e) {
        std::cerr << "handle_control error: " << e.what() << std::endl;
    }
}

void WebSocketServer::broadcast_measurements_loop() {
    while (running) {
        auto msg = protocol->build_measurement_update();
        // TODO: push to all connected sessions
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
}