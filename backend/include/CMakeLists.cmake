cmake_minimum_required(VERSION 3.16)
project(StoneGate LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Embed git commit hash when building from a git checkout (best-effort).
set(STONEGATE_GIT_COMMIT "unknown")
execute_process(
    COMMAND git -C ${CMAKE_CURRENT_LIST_DIR}/.. rev-parse --short HEAD
    OUTPUT_VARIABLE _STONEGATE_GIT_COMMIT
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
    RESULT_VARIABLE _STONEGATE_GIT_COMMIT_RC
)
if(_STONEGATE_GIT_COMMIT_RC EQUAL 0 AND NOT "${_STONEGATE_GIT_COMMIT}" STREQUAL "")
    set(STONEGATE_GIT_COMMIT "${_STONEGATE_GIT_COMMIT}")
endif()

# Add header-only dependencies (will be populated later)
include_directories(include)

# Core library placeholder
add_library(core
    src/DeviceRegistry.cpp
    src/WebSocketServer.cpp
    src/DescriptorProtocol.cpp
    src/core/simulator/SimulatedDevice.cpp
    src/core/simulator/Simulator.cpp
    src/core/Recorder.cpp
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

target_compile_definitions(core PRIVATE STONEGATE_GIT_COMMIT="${STONEGATE_GIT_COMMIT}")

target_link_libraries(core PRIVATE pthread)
find_package(Boost REQUIRED COMPONENTS system)
if(Boost_FOUND)
    target_include_directories(core PRIVATE ${Boost_INCLUDE_DIRS})
    target_link_libraries(core PRIVATE Boost::system)
endif()

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
    add_executable(phys_engine_tests tests/phys_engine_tests.cpp)
    target_include_directories(phys_engine_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
    target_link_libraries(phys_engine_tests PRIVATE core GTest::gtest_main pthread)
    add_test(NAME phys_engine_tests COMMAND phys_engine_tests)
endif()

# CI-less test runner (no external test framework)
add_executable(phys_engine_citest tests/phys_engine_citest.cpp)
target_include_directories(phys_engine_citest PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(phys_engine_citest PRIVATE core pthread)
add_test(NAME phys_engine_citest COMMAND phys_engine_citest)

add_executable(devices_citest tests/devices_citest.cpp)
target_include_directories(devices_citest PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(devices_citest PRIVATE core pthread)
add_test(NAME devices_citest COMMAND devices_citest)

add_executable(simulator_citest tests/simulator_citest.cpp)
target_include_directories(simulator_citest PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(simulator_citest PRIVATE core pthread)
add_test(NAME simulator_citest COMMAND simulator_citest)