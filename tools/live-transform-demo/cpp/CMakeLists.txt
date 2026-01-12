cmake_minimum_required(VERSION 3.16)
project(stonegate_live_transforms_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Boost REQUIRED COMPONENTS system)
find_package(nlohmann_json REQUIRED)

add_executable(stonegate_qec_health_server qec_health_server.cpp)

target_link_libraries(stonegate_qec_health_server PRIVATE Boost::system nlohmann_json::nlohmann_json)

# Boost.Beast is header-only; threads are required.
set(THREADS_PREFER_PTHREAD_FLAG ON)
find_package(Threads REQUIRED)
target_link_libraries(stonegate_qec_health_server PRIVATE Threads::Threads)
