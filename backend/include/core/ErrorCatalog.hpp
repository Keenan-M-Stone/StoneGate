#pragma once

#include <string>
#include <string_view>

namespace stonegate::errors {

// See docs/Software_Specifications.md "Error messages catalog".
// 2400-2499: WebSocket / control channel errors

inline constexpr int E2400_CONTROL_REJECTED = 2400;
inline constexpr int E2410_SESSION_DROPPED = 2410;

// Message forms per docs/Software_Specifications.md
inline constexpr const char* MSG_E2400_CONTROL_REJECTED_PREFIX = "Error 2400: Control message rejected: ";
inline constexpr const char* MSG_E2410_SESSION_DROPPED = "Error 2410: WebSocket session dropped unexpectedly";

// Common, catalogued detail strings for E2400.
inline constexpr const char* D2400_INVALID_REQUEST = "invalid request";
inline constexpr const char* D2400_RPC_MISSING_ID = "rpc request missing id";
inline constexpr const char* D2400_RPC_MISSING_METHOD = "rpc request missing method";
inline constexpr const char* D2400_RPC_UNKNOWN_METHOD = "unknown rpc method";
inline constexpr const char* D2400_MISSING_DEVICE_ID = "missing params.device_id";
inline constexpr const char* D2400_MISSING_ACTION = "missing params.action";
inline constexpr const char* D2400_UNKNOWN_DEVICE = "unknown device";
inline constexpr const char* D2400_RECORDER_NOT_INITIALIZED = "recorder not initialized";
inline constexpr const char* D2400_RECORD_START_FAILED = "record.start failed";
inline constexpr const char* D2400_MISSING_RECORDING_ID = "missing params.recording_id";
inline constexpr const char* D2400_UNKNOWN_RECORDING_ID = "unknown recording_id";
inline constexpr const char* D2400_QEC_MEASUREMENTS_NOT_ARRAY = "params.measurements must be array";

// Recorder validation / I/O details (kept in catalog to avoid ad-hoc strings crossing RPC boundary).
inline constexpr const char* D2400_RECORD_PARAMS_NOT_OBJECT = "record.start params must be object";
inline constexpr const char* D2400_RECORD_STREAMS_REQUIRED = "record.start requires non-empty streams[]";
inline constexpr const char* D2400_RECORD_STREAM_MISSING_DEVICE_ID = "record.start stream missing device_id";
inline constexpr const char* D2400_RECORD_STREAM_RATE_INVALID = "record.start stream rate_hz must be > 0";
inline constexpr const char* D2400_RECORD_NO_VALID_STREAMS = "record.start: no valid streams";
inline constexpr const char* D2400_RECORD_OPEN_FILE_FAILED = "failed to open recording file";

inline std::string code_string(int code) {
    return std::to_string(code);
}

inline std::string format_E2400_control_rejected(std::string_view detail) {
    std::string out;
    out.reserve(std::char_traits<char>::length(MSG_E2400_CONTROL_REJECTED_PREFIX) + detail.size());
    out.append(MSG_E2400_CONTROL_REJECTED_PREFIX);
    if (detail.empty()) {
        out.append(D2400_INVALID_REQUEST);
    } else {
        out.append(detail.data(), detail.size());
    }
    return out;
}

} // namespace stonegate::errors
