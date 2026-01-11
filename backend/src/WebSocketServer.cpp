#include "WebSocketServer.hpp"
#include "DescriptorProtocol.hpp"
#include "DeviceRegistry.hpp"
#include "simulator/SimulatedDevice.hpp"
#include "core/Recorder.hpp"
#include "core/BuildInfo.hpp"
#include "core/ErrorCatalog.hpp"
#include <iostream>
#include <chrono>
#include <fstream>
#include <filesystem>
#include <sstream>
#include <iomanip>
// Boost.Beast / Asio for WebSocket
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/strand.hpp>
#include <mutex>
#include <set>
#include <random>

namespace beast = boost::beast;         // from <boost/beast.hpp>
namespace http = beast::http;           // not used but conventional
namespace websocket = beast::websocket; // from <boost/beast/websocket.hpp>
namespace asio = boost::asio;           // from <boost/asio.hpp>
using tcp = asio::ip::tcp;              // from <boost/asio/ip/tcp.hpp>

static std::string sg_random_id() {
    static thread_local std::mt19937_64 rng{std::random_device{}()};
    static const char* hex = "0123456789abcdef";
    std::string out;
    out.reserve(32);
    for (int i = 0; i < 32; ++i) out.push_back(hex[(rng() >> (i % 8) * 8) & 0xF]);
    return out;
}

static std::string sg_read_file(const std::string& path) {
    std::ifstream f(path, std::ios::in | std::ios::binary);
    if (!f) return {};
    std::string s;
    f.seekg(0, std::ios::end);
    std::streampos n = f.tellg();
    if (n > 0) s.resize((size_t)n);
    f.seekg(0, std::ios::beg);
    if (!s.empty()) f.read(&s[0], s.size());
    return s;
}

static std::string sg_fnv1a64_hex(const std::string& bytes) {
    uint64_t h = 1469598103934665603ull;
    for (unsigned char c : bytes) {
        h ^= (uint64_t)c;
        h *= 1099511628211ull;
    }
    static const char* hex = "0123456789abcdef";
    std::string out;
    out.resize(16);
    for (int i = 0; i < 16; ++i) {
        out[15 - i] = hex[(h >> (i * 4)) & 0xF];
    }
    return out;
}

static std::string sg_protocol_version() {
    // Update when making breaking protocol changes.
    return "1.0.0";
}

static nlohmann::json sg_capabilities() {
    return nlohmann::json::array({
        "devices.list",
        "devices.poll",
        "backend.info",
        "backend.logs",
        "graph.get",
        "graph.save",
        "graph.load",
        "graph.list",
        "graph.set_active",
        "device.action",
        "record.start",
        "record.stop",
        "qec.decode",
        "qec.benchmark"
    });
}

static std::string sg_now_iso8601_utc() {
    using namespace std::chrono;
    const auto now = system_clock::now();
    const auto t = system_clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    const auto ms = duration_cast<milliseconds>(now.time_since_epoch()) % 1000;
    std::ostringstream oss;
    oss << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S")
        << '.' << std::setw(3) << std::setfill('0') << ms.count() << 'Z';
    return oss.str();
}

static std::string sg_sanitize_schematic_name(const std::string& in) {
    std::string out;
    out.reserve(in.size());
    for (char c : in) {
        const bool ok =
            (c >= 'a' && c <= 'z') ||
            (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') ||
            c == '_' || c == '-' || c == '.';
        if (ok) out.push_back(c);
        else if (c == ' ' || c == '/' || c == '\\') out.push_back('_');
        // else drop
        if (out.size() >= 96) break;
    }
    // trim dots to avoid weird filenames
    while (!out.empty() && out.front() == '.') out.erase(out.begin());
    while (!out.empty() && out.back() == '.') out.pop_back();
    if (out.empty()) return "schematic";
    return out;
}

static std::filesystem::path sg_schematics_dir_for_graph(const std::string& device_graph_path) {
    if (device_graph_path.empty()) return {};
    std::filesystem::path p(device_graph_path);
    return p.parent_path() / "schematics";
}

static std::filesystem::path sg_active_schematic_file(const std::filesystem::path& schem_dir) {
    return schem_dir / "active.txt";
}

static std::string sg_read_text_file_allow_fail(const std::filesystem::path& p) {
    try {
        if (p.empty() || !std::filesystem::exists(p)) return {};
        std::ifstream ifs(p, std::ios::binary);
        if (!ifs) return {};
        std::string s((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
        // trim whitespace
        while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' ' || s.back() == '\t')) s.pop_back();
        while (!s.empty() && (s.front() == '\n' || s.front() == '\r' || s.front() == ' ' || s.front() == '\t')) s.erase(s.begin());
        return s;
    } catch (...) {
        return {};
    }
}

WebSocketServer::WebSocketServer(int p, DeviceRegistry& reg, bool sim_mode, std::string device_graph_path)
: port(p), sim_mode_(sim_mode), device_graph_path_(std::move(device_graph_path)), running(false), registry(reg) {}

// Implementation details hidden behind PIMPL
struct WebSocketServer::Impl {
    asio::io_context ioc;
    tcp::acceptor acceptor;
    bool ok = false;
    std::mutex sessions_m;
    std::set<std::shared_ptr<websocket::stream<tcp::socket>>> sessions;
    Impl(int port): ioc(), acceptor(ioc) {
        boost::system::error_code ec;
        acceptor.open(tcp::v4(), ec);
        if (ec) {
            std::cerr << "acceptor.open failed: " << ec.message() << std::endl;
            ok = false;
            return;
        }
        acceptor.set_option(asio::socket_base::reuse_address(true), ec);
        if (ec) {
            std::cerr << "set_option failed: " << ec.message() << std::endl;
        }
        acceptor.bind(tcp::endpoint(tcp::v4(), port), ec);
        if (ec) {
            std::cerr << "bind failed: " << ec.message() << std::endl;
            ok = false;
            return;
        }
        acceptor.listen(asio::socket_base::max_listen_connections, ec);
        if (ec) {
            std::cerr << "listen failed: " << ec.message() << std::endl;
            ok = false;
            return;
        }
        ok = true;
    }

    void add_session(std::shared_ptr<websocket::stream<tcp::socket>> s) {
        {
            std::lock_guard<std::mutex> lk(sessions_m);
            sessions.insert(s);
            std::cerr << "WebSocketServer: client connected (count=" << sessions.size() << ")" << std::endl;
        }
    }
    void remove_session(std::shared_ptr<websocket::stream<tcp::socket>> s) {
        {
            std::lock_guard<std::mutex> lk(sessions_m);
            sessions.erase(s);
            std::cerr << "WebSocketServer: client disconnected (count=" << sessions.size() << ")" << std::endl;
        }
    }
    template<typename Fn>
    void for_each_session(Fn&& fn) {
        std::lock_guard<std::mutex> lk(sessions_m);
        for (auto &s : sessions) fn(s);
    }
};

WebSocketServer::~WebSocketServer() {
    stop();
}

void WebSocketServer::start() {
    if (running) return;

    // Initialize acceptor first so we can fail fast on bind/listen.
    impl = std::make_shared<Impl>(port);
    if (!impl->ok) {
        impl.reset();
        std::cerr << "WebSocketServer: failed to start (port=" << port << ")" << std::endl;
        running = false;
        return;
    }

    running = true;
    protocol = std::make_unique<DescriptorProtocol>(registry);
    recorder = std::make_unique<stonegate::Recorder>(registry, port);

    event_thread = std::thread([this](){ run_event_loop(); });
    broadcast_thread = std::thread([this](){ broadcast_measurements_loop(); });
}

void WebSocketServer::stop() {
    running = false;
    if (event_thread.joinable()) event_thread.join();
    if (broadcast_thread.joinable()) broadcast_thread.join();
    recorder.reset();
}

bool WebSocketServer::is_running() const {
    return running.load();
}

void WebSocketServer::run_event_loop() {
    try {
        // Start accepting loop using Boost.Asio/Beast
        auto& ioc = impl->ioc;
        auto& acceptor = impl->acceptor;

        std::function<void()> do_accept;
        do_accept = [&]() {
            auto socket = std::make_shared<tcp::socket>(ioc);
            acceptor.async_accept(*socket, [this, socket, &do_accept](boost::system::error_code ec) {
                if (ec) {
                    if (running) std::cerr << "accept error: " << ec.message() << std::endl;
                } else {
                    // Create a websocket stream and accept the handshake
                    auto ws = std::make_shared<websocket::stream<tcp::socket>>(std::move(*socket));
                    // Accept the websocket handshake
                    ws->async_accept([this, ws](boost::system::error_code ec) {
                        if (ec) {
                            std::cerr << "websocket accept failed: " << ec.message() << std::endl;
                            return;
                        }
                        const std::string session_id = sg_random_id().substr(0, 12);
                        impl->add_session(ws);

                        // Send a descriptor snapshot on connect for discovery.
                        try {
                            auto msgj = protocol->build_descriptor_message();
                            auto payload = msgj.dump();
                            asio::post(ws->get_executor(), [ws, payload]() {
                                boost::system::error_code ec;
                                ws->write(asio::buffer(payload), ec);
                            });
                        } catch (...) {}

                        // Start a read loop to keep the connection alive and receive control messages
                        auto buffer = std::make_shared<beast::flat_buffer>();
                        auto do_read = std::make_shared<std::function<void()>>();
                        *do_read = [this, ws, buffer, do_read, session_id]() {
                            ws->async_read(*buffer, [this, ws, buffer, do_read, session_id](boost::system::error_code ec, std::size_t bytes_transferred){
                                if (ec) {
                                    impl->remove_session(ws);
                                    return;
                                }
                                try {
                                    auto data = beast::buffers_to_string(buffer->data());
                                    buffer->consume(buffer->size());
                                    auto j = nlohmann::json::parse(data);
                                    auto reply = [ws](const nlohmann::json& out) {
                                        try {
                                            auto payload = out.dump();
                                            asio::post(ws->get_executor(), [ws, payload]() {
                                                boost::system::error_code ec;
                                                ws->write(asio::buffer(payload), ec);
                                            });
                                        } catch (...) {}
                                    };
                                    handle_message(j, reply, "ws", session_id);
                                } catch (...) {}
                                (*do_read)();
                            });
                        };
                        (*do_read)();
                    });
                }
                if (running) do_accept();
            });
        };

        // kickoff accept loop
        do_accept();

        // Run the I/O context until stopped (use non-blocking poll loop)
        while (running) {
            try {
                impl->ioc.poll();
            } catch (const std::exception& e) {
                std::cerr << "I/O context error: " << e.what() << std::endl;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }

        // cleanly close sessions
        impl->for_each_session([&](std::shared_ptr<websocket::stream<tcp::socket>> s){
            boost::system::error_code ec;
            s->close(websocket::close_code::normal, ec);
        });

    } catch (const std::exception& e) {
        std::cerr << "run_event_loop exception: " << e.what() << std::endl;
    }
}

void WebSocketServer::handle_control(const nlohmann::json& msg) {
    auto noop = [](const nlohmann::json&){};
    handle_message(msg, noop, "control", "control");
}

void WebSocketServer::handle_message(const nlohmann::json& msg, const std::function<void(const nlohmann::json&)>& reply) {
    handle_message(msg, reply, "unknown", "");
}

void WebSocketServer::handle_message(const nlohmann::json& msg, const std::function<void(const nlohmann::json&)>& reply, const std::string& origin, const std::string& session_id) {
    try {
        auto broadcast = [&](const nlohmann::json& out) {
            if (!impl) return;
            try {
                const auto payload = out.dump();
                impl->for_each_session([&](std::shared_ptr<websocket::stream<tcp::socket>> s) {
                    asio::post(s->get_executor(), [s, payload]() {
                        boost::system::error_code ec;
                        s->write(asio::buffer(payload), ec);
                    });
                });
            } catch (...) {}
        };

        auto broadcast_log = [&](const std::string& level, const std::string& kind, const nlohmann::json& fields) {
            nlohmann::json j = nlohmann::json::object();
            j["type"] = "backend.log";
            j["ts"] = sg_now_iso8601_utc();
            j["ts_ms"] = (int64_t)std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            j["level"] = level;
            j["origin"] = origin;
            if (!session_id.empty()) j["session_id"] = session_id;
            j["kind"] = kind;
            j["fields"] = fields;
            if (fields.is_object()) {
                for (auto it = fields.begin(); it != fields.end(); ++it) j[it.key()] = it.value();
            }
            broadcast(j);
        };

        const auto type = msg.value("type", std::string{});
        const auto cmd = msg.value("cmd", std::string{});

        auto map_set_action = [](const std::string& device_type, const nlohmann::json& action_in) {
            if (!action_in.is_object()) return action_in;
            if (!action_in.contains("set") || !action_in["set"].is_object()) return action_in;

            nlohmann::json out = nlohmann::json::object();

            // Preserve non-set keys (e.g. zero/reset)
            for (auto it = action_in.begin(); it != action_in.end(); ++it) {
                if (it.key() == "set") continue;
                out[it.key()] = it.value();
            }

            const auto& setobj = action_in["set"];
            for (auto it = setobj.begin(); it != setobj.end(); ++it) {
                const std::string k = it.key();
                const auto& v = it.value();
                if (k.rfind("set_", 0) == 0) { out[k] = v; continue; }

                // Device-specific mappings
                if (device_type == "laser_controller") {
                    if (k == "phase_rad") { out["set_phase"] = v; continue; }
                    if (k == "intensity" || k == "power" || k == "optical_power") { out["set_intensity"] = v; continue; }
                }
                if (device_type == "ln2_cooling_controller") {
                    if (k == "temperature_K" || k == "setpoint_K") { out["set_setpoint"] = v; continue; }
                    if (k == "flow_rate_Lmin") { out["set_flow_rate"] = v; continue; }
                }

                // Generic: try set_<key>, and a stripped-unit form.
                out[std::string("set_") + k] = v;
                auto pos = k.find_last_of('_');
                if (pos != std::string::npos && pos > 0) {
                    const std::string base = k.substr(0, pos);
                    out[std::string("set_") + base] = v;
                }
            }

            return out;
        };

        auto rpc_error = [&](const std::string& id, int code, const std::string& message, const nlohmann::json& details = nlohmann::json::object()) {
            reply({
                {"type", "rpc_result"},
                {"id", id},
                {"ok", false},
                {"error", { {"code", stonegate::errors::code_string(code)}, {"message", message}, {"details", details} }}
            });
        };
        auto rpc_ok = [&](const std::string& id, const nlohmann::json& result) {
            reply({ {"type", "rpc_result"}, {"id", id}, {"ok", true}, {"result", result} });
        };

        // Legacy / control commands
        if (cmd == "reload_overrides") {
            broadcast_log("info", "control.reload_overrides", { {"cmd", cmd} });
            bool any = false;
            registry.for_each_device([&](std::shared_ptr<Device> d){
                auto sd = std::dynamic_pointer_cast<SimulatedDevice>(d);
                if (sd) {
                    if (sd->trigger_reload_overrides()) any = true;
                }
            });
            reply({ {"type", "control_ack"}, {"cmd", "reload_overrides"}, {"ok", true}, {"any", any} });
            return;
        }

        // Manual device action (control channel)
        if (cmd == "action" || cmd == "device_action") {
            const auto device_id = msg.value("device_id", std::string{});
            if (device_id.empty()) {
                broadcast_log("warn", "control.device_action", { {"cmd", cmd}, {"error", "missing_device_id"} });
                reply({ {"type", "control_ack"}, {"cmd", cmd}, {"ok", false}, {"error", stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_MISSING_DEVICE_ID)} });
                return;
            }
            if (!msg.contains("action") || !msg["action"].is_object()) {
                broadcast_log("warn", "control.device_action", { {"cmd", cmd}, {"device_id", device_id}, {"error", "missing_action"} });
                reply({ {"type", "control_ack"}, {"cmd", cmd}, {"ok", false}, {"error", stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_MISSING_ACTION)} });
                return;
            }
            auto dev = registry.get_device(device_id);
            if (!dev) {
                broadcast_log("warn", "control.device_action", { {"cmd", cmd}, {"device_id", device_id}, {"error", "unknown_device"} });
                reply({ {"type", "control_ack"}, {"cmd", cmd}, {"ok", false}, {"error", stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_UNKNOWN_DEVICE)}, {"device_id", device_id} });
                return;
            }
            auto action = msg["action"];
            action = map_set_action(dev->type(), action);
            broadcast_log("info", "control.device_action", { {"cmd", cmd}, {"device_id", device_id}, {"device_type", dev->type()} });
            dev->perform_action(action);
            reply({ {"type", "control_ack"}, {"cmd", cmd}, {"ok", true}, {"device_id", device_id} });
            return;
        }

        // RPC (toolbox API)
        if (type == "rpc") {
            const auto id = msg.value("id", std::string{});
            if (id.empty()) {
                // id is required so clients can correlate responses
                rpc_error(sg_random_id(), stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_RPC_MISSING_ID), { {"detail", stonegate::errors::D2400_RPC_MISSING_ID} });
                return;
            }
            const auto method = msg.value("method", std::string{});
            const auto params = msg.value("params", nlohmann::json::object());
            if (method.empty()) {
                rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_RPC_MISSING_METHOD), { {"detail", stonegate::errors::D2400_RPC_MISSING_METHOD} });
                return;
            }

            // Broadcast inbound RPCs for diagnostics; frontends can mark as "external" when rpc_id doesn't match their own.
            nlohmann::json keys = nlohmann::json::array();
            if (params.is_object()) {
                for (auto it = params.begin(); it != params.end(); ++it) keys.push_back(it.key());
            }
            nlohmann::json extra = nlohmann::json::object();
            extra["rpc_id"] = id;
            extra["method"] = method;
            extra["params_keys"] = keys;
            if (method == "device.action") extra["device_id"] = params.value("device_id", std::string{});
            if (method == "graph.save" || method == "graph.load" || method == "graph.set_active") extra["name"] = params.value("name", std::string{});
            broadcast_log("info", "rpc.in", extra);

            if (method == "devices.list") {
                rpc_ok(id, { {"devices", registry.get_descriptor_graph()} });
                return;
            }
            if (method == "devices.poll") {
                rpc_ok(id, { {"updates", registry.poll_all()} });
                return;
            }
            if (method == "backend.info") {
                std::string graph_hash;
                std::string schema_hash;
                std::string active_schematic;
                if (!device_graph_path_.empty() && std::filesystem::exists(device_graph_path_)) {
                    const auto bytes = sg_read_file(device_graph_path_);
                    if (!bytes.empty()) graph_hash = sg_fnv1a64_hex(bytes);
                    std::filesystem::path p(device_graph_path_);
                    auto schema_path = (p.parent_path() / "ComponentSchema.json").string();
                    if (std::filesystem::exists(schema_path)) {
                        const auto sb = sg_read_file(schema_path);
                        if (!sb.empty()) schema_hash = sg_fnv1a64_hex(sb);
                    }
                    const auto schem_dir = sg_schematics_dir_for_graph(device_graph_path_);
                    active_schematic = sg_read_text_file_allow_fail(sg_active_schematic_file(schem_dir));
                }
                rpc_ok(id, {
                    {"port", port},
                    {"git_commit", stonegate::buildinfo::git_commit()},
                    {"build_time", stonegate::buildinfo::build_time_utc_approx()},
                    {"protocol_version", sg_protocol_version()},
                    {"capabilities", sg_capabilities()},
                    {"mode", sim_mode_ ? "sim" : "real/unknown"},
                    {"device_graph_path", device_graph_path_},
                    {"graph_hash", graph_hash},
                    {"schema_hash", schema_hash},
                    {"active_schematic", active_schematic}
                });
                return;
            }

            if (method == "graph.get") {
                const bool include_graph = params.value("include_graph", true);
                const bool include_schema = params.value("include_schema", true);

                if (device_graph_path_.empty() || !std::filesystem::exists(device_graph_path_)) {
                    rpc_ok(id, {
                        {"available", false},
                        {"error", "device_graph_path not configured"},
                        {"device_graph_path", device_graph_path_},
                        {"mode", sim_mode_ ? "sim" : "real/unknown"}
                    });
                    return;
                }

                // Prefer an explicitly-selected schematic if present.
                std::string active_schematic;
                bool using_active = false;
                nlohmann::json graph;
                nlohmann::json schema = nlohmann::json::object();
                std::string graph_hash;
                std::string schema_hash;

                const auto schem_dir = sg_schematics_dir_for_graph(device_graph_path_);
                active_schematic = sg_read_text_file_allow_fail(sg_active_schematic_file(schem_dir));
                if (!active_schematic.empty()) {
                    const auto safe_name = sg_sanitize_schematic_name(active_schematic);
                    const auto file_path = schem_dir / (safe_name + ".json");
                    if (std::filesystem::exists(file_path)) {
                        const auto bytes = sg_read_file(file_path.string());
                        if (!bytes.empty()) {
                            try {
                                const auto doc = nlohmann::json::parse(bytes);
                                if (doc.contains("graph") && doc["graph"].is_object()) {
                                    graph = doc["graph"];
                                    using_active = true;
                                }
                                if (include_schema && doc.contains("schema") && doc["schema"].is_object()) {
                                    schema = doc["schema"];
                                }
                            } catch (...) {
                                using_active = false;
                            }
                        }
                    }
                }

                if (!using_active) {
                    const auto bytes = sg_read_file(device_graph_path_);
                    if (bytes.empty()) {
                        rpc_ok(id, {
                            {"available", false},
                            {"error", "failed to read device graph"},
                            {"device_graph_path", device_graph_path_}
                        });
                        return;
                    }

                    try {
                        graph = nlohmann::json::parse(bytes);
                    } catch (...) {
                        rpc_ok(id, {
                            {"available", false},
                            {"error", "device graph is not valid JSON"},
                            {"device_graph_path", device_graph_path_}
                        });
                        return;
                    }

                    std::filesystem::path p(device_graph_path_);
                    auto schema_path = (p.parent_path() / "ComponentSchema.json").string();
                    std::string schema_bytes;
                    if (include_schema && std::filesystem::exists(schema_path)) {
                        schema_bytes = sg_read_file(schema_path);
                        if (!schema_bytes.empty()) {
                            try {
                                schema = nlohmann::json::parse(schema_bytes);
                            } catch (...) {
                                schema = nlohmann::json::object();
                            }
                        }
                    }

                    graph_hash = sg_fnv1a64_hex(bytes);
                    schema_hash = schema_bytes.empty() ? std::string{} : sg_fnv1a64_hex(schema_bytes);
                } else {
                    graph_hash = graph.is_object() ? sg_fnv1a64_hex(graph.dump()) : std::string{};
                    schema_hash = schema.is_object() ? sg_fnv1a64_hex(schema.dump()) : std::string{};
                }

                rpc_ok(id, {
                    {"available", true},
                    {"protocol_version", sg_protocol_version()},
                    {"mode", sim_mode_ ? "sim" : "real/unknown"},
                    {"device_graph_path", device_graph_path_},
                    {"active_schematic", active_schematic},
                    {"using_active", using_active},
                    {"graph_hash", graph_hash},
                    {"schema_hash", schema_hash},
                    {"graph", include_graph ? graph : nlohmann::json()},
                    {"schema", include_schema ? schema : nlohmann::json()}
                });
                return;
            }

            if (method == "graph.save") {
                const std::string name_in = params.value("name", std::string{});
                const bool overwrite = params.value("overwrite", false);
                if (name_in.empty()) {
                    rpc_ok(id, { {"saved", false}, {"error", "missing name"} });
                    return;
                }
                if (!params.contains("graph") || !params["graph"].is_object()) {
                    rpc_ok(id, { {"saved", false}, {"error", "missing graph object"} });
                    return;
                }
                if (!params.contains("schema") || !params["schema"].is_object()) {
                    rpc_ok(id, { {"saved", false}, {"error", "missing schema object"} });
                    return;
                }
                if (device_graph_path_.empty()) {
                    rpc_ok(id, { {"saved", false}, {"error", "device_graph_path not configured"} });
                    return;
                }

                const auto schem_dir = sg_schematics_dir_for_graph(device_graph_path_);
                if (schem_dir.empty()) {
                    rpc_ok(id, { {"saved", false}, {"error", "schematics dir unavailable"} });
                    return;
                }

                const auto safe_name = sg_sanitize_schematic_name(name_in);
                const auto file_path = schem_dir / (safe_name + ".json");
                try {
                    std::filesystem::create_directories(schem_dir);
                } catch (...) {
                    rpc_ok(id, { {"saved", false}, {"error", "failed to create schematics directory"} });
                    return;
                }
                if (std::filesystem::exists(file_path) && !overwrite) {
                    rpc_ok(id, { {"saved", false}, {"error", "name already exists"}, {"name", safe_name} });
                    return;
                }

                nlohmann::json payload = nlohmann::json::object();
                payload["format"] = "stonegate.schematic";
                payload["version"] = 1;
                payload["name"] = safe_name;
                payload["saved_ts_ms"] = (long long)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
                payload["graph"] = params["graph"];
                payload["schema"] = params["schema"];

                std::string bytes;
                try {
                    bytes = payload.dump(2);
                } catch (...) {
                    rpc_ok(id, { {"saved", false}, {"error", "failed to serialize schematic"} });
                    return;
                }
                // basic size guard
                if (bytes.size() > 8 * 1024 * 1024) {
                    rpc_ok(id, { {"saved", false}, {"error", "schematic too large"} });
                    return;
                }

                try {
                    std::ofstream ofs(file_path, std::ios::binary | std::ios::trunc);
                    if (!ofs) {
                        rpc_ok(id, { {"saved", false}, {"error", "failed to open file"} });
                        return;
                    }
                    ofs.write(bytes.data(), (std::streamsize)bytes.size());
                    ofs.close();
                } catch (...) {
                    rpc_ok(id, { {"saved", false}, {"error", "failed to write file"} });
                    return;
                }

                const std::string graph_hash = sg_fnv1a64_hex(params["graph"].dump());
                const std::string schema_hash = sg_fnv1a64_hex(params["schema"].dump());
                rpc_ok(id, {
                    {"saved", true},
                    {"name", safe_name},
                    {"path", file_path.string()},
                    {"graph_hash", graph_hash},
                    {"schema_hash", schema_hash}
                });
                return;
            }

            if (method == "graph.list") {
                if (device_graph_path_.empty()) {
                    rpc_ok(id, { {"ok", false}, {"error", "device_graph_path not configured"}, {"schematics", nlohmann::json::array()} });
                    return;
                }
                const auto schem_dir = sg_schematics_dir_for_graph(device_graph_path_);
                nlohmann::json out = nlohmann::json::array();
                try {
                    if (std::filesystem::exists(schem_dir)) {
                        for (const auto& ent : std::filesystem::directory_iterator(schem_dir)) {
                            if (!ent.is_regular_file()) continue;
                            const auto p = ent.path();
                            if (p.extension() != ".json") continue;
                            const auto name = p.stem().string();
                            long long mtime_ms = 0;
                            try {
                                const auto ft = std::filesystem::last_write_time(p);
                                const auto sys = std::chrono::time_point_cast<std::chrono::milliseconds>(ft - decltype(ft)::clock::now() + std::chrono::system_clock::now());
                                mtime_ms = (long long)sys.time_since_epoch().count();
                            } catch (...) {
                                mtime_ms = 0;
                            }
                            out.push_back({
                                {"name", name},
                                {"path", p.string()},
                                {"mtime_ms", mtime_ms}
                            });
                        }
                    }
                } catch (...) {
                    // ignore
                }
                rpc_ok(id, { {"ok", true}, {"schematics", out} });
                return;
            }

            if (method == "graph.load") {
                const std::string name_in = params.value("name", std::string{});
                const bool include_graph = params.value("include_graph", true);
                const bool include_schema = params.value("include_schema", true);
                if (device_graph_path_.empty()) {
                    rpc_ok(id, { {"available", false}, {"error", "device_graph_path not configured"} });
                    return;
                }
                if (name_in.empty()) {
                    rpc_ok(id, { {"available", false}, {"error", "missing name"} });
                    return;
                }

                const auto schem_dir = sg_schematics_dir_for_graph(device_graph_path_);
                const auto safe_name = sg_sanitize_schematic_name(name_in);
                const auto file_path = schem_dir / (safe_name + ".json");
                if (!std::filesystem::exists(file_path)) {
                    rpc_ok(id, { {"available", false}, {"error", "not found"}, {"name", safe_name} });
                    return;
                }

                const auto bytes = sg_read_file(file_path.string());
                if (bytes.empty()) {
                    rpc_ok(id, { {"available", false}, {"error", "failed to read file"}, {"name", safe_name} });
                    return;
                }
                nlohmann::json doc;
                try {
                    doc = nlohmann::json::parse(bytes);
                } catch (...) {
                    rpc_ok(id, { {"available", false}, {"error", "invalid json"}, {"name", safe_name} });
                    return;
                }
                nlohmann::json graph = nlohmann::json::object();
                nlohmann::json schema = nlohmann::json::object();
                if (doc.contains("graph") && doc["graph"].is_object()) graph = doc["graph"];
                if (doc.contains("schema") && doc["schema"].is_object()) schema = doc["schema"];

                const std::string graph_hash = graph.is_object() ? sg_fnv1a64_hex(graph.dump()) : std::string{};
                const std::string schema_hash = schema.is_object() ? sg_fnv1a64_hex(schema.dump()) : std::string{};

                rpc_ok(id, {
                    {"available", true},
                    {"name", safe_name},
                    {"path", file_path.string()},
                    {"protocol_version", sg_protocol_version()},
                    {"mode", sim_mode_ ? "sim" : "real/unknown"},
                    {"graph_hash", graph_hash},
                    {"schema_hash", schema_hash},
                    {"graph", include_graph ? graph : nlohmann::json()},
                    {"schema", include_schema ? schema : nlohmann::json()}
                });
                return;
            }

            if (method == "graph.set_active") {
                const std::string name_in = params.value("name", std::string{});
                if (device_graph_path_.empty()) {
                    rpc_ok(id, { {"ok", false}, {"error", "device_graph_path not configured"} });
                    return;
                }
                if (name_in.empty()) {
                    rpc_ok(id, { {"ok", false}, {"error", "missing name"} });
                    return;
                }
                const auto schem_dir = sg_schematics_dir_for_graph(device_graph_path_);
                const auto safe_name = sg_sanitize_schematic_name(name_in);
                try {
                    std::filesystem::create_directories(schem_dir);
                    std::ofstream ofs(sg_active_schematic_file(schem_dir), std::ios::binary | std::ios::trunc);
                    if (!ofs) {
                        rpc_ok(id, { {"ok", false}, {"error", "failed to open active file"} });
                        return;
                    }
                    ofs << safe_name;
                    ofs.close();
                } catch (...) {
                    rpc_ok(id, { {"ok", false}, {"error", "failed to write active file"} });
                    return;
                }
                rpc_ok(id, { {"ok", true}, {"active_schematic", safe_name}, {"restart_required", true} });
                return;
            }
            if (method == "device.action") {
                const auto device_id = params.value("device_id", std::string{});
                if (device_id.empty()) { rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_MISSING_DEVICE_ID), { {"detail", stonegate::errors::D2400_MISSING_DEVICE_ID} }); return; }
                if (!params.contains("action") || !params["action"].is_object()) { rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_MISSING_ACTION), { {"detail", stonegate::errors::D2400_MISSING_ACTION} }); return; }
                auto dev = registry.get_device(device_id);
                if (!dev) { rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_UNKNOWN_DEVICE), { {"detail", stonegate::errors::D2400_UNKNOWN_DEVICE}, {"device_id", device_id} }); return; }
                auto action = params["action"];
                action = map_set_action(dev->type(), action);
                dev->perform_action(action);
                rpc_ok(id, { {"device_id", device_id}, {"applied", true} });
                return;
            }
            if (method == "record.start") {
                if (!recorder) { rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_RECORDER_NOT_INITIALIZED), { {"detail", stonegate::errors::D2400_RECORDER_NOT_INITIALIZED} }); return; }
                try {
                    auto res = recorder->start(params);
                    rpc_ok(id, { {"recording_id", res.recording_id}, {"path", res.path} });
                } catch (const std::exception& e) {
                    const std::string detail = e.what();
                    rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(detail), { {"detail", detail} });
                }
                return;
            }
            if (method == "record.stop") {
                if (!recorder) { rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_RECORDER_NOT_INITIALIZED), { {"detail", stonegate::errors::D2400_RECORDER_NOT_INITIALIZED} }); return; }
                const auto recording_id = params.value("recording_id", std::string{});
                if (recording_id.empty()) { rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_MISSING_RECORDING_ID), { {"detail", stonegate::errors::D2400_MISSING_RECORDING_ID} }); return; }
                auto out = recorder->stop(recording_id);
                if (!out) { rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_UNKNOWN_RECORDING_ID), { {"detail", stonegate::errors::D2400_UNKNOWN_RECORDING_ID}, {"recording_id", recording_id} }); return; }
                rpc_ok(id, {
                    {"recording_id", out->recording_id},
                    {"path", out->path},
                    {"samples_written", out->samples_written},
                    {"started_ts_ms", out->started_ts_ms},
                    {"stopped_ts_ms", out->stopped_ts_ms}
                });
                return;
            }
            if (method == "qec.decode") {
                // Minimal, deterministic stub: majority vote per qubit across measurements.
                // Input loosely follows shared/protocol/MessageTypes.ts QECRequest.
                nlohmann::json req = params;
                nlohmann::json meas = req.value("measurements", nlohmann::json::array());
                if (!meas.is_array()) { rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_QEC_MEASUREMENTS_NOT_ARRAY), { {"detail", stonegate::errors::D2400_QEC_MEASUREMENTS_NOT_ARRAY} }); return; }

                std::unordered_map<int, std::pair<int,int>> counts; // qubit -> {zeros, ones}
                for (const auto& m : meas) {
                    if (!m.is_object()) continue;
                    int q = m.value("qubit", -1);
                    int v = m.value("value", -1);
                    if (q < 0) continue;
                    if (v == 0) counts[q].first += 1;
                    if (v == 1) counts[q].second += 1;
                }
                nlohmann::json corrections = nlohmann::json::array();
                for (const auto& [q, z1] : counts) {
                    int correction = (z1.second > z1.first) ? 1 : 0;
                    corrections.push_back({ {"qubit", q}, {"round", 0}, {"correction", correction} });
                }
                nlohmann::json result = {
                    {"job_id", req.value("job_id", id)},
                    {"status", "done"},
                    {"corrections", corrections},
                    {"statistics", { {"qubits", (int)counts.size()}, {"measurements", (int)meas.size()} } }
                };
                rpc_ok(id, result);
                return;
            }

            if (method == "qec.benchmark") {
                // Backend-owned micro-benchmarking harness for demos.
                // Input loosely follows shared/protocol/MessageTypes.ts QECBenchmarkRequest.
                nlohmann::json req = params;
                const std::string code = req.value("code", std::string{"repetition"});
                double p_flip = 0.01;
                try { if (req.contains("p_flip")) p_flip = req["p_flip"].get<double>(); } catch (...) {}
                p_flip = std::max(0.0, std::min(1.0, p_flip));
                int rounds = 3;
                int shots = 1000;
                try { rounds = std::max(1, req.value("rounds", 3)); } catch (...) {}
                try { shots = std::max(1, req.value("shots", 1000)); } catch (...) {}
                uint64_t seed = 0;
                try { seed = (uint64_t)std::max(0, req.value("seed", 0)); } catch (...) {}

                double raw_error_rate = p_flip;
                double decoded_error_rate = p_flip;

                if (code == "repetition") {
                    // Monte Carlo majority vote over `rounds` measurements.
                    std::mt19937_64 rng(seed ? seed : (uint64_t)std::chrono::high_resolution_clock::now().time_since_epoch().count());
                    std::uniform_real_distribution<double> u(0.0, 1.0);
                    int errs = 0;
                    for (int s = 0; s < shots; ++s) {
                        int ones = 0;
                        for (int r = 0; r < rounds; ++r) {
                            int bit = 0;
                            if (u(rng) < p_flip) bit = 1;
                            ones += bit;
                        }
                        int dec = (ones > (rounds / 2)) ? 1 : 0;
                        if (dec != 0) errs += 1;
                    }
                    decoded_error_rate = (double)errs / (double)std::max(1, shots);
                } else if (code == "surface") {
                    // Heuristic scaling law (not a full decoder): p_L ~ A*(p/p_th)^{(d+1)/2}.
                    // For demos, accept `params.distance`.
                    int d = 3;
                    try {
                        if (req.contains("params") && req["params"].is_object()) {
                            d = std::max(3, req["params"].value("distance", 3));
                        }
                    } catch (...) {
                    }
                    if ((d % 2) == 0) d += 1;
                    const double p_th = 0.01;
                    const double A = 0.1;
                    const double exponent = (double)(d + 1) / 2.0;
                    double pL = A * std::pow(std::max(1e-12, p_flip / p_th), exponent);
                    decoded_error_rate = std::max(0.0, std::min(1.0, pL));
                } else {
                    // Custom: report raw as decoded by default.
                    decoded_error_rate = raw_error_rate;
                }

                nlohmann::json result = {
                    {"job_id", req.value("job_id", id)},
                    {"status", "done"},
                    {"statistics", {
                        {"shots", shots},
                        {"rounds", rounds},
                        {"p_flip", p_flip},
                        {"raw_error_rate", raw_error_rate},
                        {"decoded_error_rate", decoded_error_rate},
                        {"code", code}
                    }}
                };
                rpc_ok(id, result);
                return;
            }

            rpc_error(id, stonegate::errors::E2400_CONTROL_REJECTED, stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_RPC_UNKNOWN_METHOD), { {"detail", stonegate::errors::D2400_RPC_UNKNOWN_METHOD}, {"method", method} });
            return;
        }

        // Unknown message: ignore but optionally ack if it looks like control.
        if (!cmd.empty()) {
            reply({ {"type", "control_ack"}, {"cmd", cmd}, {"ok", false}, {"error", stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_INVALID_REQUEST)} });
        }
    } catch (const std::exception& e) {
        std::cerr << "handle_message error: " << e.what() << std::endl;
    }
}

void WebSocketServer::broadcast_measurements_loop() {
    while (running) {
        try {
            auto msgj = protocol->build_measurement_update();
            auto payload = msgj.dump();
            // send payload to all sessions
            if (impl) {
                impl->for_each_session([&](std::shared_ptr<websocket::stream<tcp::socket>> s){
                    // perform async write on the connection's executor
                    asio::post(s->get_executor(), [s, payload]() {
                        boost::system::error_code ec;
                        s->write(asio::buffer(payload), ec);
                        if (ec) {
                            // ignore write errors here; session read loop will clean up
                        }
                    });
                });
            }
        } catch (const std::exception& e) {
            std::cerr << "broadcast error: " << e.what() << std::endl;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
}