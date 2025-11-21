# Top-level CMake for backend; delegates to include/CMakeLists.cmake
cmake_minimum_required(VERSION 3.16)
project(StoneGateBackend)

include(${CMAKE_CURRENT_LIST_DIR}/include/CMakeLists.cmake)
