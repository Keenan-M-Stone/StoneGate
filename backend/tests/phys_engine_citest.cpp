#include <iostream>
#include <cassert>
#include "core/PhysicsEngine.hpp"
#include <nlohmann/json.hpp>
#include <fstream>
#include <filesystem>

using nlohmann::json;

static std::string write_temp_file(const std::string& name, const json& j) {
    std::filesystem::path p = std::filesystem::temp_directory_path() / name;
    std::ofstream f(p);
    f << j.dump(2);
    f.close();
    return p.string();
}

int main() {
    std::cout << "CI-less PhysicsEngine tests starting...\n";
    try {
        PhysicsEngine eng;
        json parts = { {"P", {{"type","Thermocouple"}, {"specs", {{"setpoint_default", 250.0}, {"noise_coeff", 0.02}}}}} };
        auto parts_path = write_temp_file("ci_parts.json", parts);
        bool ok = eng.load_parts_library(parts_path);
        if (!ok) { std::cerr << "load_parts_library failed\n"; return 2; }

        json overrides = { {"d1", {{"specs", {{"setpoint_default", 123.0}}}}} };
        auto overrides_path = write_temp_file("ci_overrides.json", overrides);
        if (!eng.load_device_overrides(overrides_path)) { std::cerr << "load_device_overrides failed\n"; return 3; }

        json node = {{"id","d1"}, {"type","Thermocouple"}};
        eng.register_node("d1", node, parts["P"]);

        eng.start_background_loop(std::chrono::milliseconds(50));
        std::this_thread::sleep_for(std::chrono::milliseconds(120));
        auto cached = eng.get_cached_step();
        if (!cached.contains("d1")) { std::cerr << "cached missing d1\n"; return 4; }
        double val1 = cached["d1"]["temperature_K"].get<double>();

        // modify overrides file
        json new_over = { {"d1", {{"specs", {{"setpoint_default", 5.0}}}}} };
        {
            std::ofstream f(overrides_path);
            f << new_over.dump(2);
        }
        std::filesystem::last_write_time(overrides_path, std::filesystem::file_time_type::clock::now());
        std::this_thread::sleep_for(std::chrono::milliseconds(150));
        auto cached2 = eng.get_cached_step();
        double val2 = cached2["d1"]["temperature_K"].get<double>();
        if (val1 == val2) { std::cerr << "value did not change after override reload\n"; return 5; }

        eng.stop_background_loop();
        std::cout << "CI-less tests passed\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "exception: " << e.what() << std::endl;
        return 1;
    }
}
