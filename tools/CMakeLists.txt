cmake_minimum_required(VERSION 3.10)
project(stoneg_qec_tools)

find_package(Boost REQUIRED COMPONENTS system)

# If you use a system-installed nlohmann_json as a target, link it. Otherwise, assume header-only.
find_package(nlohmann_json QUIET)

add_executable(toolbox_ws_client toolbox_ws_client.cpp)
target_link_libraries(toolbox_ws_client PRIVATE Boost::system)

if (nlohmann_json_FOUND)
    target_link_libraries(toolbox_ws_client PRIVATE nlohmann_json::nlohmann_json)
endif()
