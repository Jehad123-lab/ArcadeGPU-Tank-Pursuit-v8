import { gfx3JoltManager, JOLT_LAYER_NON_MOVING, Gfx3Jolt, JOLT_LAYER_MOVING } from '@lib/gfx3_jolt/gfx3_jolt_manager';
import { Gfx3Mesh } from '@lib/gfx3_mesh/gfx3_mesh';
import { gfx3MeshRenderer } from '@lib/gfx3_mesh/gfx3_mesh_renderer';
import { UT } from '@lib/core/utils';
import { Quaternion } from '@lib/core/quaternion';
import { createBoxMesh, createTerrainMesh, generateHeightmapCanvas } from './GameUtils';

export class Environment {
  floor: Gfx3Mesh;
  static meshesInitialized = false;
  static qMat = new Quaternion();
  
  static wallBaseN: Gfx3Mesh;
  static wallBaseS: Gfx3Mesh;
  static wallBaseE: Gfx3Mesh;
  static wallBaseW: Gfx3Mesh;
  
  static treeTrunk: Gfx3Mesh;
  static treeLeaves: Gfx3Mesh;
  static building: Gfx3Mesh;
  static sandWall: Gfx3Mesh;
  static crateMesh: Gfx3Mesh;
  static cloudMesh: Gfx3Mesh;
  
  decorations: { type: string, pos: vec3, scale: vec3 }[] = [];
  clouds: { pos: vec3, scale: vec3, nextX: number }[] = [];
  crates: { body: any }[] = [];

  constructor() {
    if (!Environment.meshesInitialized) {
      Environment.wallBaseN = createBoxMesh(400, 40, 20, [0.3, 0.4, 0.3]);
      Environment.wallBaseS = createBoxMesh(400, 40, 20, [0.3, 0.4, 0.3]);
      Environment.wallBaseE = createBoxMesh(20, 40, 400, [0.3, 0.4, 0.3]);
      Environment.wallBaseW = createBoxMesh(20, 40, 400, [0.3, 0.4, 0.3]);
      
      Environment.treeTrunk = createBoxMesh(1, 1, 1, [0.4, 0.25, 0.1]); // 1x1x1 scaled
      Environment.treeLeaves = createBoxMesh(1, 1, 1, [0.2, 0.6, 0.1]); 
      Environment.building = createBoxMesh(1, 1, 1, [0.55, 0.55, 0.6]); 
      Environment.sandWall = createBoxMesh(1, 1, 1, [0.6, 0.55, 0.45]);
      Environment.crateMesh = createBoxMesh(2, 2, 2, [0.6, 0.4, 0.2]); // Fix size to map physics
      Environment.cloudMesh = createBoxMesh(1, 1, 1, [0.9, 0.9, 0.95]); 
      
      Environment.meshesInitialized = true;
    }

    const canvas = generateHeightmapCanvas(256, 256);
    const terrainData = createTerrainMesh(400, 400, 32, 32, [0.25, 0.45, 0.2], canvas);
    this.floor = terrainData.mesh;
    
    gfx3JoltManager.addPolygonShape({
        vertices: terrainData.vertices,
        indexes: terrainData.indexes,
        x: 0, y: 0, z: 0,
        motionType: Gfx3Jolt.EMotionType_Static,
        layer: JOLT_LAYER_NON_MOVING
    });

    // Generate mountains/walls at the edges
    const mapSize = 400;
    const borderThickness = 20;
    const borderHeight = 40;
    
    // North wall
    this.decorations.push({ type: 'wallN', pos: [0, borderHeight / 2 - 1, -mapSize / 2], scale: [1,1,1]});
    gfx3JoltManager.addBox({
        width: mapSize, height: borderHeight, depth: borderThickness,
        x: 0, y: borderHeight / 2 - 1, z: -mapSize / 2,
        motionType: Gfx3Jolt.EMotionType_Static,
        layer: JOLT_LAYER_NON_MOVING
    });

    // South wall
    this.decorations.push({ type: 'wallS', pos: [0, borderHeight / 2 - 1, mapSize / 2], scale: [1,1,1]});
    gfx3JoltManager.addBox({
        width: mapSize, height: borderHeight, depth: borderThickness,
        x: 0, y: borderHeight / 2 - 1, z: mapSize / 2,
        motionType: Gfx3Jolt.EMotionType_Static,
        layer: JOLT_LAYER_NON_MOVING
    });

    // East wall
    this.decorations.push({ type: 'wallE', pos: [mapSize / 2, borderHeight / 2 - 1, 0], scale: [1,1,1]});
    gfx3JoltManager.addBox({
        width: borderThickness, height: borderHeight, depth: mapSize,
        x: mapSize / 2, y: borderHeight / 2 - 1, z: 0,
        motionType: Gfx3Jolt.EMotionType_Static,
        layer: JOLT_LAYER_NON_MOVING
    });

    // West wall
    this.decorations.push({ type: 'wallW', pos: [-mapSize / 2, borderHeight / 2 - 1, 0], scale: [1,1,1]});
    gfx3JoltManager.addBox({
        width: borderThickness, height: borderHeight, depth: mapSize,
        x: -mapSize / 2, y: borderHeight / 2 - 1, z: 0,
        motionType: Gfx3Jolt.EMotionType_Static,
        layer: JOLT_LAYER_NON_MOVING
    });

    // Generate cityscape / buildings / trees
    for (let i = 0; i < 50; i++) {
        const x = (Math.random() - 0.5) * 350;
        const z = (Math.random() - 0.5) * 350;
        
        // Clear space near spawn
        if (Math.abs(x) < 20 && Math.abs(z) < 20) continue;
        
        const type = Math.random();
        
        if (type < 0.4) {
            // Tree
            const trunkHeight = 2 + Math.random() * 2;
            this.decorations.push({ type: 'trunk', pos: [x, trunkHeight / 2, z], scale: [0.8, trunkHeight, 0.8] });
            
            // Leaves
            const leavesHeight = 3 + Math.random() * 2;
            const leavesSize = 3 + Math.random();
            this.decorations.push({ type: 'leaves', pos: [x, trunkHeight + leavesHeight / 2 - 0.5, z], scale: [leavesSize, leavesHeight, leavesSize] });
            
            gfx3JoltManager.addBox({
                width: 1.5, height: 10, depth: 1.5,
                x, y: 5, z,
                motionType: Gfx3Jolt.EMotionType_Static,
                layer: JOLT_LAYER_NON_MOVING
            });
        } else if (type < 0.7) {
            // Building
            const width = 10 + Math.random() * 15;
            const depth = 10 + Math.random() * 15;
            const height = 10 + Math.random() * 25;
            this.decorations.push({ type: 'building', pos: [x, height / 2, z], scale: [width, height, depth] });
            
            gfx3JoltManager.addBox({
                width, height, depth,
                x, y: height / 2, z,
                motionType: Gfx3Jolt.EMotionType_Static,
                layer: JOLT_LAYER_NON_MOVING
            });
        } else {
            // Random Wall / Obstacle
            const width = 5 + Math.random() * 10;
            const depth = 2 + Math.random() * 3;
            const height = 3 + Math.random() * 5;
            const isRotated = Math.random() > 0.5;
            
            const wallW = isRotated ? depth : width;
            const wallD = isRotated ? width : depth;
            
            this.decorations.push({ type: 'sandWall', pos: [x, height / 2, z], scale: [wallW, height, wallD] });
            
            gfx3JoltManager.addBox({
                width: wallW, height, depth: wallD,
                x, y: height / 2, z,
                motionType: Gfx3Jolt.EMotionType_Static,
                layer: JOLT_LAYER_NON_MOVING
            });
        }
    }
    
    // Add physics crates
    for (let i = 0; i < 30; i++) {
        this.addCrate(
            (Math.random() - 0.5) * 60, 
            5 + Math.random() * 15, 
            (Math.random() - 0.5) * 60
        );
    }
    
    // Add clouds
    for (let i = 0; i < 20; i++) {
        const cx = (Math.random() - 0.5) * 400;
        const cy = 40 + Math.random() * 20;
        const cz = (Math.random() - 0.5) * 400;
        const cw = 15 + Math.random() * 20;
        const ch = 4 + Math.random() * 4;
        const cd = 10 + Math.random() * 15;
        this.clouds.push({ pos: [cx, cy, cz], nextX: cx, scale: [cw, ch, cd] });
    }
  }
  
  addCrate(x: number, y: number, z: number) {
      const body = gfx3JoltManager.addBox({
          width: 2, height: 2, depth: 2,
          x, y, z,
          motionType: Gfx3Jolt.EMotionType_Dynamic,
          layer: JOLT_LAYER_MOVING,
          settings: { mMassPropertiesOverride: 10 }
      });
      this.crates.push({ body });
  }
  
  update(ts: number) {
      // Animate clouds
      for (const cloud of this.clouds) {
          cloud.nextX += (ts / 1000) * 5; // Move slightly in X
          if (cloud.nextX > 200) {
              cloud.nextX = -200; // loop back
          }
      }
  }

  draw(cameraPos: vec3) {
    this.floor.draw();
    
    for (const dec of this.decorations) {
        const ZERO: vec3 = [0,0,0];
        const mat = UT.MAT4_TRANSFORM(dec.pos, ZERO, dec.scale, Environment.qMat);
        let mesh = Environment.sandWall;
        if (dec.type === 'trunk') mesh = Environment.treeTrunk;
        else if (dec.type === 'leaves') mesh = Environment.treeLeaves;
        else if (dec.type === 'building') mesh = Environment.building;
        else if (dec.type === 'wallN') mesh = Environment.wallBaseN;
        else if (dec.type === 'wallS') mesh = Environment.wallBaseS;
        else if (dec.type === 'wallE') mesh = Environment.wallBaseE;
        else if (dec.type === 'wallW') mesh = Environment.wallBaseW;
        
        gfx3MeshRenderer.drawMesh(mesh, mat);
    }
    for (const cloud of this.clouds) {
        const ZERO: vec3 = [0,0,0];
        const mat = UT.MAT4_TRANSFORM([cloud.nextX, cloud.pos[1], cloud.pos[2]], ZERO, cloud.scale, Environment.qMat);
        gfx3MeshRenderer.drawMesh(Environment.cloudMesh, mat);
    }
    
    const crateScale: vec3 = [1,1,1];
    for (const crate of this.crates) {
        const pos = crate.body.body.GetPosition();
        const rot = crate.body.body.GetRotation();
        const rotQ = new Quaternion(rot.GetW(), rot.GetX(), rot.GetY(), rot.GetZ());
        const ZERO: vec3 = [0,0,0];
        const mat = UT.MAT4_TRANSFORM([pos.GetX(),pos.GetY(),pos.GetZ()], ZERO, crateScale, rotQ);
        gfx3MeshRenderer.drawMesh(Environment.crateMesh, mat);
    }
  }
}
