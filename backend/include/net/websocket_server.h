#pragma once
#include <functional>
#include <string>
#include "core/state_cache.h"

namespace qm::net {

struct WSMessage {
    std::string topic; // e.g., "telemetry", "command", "result"
    std::string payload; // JSON string
};

// Minimal webhook-style server abstraction. Implement using your preferred ws lib
class WebsocketServer {
public:
    WebsocketServer(int port);
    void setOnMessage(std::function<void(const WSMessage&)> cb);
    void broadcast(const WSMessage& m);
    void run();
    void stop();
private:
    int port_;
    std::function<void(const WSMessage&)> onMessage_;
};

} // namespace qm::net