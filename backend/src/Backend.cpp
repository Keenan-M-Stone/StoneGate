#include "Backend.hpp"
#include <chrono>
#include <thread>
#include <iostream>
#include <nlohmann/json.hpp>

namespace qcs {

Backend::Backend(const BackendConfig& cfg) : config_(cfg) {}
Backend::~Backend() { stop(); }

bool Backend::start() {
    if (running_) return false;

    // load device graph and create DeviceManager
    deviceManager_ = std::make_unique<DeviceManager>(config_.deviceGraphPath, config_.simulatorMode);

    // start WebSocket server
    ws_ = std::make_unique<WebSocketServer>(config_.websocketPort);
    ws_->start();

    running_ = true;

    // broadcaster thread
    broadcastThread_ = std::thread(&Backend::broadcastLoop, this);

    std::cout << "Backend running on port " << config_.websocketPort << "
";
    return true;
}

void Backend::stop() {
    if (!running_) return;
    running_ = false;

    if (broadcastThread_.joinable()) broadcastThread_.join();
    if (ws_) ws_->stop();
}

void Backend::broadcastLoop() {
    using namespace std::chrono_literals;
    while (running_) {
        auto statuses = deviceManager_->collectStatus();
        for (auto& st : statuses) {
            ws_->broadcast(nlohmann::json(st).dump());
        }
        std::this_thread::sleep_for(500ms);
    }
}

} // namespace qcs
