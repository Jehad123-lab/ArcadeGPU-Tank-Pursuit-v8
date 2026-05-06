import { JOLT_LAYER_MOVING, JOLT_RVEC3_TO_VEC3, VEC3_TO_JOLT_RVEC3, Gfx3Jolt, gfx3JoltManager } from '@lib/gfx3_jolt/gfx3_jolt_manager';
import { Gfx3Mesh } from '@lib/gfx3_mesh/gfx3_mesh';
import { Gfx3MeshJSM } from '@lib/gfx3_mesh/gfx3_mesh_jsm';
import { gfx3MeshRenderer } from '@lib/gfx3_mesh/gfx3_mesh_renderer';
import { Quaternion } from '@lib/core/quaternion';
import { UT } from '@lib/core/utils';
import { createBoxMesh } from './GameUtils';

/**
 * The NPC class represents an AI-controlled tank.
 * It uses static shared meshes for better performance across many instances.
 */
export class NPC {
  static bodyMesh: Gfx3Mesh;
  static turretMesh: Gfx3Mesh;
  static barrelMesh: Gfx3Mesh;
  static trackLMesh: Gfx3Mesh;
  static trackRMesh: Gfx3Mesh;
  static engineMesh: Gfx3Mesh;
  static projMesh: Gfx3Mesh;
  static initialized = false;

  /**
   * Initializes shared meshes for all npc instances.
   * Supports falling back to procedural boxes if JSM files are missing.
   */
  static async initMeshes() {
    if (NPC.initialized) return;
    NPC.initialized = true;
    const chassisColor: [number, number, number] = [0.2, 0.8, 0.2]; // Greenish for friendly NPC 
    const turretColor: [number, number, number] = [0.1, 0.6, 0.1];
    const trackColor: [number, number, number] = [0.15, 0.15, 0.15];
    const engineColor: [number, number, number] = [0.2, 0.2, 0.2];

    // Defaults
    NPC.bodyMesh = createBoxMesh(1.5, 0.6, 2.2, chassisColor);
    NPC.turretMesh = createBoxMesh(1.1, 0.5, 1.1, turretColor);
    NPC.barrelMesh = createBoxMesh(0.2, 0.2, 1.5, [0.2, 0.2, 0.2]);
    NPC.trackLMesh = createBoxMesh(0.4, 0.6, 2.4, trackColor);
    NPC.trackRMesh = createBoxMesh(0.4, 0.6, 2.4, trackColor);
    NPC.engineMesh = createBoxMesh(1.2, 0.4, 0.6, engineColor);
    NPC.projMesh = createBoxMesh(0.6, 0.6, 0.6, [1.0, 0.2, 0.0]);

    // Try high-fidelity override
    try {
      const bJSM = new Gfx3MeshJSM();
      await bJSM.loadFromFile('/models/tank_body.jsm');
      NPC.bodyMesh = bJSM;
    } catch(e) {
      console.warn('NPC: Failed to load JSM models, falling back to boxes.', e);
    }

    NPC.initialized = true;
  }

  physicsBody: any;
  
  rotation: number = 0;
  recoil: number = 0;
  hp: number = 100;
  respawnTimer: number = 0;
  currentUp: vec3 = [0, 1, 0];
  waypoint: vec3 | null = null;
  
  constructor(x: number, y: number, z: number) {
    if (!NPC.initialized) {
       NPC.initMeshes(); 
    }

    this.physicsBody = gfx3JoltManager.addCylinder({
      radius: 1.4, height: 0.6,
      x, y, z,
      motionType: Gfx3Jolt.EMotionType_Dynamic,
      layer: JOLT_LAYER_MOVING,
      settings: { mAngularDamping: 2.0, mLinearDamping: 1.5, mMassPropertiesOverride: 100.0, mAllowedDOFs: 7 }
    });
  }

  update(ts: number, targetPos: any) {
    if (this.hp <= 0) {
        this.respawnTimer -= ts / 1000;
        if (this.respawnTimer <= 0) {
            this.respawn();
        }
        return;
    }

    this.recoil -= (ts / 1000) * 5; 
    if (this.recoil < 0) this.recoil = 0;

    // Jolt Logic
    const pos = this.physicsBody.body.GetPosition();
    
    // World Boundary Clamp
    const mapLimit = 190;
    let clampedX = pos.GetX();
    let clampedZ = pos.GetZ();
    let needsClamp = false;
    
    if (clampedX > mapLimit) { clampedX = mapLimit; needsClamp = true; }
    if (clampedX < -mapLimit) { clampedX = -mapLimit; needsClamp = true; }
    if (clampedZ > mapLimit) { clampedZ = mapLimit; needsClamp = true; }
    if (clampedZ < -mapLimit) { clampedZ = -mapLimit; needsClamp = true; }
    
    if (needsClamp) {
        gfx3JoltManager.bodyInterface.SetPosition(this.physicsBody.body.GetID(), new Gfx3Jolt.RVec3(clampedX, pos.GetY(), clampedZ), Gfx3Jolt.EActivation_Activate);
    }

    const myPos = JOLT_RVEC3_TO_VEC3(pos);
    
    if (!this.waypoint) {
        this.waypoint = [
            myPos[0] + (Math.random() - 0.5) * 40,
            0,
            myPos[2] + (Math.random() - 0.5) * 40
        ];
        // clamp waypoint
        if (this.waypoint[0] > mapLimit) this.waypoint[0] = mapLimit;
        if (this.waypoint[0] < -mapLimit) this.waypoint[0] = -mapLimit;
        if (this.waypoint[2] > mapLimit) this.waypoint[2] = mapLimit;
        if (this.waypoint[2] < -mapLimit) this.waypoint[2] = -mapLimit;
    }
    
    const dx = this.waypoint[0] - myPos[0];
    const dz = this.waypoint[2] - myPos[2];
    const dist = Math.sqrt(dx*dx + dz*dz);
    
    if (dist < 4) {
        this.waypoint = null;
    }
    
    let targetAngle = 0;
    if (this.waypoint) {
        targetAngle = Math.atan2(-dx, -dz);
    }
    
    // Smooth rotation towards target
    const PI2 = Math.PI * 2;
    let angleDiff = (targetAngle - this.rotation) % PI2;
    if (angleDiff > Math.PI) angleDiff -= PI2;
    if (angleDiff < -Math.PI) angleDiff += PI2;
    
    const rotSpeed = 2.0;    
    this.rotation += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), rotSpeed * (ts / 1000));
    
    // Wander - move forward
    const speed = 4;
    let throttle = 1;

    const forward = [-Math.sin(this.rotation), 0, -Math.cos(this.rotation)] as vec3;
    const linVel = UT.VEC3_SCALE(forward, throttle * speed);
    
    const curVel = this.physicsBody.body.GetLinearVelocity();
    const joltLinVel = new Gfx3Jolt.Vec3(linVel[0], curVel.GetY(), linVel[2]);
    gfx3JoltManager.bodyInterface.SetLinearVelocity(this.physicsBody.body.GetID(), joltLinVel);
    
    const curPos = this.physicsBody.body.GetPosition();
    let quat = Quaternion.createFromEuler(this.rotation, 0, 0, 'YXZ');
    
    // Smooth banking
    let targetUp: vec3 = [0, 1, 0];
    const ray = gfx3JoltManager.createRay(curPos.GetX(), curPos.GetY() + 0.5, curPos.GetZ(), curPos.GetX(), curPos.GetY() - 2.0, curPos.GetZ());
    if (ray.normal) {
        targetUp = [ray.normal.GetX(), ray.normal.GetY(), ray.normal.GetZ()];
    }
    
    this.currentUp = UT.VEC3_LERP(this.currentUp, targetUp, 6.0 * (ts / 1000));
    this.currentUp = UT.VEC3_NORMALIZE(this.currentUp);

    const up: vec3 = [0, 1, 0];
    let axis = UT.VEC3_CROSS(up, this.currentUp);
    const dot = UT.VEC3_DOT(up, this.currentUp);
    if (UT.VEC3_LENGTH(axis) > 0.001 && Math.abs(dot) < 0.999) {
        axis = UT.VEC3_NORMALIZE(axis);
        const clampedDot = Math.max(-1, Math.min(1, dot));
        const angle = Math.acos(clampedDot);
        const alignQ = Quaternion.createFromAxisAngle(axis, angle);
        quat = Quaternion.multiply(alignQ, quat);
    }

    const joltQuat = new Gfx3Jolt.Quat(quat.x, quat.y, quat.z, quat.w);
    gfx3JoltManager.bodyInterface.SetRotation(this.physicsBody.body.GetID(), joltQuat, Gfx3Jolt.EActivation_Activate);
  }

  respawn() {
      this.hp = 100;
      const x = (Math.random() - 0.5) * 200;
      const z = (Math.random() - 0.5) * 200;
      gfx3JoltManager.bodyInterface.SetPosition(this.physicsBody.body.GetID(), VEC3_TO_JOLT_RVEC3([x, 5, z]), Gfx3Jolt.EActivation_Activate);
      gfx3JoltManager.bodyInterface.SetLinearVelocity(this.physicsBody.body.GetID(), new Gfx3Jolt.Vec3(0, 0, 0));
      gfx3JoltManager.bodyInterface.SetAngularVelocity(this.physicsBody.body.GetID(), new Gfx3Jolt.Vec3(0, 0, 0));
  }

  draw() {
    const scale: vec3 = [1, 1, 1];
    const ZERO: vec3 = [0,0,0];

    if (this.hp <= 0) return;

    const pos = this.physicsBody.body.GetPosition();
    const currentRot = this.physicsBody.body.GetRotation();
    const q = new Quaternion(currentRot.GetW(), currentRot.GetX(), currentRot.GetY(), currentRot.GetZ());
    const origin: vec3 = [pos.GetX(), pos.GetY(), pos.GetZ()];

    const matBody = UT.MAT4_TRANSFORM(origin, ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(NPC.bodyMesh, matBody);

    const trackOffsetL = q.rotateVector([-0.8, -0.1, 0]);
    const matTrackL = UT.MAT4_TRANSFORM([origin[0] + trackOffsetL[0], origin[1] + trackOffsetL[1], origin[2] + trackOffsetL[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(NPC.trackLMesh, matTrackL);

    const trackOffsetR = q.rotateVector([0.8, -0.1, 0]);
    const matTrackR = UT.MAT4_TRANSFORM([origin[0] + trackOffsetR[0], origin[1] + trackOffsetR[1], origin[2] + trackOffsetR[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(NPC.trackRMesh, matTrackR);

    const engineOffset = q.rotateVector([0, 0.2, 1.2]);
    const matEngine = UT.MAT4_TRANSFORM([origin[0] + engineOffset[0], origin[1] + engineOffset[1], origin[2] + engineOffset[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(NPC.engineMesh, matEngine);

    const turretOffset = q.rotateVector([0, 0.45, 0]);
    const matTurret = UT.MAT4_TRANSFORM([origin[0] + turretOffset[0], origin[1] + turretOffset[1], origin[2] + turretOffset[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(NPC.turretMesh, matTurret);

    const visualRecoil = this.recoil > 0 ? this.recoil * 0.3 : 0;
    const barrelRelativePos = q.rotateVector([0, 0, -0.8 + visualRecoil]);
    const matBarrel = UT.MAT4_TRANSFORM([origin[0] + turretOffset[0] + barrelRelativePos[0], origin[1] + turretOffset[1] + barrelRelativePos[1], origin[2] + turretOffset[2] + barrelRelativePos[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(NPC.barrelMesh, matBarrel);
  }
}

