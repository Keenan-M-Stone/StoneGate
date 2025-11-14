/*
src/backend/reception.cpp
Convert script of steps provided by the frontend into sequence of 
operations to be performed by the device.
*/
#include "backend/reception.h"

namespace qm::backend {

ReceptionManager::ReceptionManager(core::StateCache& cache): cache_(cache) {}

void ReceptionManager::registerRunner(std::shared_ptr<IScriptRunner> r) {
    runners_.push_back(r);
}

bool ReceptionManager::runScript(const std::vector<ScriptInstruction>& script) {
    for (auto &instr: script) {
        bool ok = false;
        for (auto &r: runners_) {
            ok = r->runInstruction(instr, cache_);
            if (ok) break;
        }
        if (!ok) return false; // instruction failed or no runner handled it
    }
    return true;
}

} // namespace qm::backend