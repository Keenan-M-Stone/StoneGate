#pragma once
#include <vector>
#include <complex>

using cplx = std::complex<double>;

class QubitModel {
public:
    QubitModel(int n);

    // Apply a single-qubit gate
    void apply_gate(int qubit, const std::vector<std::vector<cplx>>& matrix);

    // Measure a qubit, returns 0 or 1 probabilistically
    int measure(int qubit);

    // Access full state vector
    const std::vector<cplx>& state_vector() const;

private:
    int n_qubits;
    std::vector<cplx> state;
};
