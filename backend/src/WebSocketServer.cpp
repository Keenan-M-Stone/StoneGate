#include "WebSocketServer.hpp"
#include "DescriptorProtocol.hpp"
#include "DeviceRegistry.hpp"
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

void WebSocketServer::broadcast_measurements_loop() {
    while (running) {
        auto msg = protocol->build_measurement_update();
        // TODO: push to all connected sessions
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
}