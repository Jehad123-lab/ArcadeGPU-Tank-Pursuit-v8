import { JOLT_LAYER_MOVING, JOLT_RVEC3_TO_VEC3, Gfx3Jolt, gfx3JoltManager } from '@lib/gfx3_jolt/gfx3_jolt_manager';
import { Gfx3Mesh } from '@lib/gfx3_mesh/gfx3_mesh';
import { Gfx3MeshJSM } from '@lib/gfx3_mesh/gfx3_mesh_jsm';
import { gfx3MeshRenderer } from '@lib/gfx3_mesh/gfx3_mesh_renderer';
import { Quaternion } from '@lib/core/quaternion';
import { UT } from '@lib/core/utils';
import { createBoxMesh } from './GameUtils';

/**
 * The Enemy class represents an AI-controlled tank.
 * It uses static shared meshes for better performance across many instances.
 */
export class Enemy {
  static bodyMesh: Gfx3Mesh;
  static turretMesh: Gfx3Mesh;
  static barrelMesh: Gfx3Mesh;
  static trackLMesh: Gfx3Mesh;
  static trackRMesh: Gfx3Mesh;
  static engineMesh: Gfx3Mesh;
  static projMesh: Gfx3Mesh;
  static initialized = false;

  /**
   * Initializes shared meshes for all enemy instances.
   * Supports falling back to procedural boxes if JSM files are missing.
   */
  static async initMeshes() {
    if (Enemy.initialized) return;
    Enemy.initialized = true;
    const chassisColor: [number, number, number] = [0.8, 0.2, 0.2]; 
    const turretColor: [number, number, number] = [0.6, 0.1, 0.1];
    const trackColor: [number, number, number] = [0.15, 0.15, 0.15];
    const engineColor: [number, number, number] = [0.2, 0.2, 0.2];

    // Defaults
    Enemy.bodyMesh = createBoxMesh(1.5, 0.6, 2.2, chassisColor);
    Enemy.turretMesh = createBoxMesh(1.1, 0.5, 1.1, turretColor);
    Enemy.barrelMesh = createBoxMesh(0.2, 0.2, 1.5, [0.2, 0.2, 0.2]);
    Enemy.trackLMesh = createBoxMesh(0.4, 0.6, 2.4, trackColor);
    Enemy.trackRMesh = createBoxMesh(0.4, 0.6, 2.4, trackColor);
    Enemy.engineMesh = createBoxMesh(1.2, 0.4, 0.6, engineColor);
    Enemy.projMesh = createBoxMesh(0.6, 0.6, 0.6, [1.0, 0.2, 0.0]);

    // Try high-fidelity override
    try {
      const bJSM = new Gfx3MeshJSM();
      await bJSM.loadFromFile('/models/tank_body.jsm');
      Enemy.bodyMesh = bJSM;
    } catch(e) {
      console.warn('Enemy: Failed to load JSM models, falling back to boxes.', e);
    }

    Enemy.initialized = true;
  }

  physicsBody: any;
  
  rotation: number = 0;
  recoil: number = 0;
  shootCooldown: number = 0;
  hp: number = 100;
  currentUp: vec3 = [0, 1, 0];
  
  projectiles: { body: any, life: number, rot: Quaternion, lastVel: [number, number, number] }[] = [];

  constructor(x: number, y: number, z: number) {
    // Note: initMeshes should be called externally to wait for async loading
    if (!Enemy.initialized) {
       Enemy.initMeshes(); 
    }

    this.physicsBody = gfx3JoltManager.addBox({
      width: 1.5, height: 0.6, depth: 2.2,
      x, y, z,
      motionType: Gfx3Jolt.EMotionType_Dynamic,
      layer: JOLT_LAYER_MOVING,
      settings: { mAngularDamping: 2.0, mLinearDamping: 1.5, mMassPropertiesOverride: 100.0 }
    });
  }


  update(ts: number, targetPos: any): { didShoot: boolean, muzzlePos?: vec3, dir?: vec3 } {
    // Update projectiles ALWAYS, even if dead
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
       const p = this.projectiles[i];
       p.life -= (ts / 1000);
       
       if (p.life <= 0) {
          gfx3JoltManager.remove(p.body.bodyId);
          this.projectiles.splice(i, 1);
       } else {
          const curV = p.body.body.GetLinearVelocity();
          p.lastVel = [curV.GetX(), curV.GetY(), curV.GetZ()];
       }
    }

    if (this.hp <= 0) return { didShoot: false };

    this.recoil -= (ts / 1000) * 5; 
    if (this.recoil < 0) this.recoil = 0;
    
    this.shootCooldown -= ts / 1000;

    // Jolt Logic
    const pos = this.physicsBody.body.GetPosition();
    const myPos = JOLT_RVEC3_TO_VEC3(pos);
    
    const dx = targetPos[0] - myPos[0];
    const dz = targetPos[2] - myPos[2];
    const dist = Math.sqrt(dx*dx + dz*dz);
    
    const targetAngle = Math.atan2(-dx, -dz);
    
    // Smooth rotation towards target
    const PI2 = Math.PI * 2;
    let angleDiff = (targetAngle - this.rotation) % PI2;
    if (angleDiff > Math.PI) angleDiff -= PI2;
    if (angleDiff < -Math.PI) angleDiff += PI2;
    
    const rotSpeed = 2.0;    
    this.rotation += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), rotSpeed * (ts / 1000));
    
    // Simple Chase - Stop when close
    const speed = 6;
    let throttle = 0;
    if (dist > 15) {
        throttle = 1; // Move forward
    } else if (dist < 10) {
        throttle = -0.5; // Back up a bit
    }

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
    
    let didShoot = false;
    let muzzlePos: vec3 | undefined = undefined;
    let dir: vec3 | undefined = undefined;

    // Shoot Logic
    if (dist < 40 && Math.abs(angleDiff) < 0.2 && this.shootCooldown <= 0) {
        const shootData = this.shoot(quat);
        muzzlePos = shootData.muzzlePos;
        dir = shootData.dir;
        this.shootCooldown = 2.0; // 2 sec cooldown
        this.recoil = 1.0;
        didShoot = true;
    }
    
    return { didShoot, muzzlePos, dir };
  }
  
  shoot(q: Quaternion): { muzzlePos: vec3, dir: vec3 } {
    const direction = q.rotateVector([0, 0, -1]); 
    const currentRot = this.physicsBody.body.GetRotation();
    const bodyQ = new Quaternion(currentRot.GetW(), currentRot.GetX(), currentRot.GetY(), currentRot.GetZ());
    
    const visualRecoil = this.recoil > 0 ? this.recoil * 0.3 : 0;
    const barrelRelativePos = bodyQ.rotateVector([0, 0, -0.8 + visualRecoil]);
    const pos = this.physicsBody.body.GetPosition();
    const bPos = [pos.GetX() + barrelRelativePos[0], pos.GetY() + 0.45 + barrelRelativePos[1], pos.GetZ() + barrelRelativePos[2]];

    const startPos = [
      bPos[0] + direction[0] * 1.5,
      bPos[1] + direction[1] * 1.5,
      bPos[2] + direction[2] * 1.5,
    ];
    
    const pBody = gfx3JoltManager.addBox({
      width: 0.6, height: 0.6, depth: 0.6,
      x: startPos[0], y: startPos[1], z: startPos[2],
      motionType: Gfx3Jolt.EMotionType_Dynamic,
      layer: JOLT_LAYER_MOVING,
      settings: { 
          mMassPropertiesOverride: 0.01, 
          mRestitution: 0.0,
          mMotionQuality: Gfx3Jolt.EMotionQuality_LinearCast
      }
    });
    
    // Add arced motion similar to artillery/grenades
    const forwardSpeed = 35; // slightly slower than player
    const upwardVelocity = 15;
    const pVel = new Gfx3Jolt.Vec3(
      direction[0] * forwardSpeed, 
      (direction[1] * forwardSpeed) + upwardVelocity, 
      direction[2] * forwardSpeed
    );
    gfx3JoltManager.bodyInterface.SetLinearVelocity(pBody.body.GetID(), pVel);
    
    const recoilForce = new Gfx3Jolt.Vec3(-direction[0] * 500, -direction[1] * 500, -direction[2] * 500);
    gfx3JoltManager.bodyInterface.AddImpulse(this.physicsBody.body.GetID(), recoilForce);
    
    this.projectiles.push({ body: pBody, life: 3.0, rot: q, lastVel: [pVel.GetX(), pVel.GetY(), pVel.GetZ()] });
    
    return {
       muzzlePos: [startPos[0], startPos[1], startPos[2]] as vec3,
       dir: [direction[0], direction[1], direction[2]] as vec3
    };
  }

  draw() {
    const scale: vec3 = [1, 1, 1];
    const ZERO: vec3 = [0,0,0];

    // Always draw projectiles
    for (const p of this.projectiles) {
       const pPos = p.body.body.GetPosition();
       const pRot = p.body.body.GetRotation();
       const pQ = new Quaternion(pRot.GetW(), pRot.GetX(), pRot.GetY(), pRot.GetZ());
       const matProj = UT.MAT4_TRANSFORM([pPos.GetX(), pPos.GetY(), pPos.GetZ()], ZERO, scale, pQ);
       gfx3MeshRenderer.drawMesh(Enemy.projMesh, matProj);
    }
    
    if (this.hp <= 0) return;

    const pos = this.physicsBody.body.GetPosition();
    const currentRot = this.physicsBody.body.GetRotation();
    const q = new Quaternion(currentRot.GetW(), currentRot.GetX(), currentRot.GetY(), currentRot.GetZ());
    const origin: vec3 = [pos.GetX(), pos.GetY(), pos.GetZ()];

    const matBody = UT.MAT4_TRANSFORM(origin, ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.bodyMesh, matBody);

    const trackOffsetL = q.rotateVector([-0.8, -0.1, 0]);
    const matTrackL = UT.MAT4_TRANSFORM([origin[0] + trackOffsetL[0], origin[1] + trackOffsetL[1], origin[2] + trackOffsetL[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.trackLMesh, matTrackL);

    const trackOffsetR = q.rotateVector([0.8, -0.1, 0]);
    const matTrackR = UT.MAT4_TRANSFORM([origin[0] + trackOffsetR[0], origin[1] + trackOffsetR[1], origin[2] + trackOffsetR[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.trackRMesh, matTrackR);

    const engineOffset = q.rotateVector([0, 0.2, 1.2]);
    const matEngine = UT.MAT4_TRANSFORM([origin[0] + engineOffset[0], origin[1] + engineOffset[1], origin[2] + engineOffset[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.engineMesh, matEngine);

    const turretOffset = q.rotateVector([0, 0.45, 0]);
    const matTurret = UT.MAT4_TRANSFORM([origin[0] + turretOffset[0], origin[1] + turretOffset[1], origin[2] + turretOffset[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.turretMesh, matTurret);

    const visualRecoil = this.recoil > 0 ? this.recoil * 0.3 : 0;
    const barrelRelativePos = q.rotateVector([0, 0, -0.8 + visualRecoil]);
    const matBarrel = UT.MAT4_TRANSFORM([origin[0] + turretOffset[0] + barrelRelativePos[0], origin[1] + turretOffset[1] + barrelRelativePos[1], origin[2] + turretOffset[2] + barrelRelativePos[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.barrelMesh, matBarrel);
  }
}
