cmake_minimum_required(VERSION 3.16)
project(stonegate_sdk LANGUAGES CXX)

add_library(stonegate_sdk INTERFACE)
target_include_directories(stonegate_sdk INTERFACE ${CMAKE_CURRENT_LIST_DIR}/include)

target_compile_features(stonegate_sdk INTERFACE cxx_std_17)

install(DIRECTORY ${CMAKE_CURRENT_LIST_DIR}/include/ DESTINATION include)
