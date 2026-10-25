// Must be imported before any module that creates THREE.Color values: the game works in
// "raw" sRGB values end-to-end (textures, vertex colours and output) like classic voxel games.
import * as THREE from '../../lib/three.module.min.js';

THREE.ColorManagement.enabled = false;
