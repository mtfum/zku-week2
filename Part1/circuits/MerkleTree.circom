pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    signal input leaves[2**n];
    signal output root;

    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves
    component poseidon = Poseidon(2**n);
    for (var i = 0; i < 2**n; i++) {
      poseidon.inputs[i] <== leaves[i];
    }

    root <== poseidon.out;
}

template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal

    //[assignment] insert your code here to compute the root from a leaf and elements along the path
    component hashes[n];
    component mux[n];

    signal levelHashes[n+1];
    levelHashes[0] <== leaf;

    for (var i=0; i<n; i++) {
        hashes[i] = CheckRoot(1);
        mux[i] = MultiMux1(2);

        mux[i].c[0][0] <== levelHashes[i];
        mux[i].c[0][1] <== path_elements[i];

        mux[i].c[1][0] <== path_elements[i];
        mux[i].c[1][1] <== levelHashes[i];

        mux[i].s <== path_index[i];
        hashes[i].leaves[0] <== mux[i].out[0];
        hashes[i].leaves[1] <== mux[i].out[1];

        levelHashes[i+1] <== hashes[i].root;
    }

    root <== levelHashes[n];
}