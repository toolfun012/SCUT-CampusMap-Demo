cmake_minimum_required(VERSION 3.10)

project(CampusMapDemo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(campus_map_annotation
    src/campus_map_annotation.cpp
)
