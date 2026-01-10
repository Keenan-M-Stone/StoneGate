#pragma once

// StoneGate QEC helpers for generated macros/tools.
//
// This is the C++ companion to `stonegate_qec.py`.
// It intentionally stays small and builds on `stonegate_api.hpp`.
//
// Primary use:
// - Build `measurements` payloads
// - Call the backend `qec.decode` RPC

#include "stonegate_api.hpp"

#include <string>
#include <vector>

namespace stonegate {
namespace qec {

using json = nlohmann::json;

inline json make_measurement(int qubit, const std::string& basis, int round, int value) {
  return json{{"qubit", qubit}, {"basis", basis}, {"round", round}, {"value", value}};
}

inline json decode_via_rpc(
    const stonegate::Client& client,
    const std::string& code,
    const std::vector<json>& measurements,
    const json& extra_params = json::object(),
    int timeout_ms = 20000) {
  json params = json{{"code", code}, {"measurements", measurements}};
  if (extra_params.is_object()) {
    for (auto it = extra_params.begin(); it != extra_params.end(); ++it) {
      params[it.key()] = it.value();
    }
  }
  return client.rpc("qec.decode", params, timeout_ms);
}

}  // namespace qec
}  // namespace stonegate
