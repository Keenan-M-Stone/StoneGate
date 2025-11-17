cmake_minimum_required(VERSION 3.16)
project(StoneGate LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Add header-only dependencies (will be populated later)
include_directories(include)

# Core library placeholder
add_library(core
    src/DeviceRegistry.cpp
    src/WebSocketServer.cpp
    src/DescriptorProtocol.cpp
)

target_include_directories(core PUBLIC include)

# Executable
add_executable(StoneGate src/main.cpp)

target_link_libraries(StoneGate PRIVATE core)