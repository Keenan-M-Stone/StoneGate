cmake_minimum_required(VERSION 3.10)
project(stoneg_qec_tools)

find_package(CURL REQUIRED)
find_package(Boost REQUIRED COMPONENTS system)

add_executable(qec_client qec_client.cpp)
target_include_directories(qec_client PRIVATE ${CURL_INCLUDE_DIR})
target_link_libraries(qec_client PRIVATE ${CURL_LIBRARIES})

# If you use a system-installed nlohmann_json as a target, link it. Otherwise, assume header-only.
find_package(nlohmann_json QUIET)
if (nlohmann_json_FOUND)
    target_link_libraries(qec_client PRIVATE nlohmann_json::nlohmann_json)
endif()

add_executable(toolbox_ws_client toolbox_ws_client.cpp)
target_link_libraries(toolbox_ws_client PRIVATE Boost::system)

if (nlohmann_json_FOUND)
    target_link_libraries(toolbox_ws_client PRIVATE nlohmann_json::nlohmann_json)
endif()
