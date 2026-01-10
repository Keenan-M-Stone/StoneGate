#pragma once

#include <atomic>
#include <cstdint>
#include <fstream>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

class DeviceRegistry;

namespace stonegate {

struct RecordStream {
    std::string device_id;
    std::vector<std::string> metrics; // if empty: record all metrics
    double rate_hz = 1.0;
};

struct RecordStartResult {
    std::string recording_id;
    std::string path;
};

struct RecordStopResult {
    std::string recording_id;
    std::string path;
    int64_t samples_written = 0;
    int64_t started_ts_ms = 0;
    int64_t stopped_ts_ms = 0;
};

class Recorder {
public:
    Recorder(DeviceRegistry& registry, int port);
    ~Recorder();

    RecordStartResult start(const nlohmann::json& params);
    std::optional<RecordStopResult> stop(const std::string& recording_id);

private:
    struct Session {
        std::string id;
        std::string path;
        std::string script_name;
        std::string operator_name;
        int port = 0;
        int64_t started_ts_ms = 0;

        std::vector<RecordStream> streams;

        std::atomic<bool> running{false};
        std::thread worker;
        std::mutex file_m;
        std::ofstream file;
        int64_t samples_written = 0;

        std::mutex stop_m;
        int64_t stopped_ts_ms = 0;
    };

    DeviceRegistry& registry_;
    int port_;

    std::mutex sessions_m_;
    std::unordered_map<std::string, std::shared_ptr<Session>> sessions_;

    static std::string random_id();
    static int64_t now_ms();
    static std::string resolve_recordings_dir();

    static nlohmann::json normalize_measurement(const nlohmann::json& raw, int64_t ts_ms);
    static nlohmann::json filter_measurements(const nlohmann::json& normalized, const std::vector<std::string>& metrics);

    void run_session(const std::shared_ptr<Session>& s);
};

} // namespace stonegate
