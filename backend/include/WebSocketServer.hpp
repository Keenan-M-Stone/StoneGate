#pragma once
#include <thread>
#include <atomic>
#include <functional>
#include <string>
#include <memory>
#include <nlohmann/json.hpp>

class DescriptorProtocol;
class DeviceRegistry;

class WebSocketServer {
public:
    WebSocketServer(int port, DeviceRegistry& registry);
    ~WebSocketServer();

    void start();
    void stop();
    // Handle control messages (from websocket or other control channel)
    void handle_control(const nlohmann::json& msg);

private:
    void run_event_loop();
    void broadcast_measurements_loop();

    int port;
    std::atomic<bool> running;
    std::thread event_thread;
    std::thread broadcast_thread;

    DeviceRegistry& registry;
    std::unique_ptr<DescriptorProtocol> protocol;
};