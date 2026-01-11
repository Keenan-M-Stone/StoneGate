#include "WebSocketServer.hpp"
#include "DescriptorProtocol.hpp"
#include "DeviceRegistry.hpp"
#include "simulator/SimulatedDevice.hpp"
#include "core/Recorder.hpp"
#include "core/BuildInfo.hpp"
#include "core/ErrorCatalog.hpp"
#include <iostream>
#include <chrono>
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

WebSocketServer::WebSocketServer(int p, DeviceRegistry& reg)
: port(p), running(false), registry(reg) {}

// Implementation details hidden behind PIMPL
struct WebSocketServer::Impl {
    asio::io_context ioc;
    tcp::acceptor acceptor;
    std::mutex sessions_m;
    std::set<std::shared_ptr<websocket::stream<tcp::socket>>> sessions;
    Impl(int port): ioc(), acceptor(ioc) {
        boost::system::error_code ec;
        acceptor.open(tcp::v4(), ec);
        if (ec) {
            std::cerr << "acceptor.open failed: " << ec.message() << std::endl;
        }
        acceptor.set_option(asio::socket_base::reuse_address(true), ec);
        if (ec) {
            std::cerr << "set_option failed: " << ec.message() << std::endl;
        }
        acceptor.bind(tcp::endpoint(tcp::v4(), port), ec);
        if (ec) {
            std::cerr << "bind failed: " << ec.message() << std::endl;
        }
        acceptor.listen(asio::socket_base::max_listen_connections, ec);
        if (ec) {
            std::cerr << "listen failed: " << ec.message() << std::endl;
        }
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
    running = true;
    protocol = std::make_unique<DescriptorProtocol>(registry);
    recorder = std::make_unique<stonegate::Recorder>(registry, port);

    // initialize impl with port and start event loop
    impl = std::make_shared<Impl>(port);

    event_thread = std::thread([this](){ run_event_loop(); });
    broadcast_thread = std::thread([this](){ broadcast_measurements_loop(); });
}

void WebSocketServer::stop() {
    running = false;
    if (event_thread.joinable()) event_thread.join();
    if (broadcast_thread.joinable()) broadcast_thread.join();
    recorder.reset();
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
                        *do_read = [this, ws, buffer, do_read]() {
                            ws->async_read(*buffer, [this, ws, buffer, do_read](boost::system::error_code ec, std::size_t bytes_transferred){
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
                                    handle_message(j, reply);
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
    handle_message(msg, noop);
}

void WebSocketServer::handle_message(const nlohmann::json& msg, const std::function<void(const nlohmann::json&)>& reply) {
    try {
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
                reply({ {"type", "control_ack"}, {"cmd", cmd}, {"ok", false}, {"error", stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_MISSING_DEVICE_ID)} });
                return;
            }
            if (!msg.contains("action") || !msg["action"].is_object()) {
                reply({ {"type", "control_ack"}, {"cmd", cmd}, {"ok", false}, {"error", stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_MISSING_ACTION)} });
                return;
            }
            auto dev = registry.get_device(device_id);
            if (!dev) {
                reply({ {"type", "control_ack"}, {"cmd", cmd}, {"ok", false}, {"error", stonegate::errors::format_E2400_control_rejected(stonegate::errors::D2400_UNKNOWN_DEVICE)}, {"device_id", device_id} });
                return;
            }
            auto action = msg["action"];
            action = map_set_action(dev->type(), action);
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

            if (method == "devices.list") {
                rpc_ok(id, { {"devices", registry.get_descriptor_graph()} });
                return;
            }
            if (method == "devices.poll") {
                rpc_ok(id, { {"updates", registry.poll_all()} });
                return;
            }
            if (method == "backend.info") {
                rpc_ok(id, {
                    {"port", port},
                    {"git_commit", stonegate::buildinfo::git_commit()},
                    {"build_time", stonegate::buildinfo::build_time_utc_approx()}
                });
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
                // Input loosely follows shared/protocol/QECBenchmarkRequest.json.
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