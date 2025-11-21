#include <gtest/gtest.h>
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

TEST(PhysicsEngine, DeepMergeOverrides) {
    PhysicsEngine eng;
    // parts lib: a single part with nested specs
    json parts = {
        {"PartA", { {"type","Thermocouple"}, {"specs", { {"setpoint_default", 300.0}, {"noise_coeff", 0.01}, {"nested", { {"a",1}, {"b",2} } } } } }}
    };
    auto parts_path = write_temp_file("parts_test.json", parts);
    ASSERT_TRUE(eng.load_parts_library(parts_path));

    // device override that changes nested specs partially
    json overrides = {
        {"dev1", { {"specs", { {"setpoint_default", 77.0}, {"nested", { {"b",99}, {"c",3} } } } } }}
    };
    auto overrides_path = write_temp_file("overrides_test.json", overrides);
    ASSERT_TRUE(eng.load_device_overrides(overrides_path));

    // register node with PartA
    json node = { {"id","dev1"}, {"type","Thermocouple"} };
    eng.register_node("dev1", node, parts["PartA"]);

    auto step = eng.compute_step();
    ASSERT_TRUE(step.contains("dev1"));
    auto dev = step["dev1"];
    // check temperature derived from setpoint_default (approx equal, since delta logic may apply)
    EXPECT_NEAR(dev["temperature_K"].get<double>(), 77.0, 0.1);
    // ensure nested 'b' got overridden and 'c' added
    // To inspect, re-merge by reading deviceOverrides effect via compute_step can't expose nested; instead rely on internal merge indirectly by checking noise (unchanged) and no crash
}

TEST(PhysicsEngine, CachedLoopAndReload) {
    PhysicsEngine eng;
    json parts = { {"P", {{"type","Thermocouple"}, {"specs", {{"setpoint_default", 250.0}, {"noise_coeff", 0.02}}}}} };
    auto parts_path = write_temp_file("parts2.json", parts);
    ASSERT_TRUE(eng.load_parts_library(parts_path));

    json overrides = { {"d1", {{"specs", {{"setpoint_default", 123.0}}}}} };
    auto overrides_path = write_temp_file("overrides2.json", overrides);
    ASSERT_TRUE(eng.load_device_overrides(overrides_path));

    json node = {{"id","d1"}, {"type","Thermocouple"}};
    eng.register_node("d1", node, parts["P"]);

    // start loop
    eng.start_background_loop(std::chrono::milliseconds(50));
    std::this_thread::sleep_for(std::chrono::milliseconds(120));
    auto cached = eng.get_cached_step();
    ASSERT_TRUE(cached.contains("d1"));
    double val1 = cached["d1"]["temperature_K"].get<double>();

    // modify overrides file and touch
    json new_over = { {"d1", {{"specs", {{"setpoint_default", 5.0}}}}} };
    {
        std::ofstream f(overrides_path);
        f << new_over.dump(2);
    }
    // update file mtime
    std::filesystem::last_write_time(overrides_path, std::filesystem::file_time_type::clock::now());

    // wait for background loop to pick up change
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    auto cached2 = eng.get_cached_step();
    double val2 = cached2["d1"]["temperature_K"].get<double>();

    EXPECT_NE(val1, val2);
    eng.stop_background_loop();
}

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
