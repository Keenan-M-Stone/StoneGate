#include "../../sdk_sources/stonegate_api.hpp"
#include "../../sdk_sources/stonegate_qec.hpp"

#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/signal_set.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/version.hpp>

#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <optional>
#include <string>
#include <thread>

namespace beast = boost::beast;
namespace http = beast::http;
namespace net = boost::asio;
using tcp = net::ip::tcp;
using json = nlohmann::json;

static double clamp01(double x) {
  if (x < 0.0) return 0.0;
  if (x > 1.0) return 1.0;
  return x;
}

static std::optional<double> json_number(const json& obj, const char* key) {
  if (!obj.is_object() || !obj.contains(key)) return std::nullopt;
  const json& v = obj.at(key);
  if (v.is_number()) return v.get<double>();
  if (v.is_string()) {
    try {
      return std::stod(v.get<std::string>());
    } catch (...) {
      return std::nullopt;
    }
  }
  if (v.is_boolean()) return v.get<bool>() ? 1.0 : 0.0;
  return std::nullopt;
}

static std::string json_string(const json& obj, const char* key, const std::string& def) {
  if (!obj.is_object() || !obj.contains(key)) return def;
  const json& v = obj.at(key);
  if (v.is_string()) return v.get<std::string>();
  return def;
}

static bool json_bool(const json& obj, const char* key, bool def) {
  if (!obj.is_object() || !obj.contains(key)) return def;
  const json& v = obj.at(key);
  if (v.is_boolean()) return v.get<bool>();
  if (v.is_number_integer()) return v.get<int>() != 0;
  if (v.is_string()) {
    const auto s = v.get<std::string>();
    return s == "1" || s == "true" || s == "True";
  }
  return def;
}

static int json_int(const json& obj, const char* key, int def) {
  if (!obj.is_object() || !obj.contains(key)) return def;
  const json& v = obj.at(key);
  if (v.is_number_integer()) return v.get<int>();
  if (v.is_number()) return static_cast<int>(v.get<double>());
  if (v.is_string()) {
    try {
      return std::stoi(v.get<std::string>());
    } catch (...) {
      return def;
    }
  }
  return def;
}

static int recommended_repetition_rounds(double p_flip) {
  // Roughly: noisier hardware => more rounds.
  if (p_flip <= 0.03) return 3;
  if (p_flip <= 0.06) return 5;
  if (p_flip <= 0.12) return 7;
  return 9;
}

static json analyze_once(const json& req, const std::string& default_ws_url) {
  const std::string ws_url = json_string(req, "ws_url", default_ws_url);
  const std::string qec_device_id = json_string(req, "qec_device_id", "qec0");
  const std::string syndrome_device_id = json_string(req, "syndrome_device_id", "syn0");
  const std::string leak_device_id = json_string(req, "leak_device_id", "leak0");

  const bool do_benchmark = json_bool(req, "do_benchmark", true);
  const int shots = json_int(req, "shots", 500);
  const int rounds = json_int(req, "rounds", 0);

  stonegate::Client client(ws_url);
  const json snap = client.poll_all_flat();

  const json qec = snap.value(qec_device_id, json::object());
  const json syn = snap.value(syndrome_device_id, json::object());
  const json leak = snap.value(leak_device_id, json::object());

  const std::optional<double> p_from_syn = json_number(syn, "p_flip");
  const std::optional<double> p_from_qec = json_number(qec, "p_flip");
  const double p_flip = p_from_syn.value_or(p_from_qec.value_or(0.01));

  const std::optional<double> synd_bit_from_syn = json_number(syn, "syndrome_bit");
  const std::optional<double> synd_from_qec = json_number(qec, "syndrome");
  const double syndrome_bit = clamp01(synd_bit_from_syn.value_or(synd_from_qec.value_or(0.0)));

  const double leakage_fraction = clamp01(json_number(leak, "leakage_fraction").value_or(0.0));

  // Normalize: p_flip saturates around ~0.35 in demos.
  const double p_norm = clamp01(p_flip / 0.35);
  const double s_norm = clamp01(syndrome_bit);
  const double leak_norm = clamp01(leakage_fraction);

  const double health = clamp01(1.0 - (0.45 * p_norm + 0.35 * s_norm + 0.20 * leak_norm));

  std::string recommendation = "ok";
  json actions = json::array();
  if (leak_norm >= 0.15) {
    recommendation = "leakage_detected";
    actions.push_back({{"action", "leak.reset"}, {"device_id", leak_device_id}});
  }
  if (p_norm >= 0.45) {
    if (recommendation == "ok") recommendation = "high_noise";
    actions.push_back({{"action", "qec.increase_rounds"}, {"suggested_rounds", recommended_repetition_rounds(p_flip)}});
  }
  if (s_norm >= 0.5) {
    if (recommendation == "ok") recommendation = "syndrome_spike";
    actions.push_back({{"action", "qec.extract_syndrome"}, {"device_id", qec_device_id}});
  }

  json out = {
      {"ws_url", ws_url},
      {"qec_device_id", qec_device_id},
      {"syndrome_device_id", syndrome_device_id},
      {"leak_device_id", leak_device_id},
      {"p_flip", p_flip},
      {"syndrome_bit", syndrome_bit},
      {"leakage_fraction", leakage_fraction},
      {"health_score", health},
      {"recommendation", recommendation},
      {"suggested_rounds", rounds > 0 ? rounds : recommended_repetition_rounds(p_flip)},
      {"actions", actions},
      {"ts_ms", static_cast<std::int64_t>(
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::system_clock::now().time_since_epoch())
                        .count())},
  };

  if (do_benchmark) {
    const int use_rounds = rounds > 0 ? rounds : recommended_repetition_rounds(p_flip);
    try {
      json bench = stonegate::qec::benchmark_via_rpc(
          client,
          "repetition",
          p_flip,
          use_rounds,
          shots,
          json::object(),
          0,
          20000);
      out["benchmark"] = bench;
    } catch (const std::exception& e) {
      out["benchmark_error"] = std::string(e.what());
    }
  }

  return out;
}

static http::response<http::string_body> make_json_response(http::status status, const json& body) {
  http::response<http::string_body> res{status, 11};
  res.set(http::field::server, "stonegate-qec-health-cpp");
  res.set(http::field::content_type, "application/json");
  // Allow browser-based tools (Live Transforms) to call this server from a different origin.
  res.set(http::field::access_control_allow_origin, "*");
  res.set(http::field::access_control_allow_methods, "GET, POST, OPTIONS");
  res.set(http::field::access_control_allow_headers, "Content-Type");
  res.keep_alive(false);
  res.body() = body.dump();
  res.prepare_payload();
  return res;
}

static http::response<http::string_body> handle_request(
    const http::request<http::string_body>& req,
    const std::string& default_ws_url) {
  // Preflight CORS.
  if (req.method() == http::verb::options) {
    http::response<http::string_body> res{http::status::no_content, 11};
    res.set(http::field::server, "stonegate-qec-health-cpp");
    res.set(http::field::access_control_allow_origin, "*");
    res.set(http::field::access_control_allow_methods, "GET, POST, OPTIONS");
    res.set(http::field::access_control_allow_headers, "Content-Type");
    res.keep_alive(false);
    res.body() = "";
    res.prepare_payload();
    return res;
  }

  if (req.method() == http::verb::get && req.target() == "/health") {
    return make_json_response(http::status::ok, json{{"ok", true}});
  }

  if (req.method() == http::verb::post && req.target() == "/analyze/qec_health") {
    json payload = json::object();
    try {
      payload = json::parse(req.body());
    } catch (...) {
      return make_json_response(http::status::bad_request, json{{"error", "invalid JSON"}});
    }

    try {
      json out = analyze_once(payload, default_ws_url);
      return make_json_response(http::status::ok, out);
    } catch (const std::exception& e) {
      return make_json_response(http::status::internal_server_error, json{{"error", std::string(e.what())}});
    }
  }

  return make_json_response(http::status::not_found, json{{"error", "not found"}});
}

static void do_session(tcp::socket socket, const std::string& default_ws_url) {
  beast::error_code ec;

  beast::flat_buffer buffer;
  http::request<http::string_body> req;
  http::read(socket, buffer, req, ec);
  if (ec) return;

  auto res = handle_request(req, default_ws_url);
  http::write(socket, res, ec);

  socket.shutdown(tcp::socket::shutdown_send, ec);
}

int main(int argc, char** argv) {
  std::string listen_host = "127.0.0.1";
  unsigned short listen_port = 8770;
  std::string default_ws_url = "ws://localhost:8080/status";

  for (int i = 1; i < argc; i++) {
    const std::string a = argv[i];
    if (a == "--listen" && i + 1 < argc) {
      listen_host = argv[++i];
    } else if (a == "--port" && i + 1 < argc) {
      listen_port = static_cast<unsigned short>(std::stoi(argv[++i]));
    } else if (a == "--ws" && i + 1 < argc) {
      default_ws_url = argv[++i];
    } else if (a == "--help" || a == "-h") {
      std::cerr << "Usage: " << argv[0] << " [--listen 127.0.0.1] [--port 8770] [--ws ws://localhost:8080/status]\n";
      return 0;
    }
  }

  try {
    net::io_context ioc;

    const auto addr = net::ip::make_address(listen_host);
    tcp::acceptor acceptor{ioc, {addr, listen_port}};

    std::cerr << "[qec_health_server] listening on http://" << listen_host << ":" << listen_port << "\n";
    std::cerr << "[qec_health_server] default ws_url = " << default_ws_url << "\n";

    for (;;) {
      tcp::socket socket{ioc};
      acceptor.accept(socket);
      std::thread{&do_session, std::move(socket), std::cref(default_ws_url)}.detach();
    }
  } catch (const std::exception& e) {
    std::cerr << "Fatal: " << e.what() << "\n";
    return 1;
  }
}
