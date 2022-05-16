//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { PoseidonT3 } from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves
        hashes = new uint256[](15);
        for (uint256 i = 0; i < 8; i++) {
          hashes[i] = 0;
        }
    }

    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        // [assignment] insert a hashed leaf into the Merkle tree
        uint256 currentIndex = index;
        uint256 currentLevelHash = hashedLeaf;
        uint256 nextIndex = currentIndex;

        uint256 left;
        uint256 right;

        for (uint256 i=0; i < hashes.length; i++) {
          if (currentIndex % 2 == 0) {
            left = currentLevelHash;
            right = 0;
            hashes[i] = currentLevelHash;
          } else {
            left = hashes[i];
            right = currentLevelHash;
        }
          currentLevelHash = PoseidonT3.poseidon([left, right]);
          currentIndex /= 2;
        }

        hashes.push(currentLevelHash);
        root = hashes[index];
        index = nextIndex+1;
        return nextIndex;
    }

    function verify(
            uint[2] memory a,
            uint[2][2] memory b,
            uint[2] memory c,
            uint[1] memory input
        ) public view returns (bool) {
        // [assignment] verify an inclusion proof and check that the proof root matches current root

        return Verifier.verifyProof(a, b, c, input);
    }
}
