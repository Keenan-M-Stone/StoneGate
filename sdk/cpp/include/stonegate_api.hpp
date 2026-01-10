// Generated file.
// Do not edit in sdk/. Edit stonegate_api.hpp at repo root instead.
// Regenerate with: python3 tools/generate_stonegate_sdk.py

#pragma once

// StoneGate client helpers for generated macros.
//
// Dependencies:
// - Boost (Asio + Beast WebSocket)
// - nlohmann::json (header-only)
//
// This intentionally mirrors the minimal Python helpers used by Macro Wizard exports.

#include <boost/asio/connect.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <chrono>
#include <limits>
#include <random>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_set>
#include <vector>

namespace stonegate {

namespace beast = boost::beast;
namespace websocket = beast::websocket;
namespace net = boost::asio;
using tcp = net::ip::tcp;
using json = nlohmann::json;

struct WsUrl {
  std::string host;
  std::string port;
  std::string target;
};

inline bool parse_ws_url(const std::string& url, WsUrl& out) {
  // Minimal parser for ws://host:port/path
  std::string s = url;
  const std::string prefix = "ws://";
  if (s.rfind(prefix, 0) != 0) return false;
  s = s.substr(prefix.size());

  std::string hostport;
  auto slash = s.find('/');
  if (slash == std::string::npos) {
    hostport = s;
    out.target = "/";
  } else {
    hostport = s.substr(0, slash);
    out.target = s.substr(slash);
    if (out.target.empty()) out.target = "/";
  }

  auto colon = hostport.find(':');
  if (colon == std::string::npos) {
    out.host = hostport;
    out.port = "80";
  } else {
    out.host = hostport.substr(0, colon);
    out.port = hostport.substr(colon + 1);
    if (out.port.empty()) out.port = "80";
  }

  return !out.host.empty();
}

inline std::string random_id() {
  static thread_local std::mt19937_64 rng{std::random_device{}()};
  static const char* hex = "0123456789abcdef";
  std::string out;
  out.reserve(32);
  for (int i = 0; i < 32; ++i) out.push_back(hex[(rng() >> ((i % 8) * 8)) & 0xF]);
  return out;
}

class Client {
 public:
  explicit Client(std::string ws_url = "ws://localhost:8080/status") : ws_url_(std::move(ws_url)) {
    if (!parse_ws_url(ws_url_, url_)) {
      throw std::runtime_error("Invalid ws url (expected ws://host:port/path): " + ws_url_);
    }
  }

  const std::string& ws_url() const { return ws_url_; }

  json rpc(const std::string& method, const json& params = json::object(), int timeout_ms = 10000) const {
    net::io_context ioc;
    tcp::resolver resolver{ioc};
    websocket::stream<tcp::socket> ws{ioc};

    auto const results = resolver.resolve(url_.host, url_.port);
    net::connect(ws.next_layer(), results);
    ws.set_option(websocket::stream_base::timeout::suggested(beast::role_type::client));
    ws.handshake(url_.host + ":" + url_.port, url_.target);

    const std::string id = std::string("cpp_") + random_id();
    json req = {{"type", "rpc"}, {"id", id}, {"method", method}, {"params", params}};
    ws.write(net::buffer(req.dump()));

    beast::flat_buffer buffer;
    auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);

    for (;;) {
      if (std::chrono::steady_clock::now() >= deadline) {
        throw std::runtime_error("rpc timeout: " + method);
      }

      buffer.consume(buffer.size());
      ws.read(buffer);
      std::string data = beast::buffers_to_string(buffer.data());

      json msg = json::parse(data, nullptr, false);
      if (!msg.is_object()) continue;
      if (msg.value("type", std::string{}) == "rpc_result" && msg.value("id", std::string{}) == id) {
        if (!msg.value("ok", false)) {
          throw std::runtime_error(msg.value("error", json{}).dump());
        }
        return msg.value("result", json::object());
      }
    }
  }

  json poll_all_flat() const {
    json r = rpc("devices.poll", json::object(), 10000);
    json out = json::object();

    const json updates = r.value("updates", json::array());
    if (!updates.is_array()) return out;

    for (const auto& u : updates) {
      if (!u.is_object()) continue;
      const std::string did = u.value("id", std::string{});
      if (did.empty()) continue;

      json meas = u.value("measurement", json::object());
      if (meas.is_object() && meas.contains("measurements") && meas["measurements"].is_object()) {
        meas = meas["measurements"];
      }

      json flat = json::object();
      if (meas.is_object()) {
        for (auto it = meas.begin(); it != meas.end(); ++it) {
          json v = it.value();
          if (v.is_object() && v.contains("value")) v = v["value"];
          flat[it.key()] = v;
        }
      }

      out[did] = flat;
    }

    return out;
  }

  void device_action(const std::string& device_id, const json& action) const {
    (void)rpc("device.action", json{{"device_id", device_id}, {"action", action}}, 20000);
  }

  std::string record_start(const json& params) const {
    json r = rpc("record.start", params, 20000);
    if (r.is_object()) return r.value("recording_id", std::string{});
    return {};
  }

  void record_stop(const std::string& recording_id) const {
    if (recording_id.empty()) return;
    (void)rpc("record.stop", json{{"recording_id", recording_id}}, 20000);
  }

  static bool eval_condition(double latest, const std::string& op, double value) {
    if (op == "<") return latest < value;
    if (op == "<=") return latest <= value;
    if (op == ">") return latest > value;
    if (op == ">=") return latest >= value;
    if (op == "==") return latest == value;
    if (op == "!=") return latest != value;
    return false;
  }

  double get_latest_number(const std::string& device_id, const std::string& metric) const {
    json snap = poll_all_flat();
    if (!snap.is_object() || !snap.contains(device_id)) return std::numeric_limits<double>::quiet_NaN();
    json dev = snap[device_id];
    if (!dev.is_object() || !dev.contains(metric)) return std::numeric_limits<double>::quiet_NaN();

    json v = dev[metric];
    if (v.is_number()) return v.get<double>();
    if (v.is_string()) {
      try {
        return std::stod(v.get<std::string>());
      } catch (...) {
      }
    }
    return std::numeric_limits<double>::quiet_NaN();
  }

  void wait_for_stable(
      const std::string& device_id,
      const std::string& metric,
      double tolerance,
      double window_s,
      int consecutive,
      double timeout_s) const {
    const auto start = std::chrono::steady_clock::now();
    int ok = 0;

    std::vector<double> samples;
    std::vector<double> ts;

    auto now_s = []() {
      return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
    };

    while (std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count() < timeout_s) {
      double v = get_latest_number(device_id, metric);
      const double t = now_s();
      if (std::isfinite(v)) {
        samples.push_back(v);
        ts.push_back(t);
      }

      while (!ts.empty() && (t - ts.front()) > window_s) {
        ts.erase(ts.begin());
        samples.erase(samples.begin());
      }

      if (samples.size() >= 2) {
        auto [min_it, max_it] = std::minmax_element(samples.begin(), samples.end());
        if (std::abs(*max_it - *min_it) <= tolerance) {
          ok += 1;
        } else {
          ok = 0;
        }
        if (ok >= consecutive) return;
      }

      const double sleep_s = std::min(0.5, std::max(0.05, window_s / 4.0));
      std::this_thread::sleep_for(std::chrono::duration<double>(sleep_s));
    }

    throw std::runtime_error("wait_for_stable timeout: " + device_id + ":" + metric);
  }

 private:
  std::string ws_url_;
  WsUrl url_;
};

inline void apply_safe_state(
    const Client& client,
    std::unordered_set<std::string>& active_recording_ids,
    const json& safe_targets) {
  for (auto it = active_recording_ids.begin(); it != active_recording_ids.end();) {
    try {
      client.record_stop(*it);
    } catch (...) {
    }
    it = active_recording_ids.erase(it);
  }

  if (!safe_targets.is_object()) return;
  for (auto it = safe_targets.begin(); it != safe_targets.end(); ++it) {
    const std::string device_id = it.key();
    const json params = it.value();
    if (!params.is_object() || params.empty()) continue;
    try {
      client.device_action(device_id, json{{"set", params}});
    } catch (...) {
      // Best-effort safe-state.
    }
  }
}

}  // namespace stonegate
