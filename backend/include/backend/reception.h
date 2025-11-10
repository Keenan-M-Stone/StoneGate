#pragma once
#include <string>
#include <functional>
#include "core/state_cache.h"

namespace qm::backend {

struct ScriptInstruction {
    std::string op; // e.g., "run_circuit", "deploy_probe", "set_temp"
    std::unordered_map<std::string, std::string> params; // key-value args
};

class IScriptRunner {
public:
    virtual ~IScriptRunner() = default;
    // run a single instruction (blocking until complete or error)
    virtual bool runInstruction(const ScriptInstruction& instr, core::StateCache& cache) = 0;
};

class ReceptionManager {
public:
    ReceptionManager(core::StateCache& cache);
    void registerRunner(std::shared_ptr<IScriptRunner> r);
    // run a script (sequence of instructions)
    bool runScript(const std::vector<ScriptInstruction>& script);
private:
    core::StateCache& cache_;
    std::vector<std::shared_ptr<IScriptRunner>> runners_;
};

} // namespace qm::backend