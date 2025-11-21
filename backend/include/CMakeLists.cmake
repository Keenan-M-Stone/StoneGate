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
    src/core/simulator/SimulatedDevice.cpp
    src/core/simulator/Simulator.cpp
    src/devices/ThermocoupleDevice.cpp
    src/devices/PhotonicDetectorDevice.cpp
    src/devices/LN2CoolingControllerDevice.cpp
    src/devices/AncillaQubitDevice.cpp
    src/devices/QuantumRegisterDevice.cpp
    src/devices/PulseSequencerDevice.cpp
    src/devices/QECModuleDevice.cpp
    src/devices/LaserControllerDevice.cpp
    src/core/PhysicsEngine.cpp
)

target_include_directories(core PUBLIC include)

target_link_libraries(core PRIVATE pthread)

# Executable
add_executable(StoneGate src/main.cpp)

add_executable(test_simulator src/test_simulator.cpp)

target_link_libraries(StoneGate PRIVATE core)
target_link_libraries(test_simulator PRIVATE core)

# Optional tests
option(BUILD_TESTS "Build unit tests" OFF)
if(BUILD_TESTS)
    find_package(GTest REQUIRED)
    enable_testing()
    add_executable(phys_engine_tests ../tests/phys_engine_tests.cpp)
    target_include_directories(phys_engine_tests PRIVATE ${CMAKE_SOURCE_DIR}/../include)
    target_link_libraries(phys_engine_tests PRIVATE core GTest::gtest_main pthread)
    add_test(NAME phys_engine_tests COMMAND phys_engine_tests)
endif()

# CI-less test runner (no external test framework)
add_executable(phys_engine_citest ../tests/phys_engine_citest.cpp)
target_include_directories(phys_engine_citest PRIVATE ${CMAKE_SOURCE_DIR}/../include)
target_link_libraries(phys_engine_citest PRIVATE core pthread)
add_test(NAME phys_engine_citest COMMAND phys_engine_citest)

add_executable(devices_citest ../tests/devices_citest.cpp)
target_include_directories(devices_citest PRIVATE ${CMAKE_SOURCE_DIR}/../include)
target_link_libraries(devices_citest PRIVATE core pthread)
add_test(NAME devices_citest COMMAND devices_citest)

add_executable(simulator_citest ../tests/simulator_citest.cpp)
target_include_directories(simulator_citest PRIVATE ${CMAKE_SOURCE_DIR}/../include)
target_link_libraries(simulator_citest PRIVATE core pthread)
add_test(NAME simulator_citest COMMAND simulator_citest)