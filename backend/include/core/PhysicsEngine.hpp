#pragma once
#include <string>
#include <unordered_map>
#include <vector>
#include <thread>
#include <mutex>
#include <atomic>
#include <chrono>
#include <nlohmann/json.hpp>
#include <filesystem>

// Simple physics engine to propagate controller effects (e.g., LN2 flow -> temperature)
class PhysicsEngine {
public:
    PhysicsEngine();
    ~PhysicsEngine();
    // load parts library (JSON) to use default specs
    bool load_parts_library(const std::string& path);
    // load device overrides (per-device spec overrides)
    bool load_device_overrides(const std::string& path);
    // reload overrides from last path
    bool reload_overrides();
    // register a node (device) in the topology
    void register_node(const std::string& id, const nlohmann::json& node, const nlohmann::json& partSpec);
    // register an edge (connectivity)
    void register_edge(const std::string& from, const std::string& to);
    // update controller state (e.g., flow_rate) for a node
    void update_controller_state(const std::string& id, const nlohmann::json& state);
    // compute derived properties and return an object with values per node id (one-off)
    nlohmann::json compute_step();
    // start/stop a background timed update loop which caches the last computed step
    void start_background_loop(std::chrono::milliseconds interval);
    void stop_background_loop();
    // get cached step (thread-safe snapshot)
    nlohmann::json get_cached_step();

private:
    void compute_and_cache();

    nlohmann::json partsLib;
    nlohmann::json deviceOverrides;
    std::string overridesPath;

    struct NodeInfo { nlohmann::json node; nlohmann::json partSpec; };
    std::unordered_map<std::string, NodeInfo> nodes;
    std::vector<std::pair<std::string,std::string>> edges;
    std::unordered_map<std::string, nlohmann::json> controllerStates;

    // cached computed state
    nlohmann::json cachedState;
    std::mutex cacheMutex;

    // background worker
    std::thread worker;
    std::atomic<bool> running{false};
    std::chrono::milliseconds interval{200};
    std::filesystem::file_time_type overridesLastWrite;
};
