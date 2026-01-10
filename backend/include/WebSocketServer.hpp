#pragma once
#include <thread>
#include <atomic>
#include <functional>
#include <string>
#include <memory>
#include <nlohmann/json.hpp>

class DescriptorProtocol;
class DeviceRegistry;
namespace stonegate { class Recorder; }

class WebSocketServer {
public:
    WebSocketServer(int port, DeviceRegistry& registry);
    ~WebSocketServer();

    void start();
    void stop();
    // Handle control messages (from websocket or other control channel)
    void handle_control(const nlohmann::json& msg);
    // Handle messages that may need a reply (WebSocket).
    void handle_message(const nlohmann::json& msg, const std::function<void(const nlohmann::json&)>& reply);

private:
    void run_event_loop();
    void broadcast_measurements_loop();

    int port;
    std::atomic<bool> running;
    std::thread event_thread;
    std::thread broadcast_thread;

    // WebSocket sessions (managed by the event loop)
    struct Impl;
    std::shared_ptr<Impl> impl;

    DeviceRegistry& registry;
    std::unique_ptr<DescriptorProtocol> protocol;
    std::unique_ptr<stonegate::Recorder> recorder;
};