cmake_minimum_required(VERSION 3.16)
project(PhysicsEngineTests)

# Find GoogleTest
find_package(GTest REQUIRED)
include_directories(${GTEST_INCLUDE_DIRS})

add_executable(phys_engine_tests
    phys_engine_tests.cpp
)

target_include_directories(phys_engine_tests PRIVATE ../include)

target_link_libraries(phys_engine_tests PRIVATE ${GTEST_BOTH_LIBRARIES} pthread)
