#pragma once

#include <string>

namespace stonegate::buildinfo {

inline std::string git_commit() {
#ifdef STONEGATE_GIT_COMMIT
    return std::string(STONEGATE_GIT_COMMIT);
#else
    return "unknown";
#endif
}

inline std::string build_time_utc_approx() {
    // Not truly UTC, but stable and available without runtime deps.
    return std::string(__DATE__) + " " + std::string(__TIME__);
}

} // namespace stonegate::buildinfo
