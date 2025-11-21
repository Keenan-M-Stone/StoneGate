#include <iostream>
#include <cassert>
#include "devices/ThermocoupleDevice.hpp"
#include "devices/PhotonicDetectorDevice.hpp"
#include "devices/LN2CoolingControllerDevice.hpp"
#include <nlohmann/json.hpp>

using nlohmann::json;

int main() {
    std::cout << "Devices CI-less tests starting...\n";
    try {
        ThermocoupleDevice tc("tc_test");
        auto desc = tc.descriptor();
        if (!desc.contains("type")) { std::cerr << "Thermocouple descriptor missing type\n"; return 2; }
        auto m = tc.read_measurement();
        if (!m.contains("temperature_C")) { std::cerr << "Thermocouple measurement missing temperature_C\n"; return 3; }

        PhotonicDetectorDevice pd("pd_test");
        auto pdesc = pd.descriptor();
        auto pm = pd.read_measurement();
        std::cout << "Photonic detector measurement: " << pm.dump() << std::endl;
        if (!(pm.contains("measurements") || pm.contains("counts"))) { std::cerr << "Photonic detector missing expected fields\n"; return 4; }

        LN2CoolingControllerDevice ln2("ln2_test");
        auto ldesc = ln2.descriptor();
        auto lm = ln2.read_measurement();
        if (!lm.is_object()) { std::cerr << "LN2 read_measurement bad format\n"; return 5; }

        std::cout << "Devices CI-less tests passed\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "exception: " << e.what() << std::endl;
        return 1;
    }
}
