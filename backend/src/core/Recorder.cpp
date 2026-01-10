#include "core/Recorder.hpp"

#include "DeviceRegistry.hpp"
#include "Device.hpp"
#include "core/BuildInfo.hpp"
#include "core/ErrorCatalog.hpp"

#include <chrono>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <random>

using json = nlohmann::json;

namespace stonegate {

static std::filesystem::path find_repo_root() {
    // Heuristic: walk up a few levels looking for shared/protocol.
    try {
        auto p = std::filesystem::current_path();
        for (int i = 0; i < 6; ++i) {
            auto candidate = p / "shared" / "protocol";
            if (std::filesystem::exists(candidate) && std::filesystem::is_directory(candidate)) return p;
            if (p.has_parent_path()) p = p.parent_path();
        }
    } catch (...) {
    }
    return std::filesystem::current_path();
}

Recorder::Recorder(DeviceRegistry& registry, int port) : registry_(registry), port_(port) {}

Recorder::~Recorder() {
    std::vector<std::string> ids;
    {
        std::lock_guard<std::mutex> lk(sessions_m_);
        for (const auto& [id, _] : sessions_) ids.push_back(id);
    }
    for (const auto& id : ids) {
        stop(id);
    }
}

int64_t Recorder::now_ms() {
    return (int64_t)std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}

std::string Recorder::random_id() {
    static thread_local std::mt19937_64 rng{std::random_device{}()};
    static const char* hex = "0123456789abcdef";
    std::string out;
    out.reserve(32);
    for (int i = 0; i < 32; ++i) out.push_back(hex[(rng() >> ((i % 8) * 8)) & 0xF]);
    return out;
}

std::string Recorder::resolve_recordings_dir() {
    const char* env = std::getenv("STONEGATE_RECORDINGS_DIR");
    if (env && *env) return std::string(env);

    auto root = find_repo_root();
    auto dir = root / "shared" / "recordings";
    return dir.string();
}

json Recorder::normalize_measurement(const json& raw, int64_t ts_ms) {
    // Normalize to { ts, state, measurements: { metric: { value, uncertainty?, unit? } } }
    json out = json::object();
    out["ts"] = ts_ms;

    if (raw.is_object()) {
        if (raw.contains("ts")) out["ts"] = raw.value("ts", ts_ms);
        if (raw.contains("state")) out["state"] = raw.value("state", "unknown");

        // Already in schema shape?
        if (raw.contains("measurements") && raw["measurements"].is_object()) {
            out["measurements"] = raw["measurements"];
            if (!out.contains("state")) out["state"] = raw.value("state", "unknown");
            return out;
        }

        // Convert flat object values to Measurement entries.
        json meas = json::object();
        for (auto it = raw.begin(); it != raw.end(); ++it) {
            const auto& k = it.key();
            if (k == "ts" || k == "state") continue;
            const auto& v = it.value();
            if (v.is_number()) {
                meas[k] = json::object({ {"value", v.get<double>()} });
            } else if (v.is_object() && v.contains("value") && v["value"].is_number()) {
                meas[k] = v;
            }
        }
        out["measurements"] = meas;
        if (!out.contains("state")) out["state"] = "unknown";
        return out;
    }

    out["state"] = "unknown";
    out["measurements"] = json::object();
    return out;
}

json Recorder::filter_measurements(const json& normalized, const std::vector<std::string>& metrics) {
    if (!normalized.is_object()) return normalized;
    if (!normalized.contains("measurements") || !normalized["measurements"].is_object()) return normalized;
    if (metrics.empty()) return normalized;

    json out = normalized;
    json meas = json::object();
    for (const auto& m : metrics) {
        if (out["measurements"].contains(m)) meas[m] = out["measurements"][m];
    }
    out["measurements"] = meas;
    return out;
}

RecordStartResult Recorder::start(const json& params) {
    if (!params.is_object()) throw std::runtime_error(stonegate::errors::D2400_RECORD_PARAMS_NOT_OBJECT);

    auto streams_json = params.value("streams", json::array());
    if (!streams_json.is_array() || streams_json.empty()) throw std::runtime_error(stonegate::errors::D2400_RECORD_STREAMS_REQUIRED);

    std::vector<RecordStream> streams;
    for (const auto& s : streams_json) {
        if (!s.is_object()) continue;
        RecordStream rs;
        rs.device_id = s.value("device_id", "");
        if (rs.device_id.empty()) throw std::runtime_error(stonegate::errors::D2400_RECORD_STREAM_MISSING_DEVICE_ID);

        rs.rate_hz = s.value("rate_hz", 1.0);
        if (!(rs.rate_hz > 0.0) || !std::isfinite(rs.rate_hz)) throw std::runtime_error(stonegate::errors::D2400_RECORD_STREAM_RATE_INVALID);

        auto metrics = s.value("metrics", json::array());
        if (metrics.is_array()) {
            for (const auto& m : metrics) {
                if (m.is_string()) rs.metrics.push_back(m.get<std::string>());
            }
        }
        streams.push_back(std::move(rs));
    }
    if (streams.empty()) throw std::runtime_error(stonegate::errors::D2400_RECORD_NO_VALID_STREAMS);

    auto session = std::make_shared<Session>();
    session->id = random_id();
    session->streams = std::move(streams);
    session->script_name = params.value("script_name", "");
    session->operator_name = params.value("operator", "");
    session->port = port_;
    session->started_ts_ms = now_ms();

    std::filesystem::path dir(resolve_recordings_dir());
    std::filesystem::create_directories(dir);

    // Place recordings under YYYY-MM-DD/
    auto t = std::chrono::system_clock::now();
    std::time_t tt = std::chrono::system_clock::to_time_t(t);
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &tt);
#else
    localtime_r(&tt, &tm);
#endif
    std::ostringstream day;
    day << std::setfill('0') << std::setw(4) << (tm.tm_year + 1900) << "-" << std::setw(2) << (tm.tm_mon + 1) << "-" << std::setw(2) << tm.tm_mday;

    std::filesystem::path day_dir = dir / day.str();
    std::filesystem::create_directories(day_dir);

    std::string base = params.value("file_base", std::string("recording"));
    // sanitize base
    for (char& c : base) {
        if (!(std::isalnum((unsigned char)c) || c == '_' || c == '-' || c == '.')) c = '_';
    }
    if (base.empty()) base = "recording";

    std::filesystem::path path = day_dir / (base + "_" + session->id + ".jsonl");
    session->path = path.string();

    session->file.open(session->path, std::ios::out | std::ios::trunc);
    if (!session->file) throw std::runtime_error(stonegate::errors::D2400_RECORD_OPEN_FILE_FAILED);

    // Header line: fully describes provenance and schema.
    json header = {
        {"type", "stonegate_recording"},
        {"schema_version", 1},
        {"recording_id", session->id},
        {"started_ts_ms", session->started_ts_ms},
        {"meta", {
            {"script_name", session->script_name},
            {"operator", session->operator_name},
            {"backend", {
                {"port", port_},
                {"git_commit", stonegate::buildinfo::git_commit()},
                {"build_time", stonegate::buildinfo::build_time_utc_approx()}
            }}
        }},
        {"streams", json::array()}
    };

    for (const auto& s : session->streams) {
        header["streams"].push_back({
            {"device_id", s.device_id},
            {"metrics", s.metrics},
            {"rate_hz", s.rate_hz}
        });
    }

    {
        std::lock_guard<std::mutex> lk(session->file_m);
        session->file << header.dump() << "\n";
        session->file.flush();
    }

    session->running.store(true);
    session->worker = std::thread([this, session]() { run_session(session); });

    {
        std::lock_guard<std::mutex> lk(sessions_m_);
        sessions_[session->id] = session;
    }

    return { session->id, session->path };
}

void Recorder::run_session(const std::shared_ptr<Session>& s) {
    struct StreamState {
        RecordStream cfg;
        int64_t next_due_ms = 0;
        int64_t interval_ms = 0;
    };

    std::vector<StreamState> ss;
    ss.reserve(s->streams.size());
    const int64_t start = s->started_ts_ms;
    for (const auto& st : s->streams) {
        StreamState x;
        x.cfg = st;
        x.interval_ms = (int64_t)std::max(1.0, 1000.0 / st.rate_hz);
        x.next_due_ms = start;
        ss.push_back(std::move(x));
    }

    while (s->running.load()) {
        int64_t now = now_ms();

        int64_t next_wake = now + 250;
        for (auto& st : ss) {
            if (st.next_due_ms <= now) {
                // Poll device and write sample.
                auto dev = registry_.get_device(st.cfg.device_id);
                if (dev) {
                    try {
                        json raw = dev->read_measurement();
                        json norm = normalize_measurement(raw, now);
                        json filt = filter_measurements(norm, st.cfg.metrics);

                        json line = {
                            {"type", "sample"},
                            {"ts_ms", (int64_t)filt.value("ts", now)},
                            {"device_id", st.cfg.device_id},
                            {"state", filt.value("state", "unknown")},
                            {"measurements", filt.value("measurements", json::object())}
                        };

                        {
                            std::lock_guard<std::mutex> lk(s->file_m);
                            if (s->file) {
                                s->file << line.dump() << "\n";
                                s->samples_written += 1;
                            }
                        }
                    } catch (...) {
                        // swallow device failures; recording continues
                    }
                }
                st.next_due_ms = now + st.interval_ms;
            }
            next_wake = std::min(next_wake, st.next_due_ms);
        }

        // Sleep until next due (or a short cap)
        now = now_ms();
        int64_t sleep_ms = std::max<int64_t>(1, std::min<int64_t>(100, next_wake - now));
        std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
    }

    {
        std::lock_guard<std::mutex> lk(s->stop_m);
        s->stopped_ts_ms = now_ms();
    }

    {
        std::lock_guard<std::mutex> lk(s->file_m);
        if (s->file) {
            json footer = {
                {"type", "stop"},
                {"recording_id", s->id},
                {"stopped_ts_ms", s->stopped_ts_ms},
                {"samples_written", s->samples_written}
            };
            s->file << footer.dump() << "\n";
            s->file.flush();
            s->file.close();
        }
    }
}

std::optional<RecordStopResult> Recorder::stop(const std::string& recording_id) {
    std::shared_ptr<Session> s;
    {
        std::lock_guard<std::mutex> lk(sessions_m_);
        auto it = sessions_.find(recording_id);
        if (it == sessions_.end()) return std::nullopt;
        s = it->second;
        sessions_.erase(it);
    }

    s->running.store(false);
    if (s->worker.joinable()) s->worker.join();

    int64_t stopped;
    {
        std::lock_guard<std::mutex> lk(s->stop_m);
        stopped = s->stopped_ts_ms;
        if (stopped == 0) stopped = now_ms();
    }

    RecordStopResult out;
    out.recording_id = s->id;
    out.path = s->path;
    out.samples_written = s->samples_written;
    out.started_ts_ms = s->started_ts_ms;
    out.stopped_ts_ms = stopped;
    return out;
}

} // namespace stonegate
