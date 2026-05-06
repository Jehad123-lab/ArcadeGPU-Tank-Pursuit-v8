import { gfx3JoltManager, JOLT_LAYER_MOVING, Gfx3Jolt } from '@lib/gfx3_jolt/gfx3_jolt_manager';
import { Gfx3Mesh } from '@lib/gfx3_mesh/gfx3_mesh';
import { Gfx3MeshJSM } from '@lib/gfx3_mesh/gfx3_mesh_jsm';
import { gfx3MeshRenderer } from '@lib/gfx3_mesh/gfx3_mesh_renderer';
import { Quaternion } from '@lib/core/quaternion';
import { UT } from '@lib/core/utils';
import { createBoxMesh } from './GameUtils';

/**
 * The Tank class represents the player-controlled vehicle.
 * It manages multiple mesh components (body, turret, barrel, etc.)
 * and integrates with Jolt Physics for movement.
 */
export class Tank {
  body: Gfx3Mesh;
  turret: Gfx3Mesh;
  barrel: Gfx3Mesh;
  trackL: Gfx3Mesh;
  trackR: Gfx3Mesh;
  engine: Gfx3Mesh;
  hatch: Gfx3Mesh;
  antenna: Gfx3Mesh;
  physicsBody: any;
  velocity: number = 0;
  rotation: number = 0;
  recoil: number = 0;
  turretYaw: number = 0;
  wasFiringInternal: boolean = false;
  currentUp: vec3 = [0, 1, 0];
  
  // Bullets instances
  projectiles: { body: any, life: number, rot: Quaternion, type: 'normal' | 'grenade', lastVel: [number, number, number] }[] = [];

  static projMesh: Gfx3Mesh | null = null;
  static projGrenadeMesh: Gfx3Mesh | null = null;

  constructor() {
    const chassisColor: [number, number, number] = [0.4, 0.5, 0.3];
    const turretColor: [number, number, number] = [0.35, 0.45, 0.25];
    const trackColor: [number, number, number] = [0.15, 0.15, 0.15];
    const engineColor: [number, number, number] = [0.2, 0.2, 0.2];

    // Initial placeholders until JSM models load
    this.body = createBoxMesh(2.25, 0.9, 3.3, chassisColor);
    this.turret = createBoxMesh(1.65, 0.75, 1.65, turretColor);
    this.barrel = createBoxMesh(0.3, 0.3, 2.25, [0.2, 0.2, 0.2]);
    this.trackL = createBoxMesh(0.6, 0.9, 3.6, trackColor);
    this.trackR = createBoxMesh(0.6, 0.9, 3.6, trackColor);
    this.engine = createBoxMesh(1.8, 0.6, 0.9, engineColor);
    this.hatch = createBoxMesh(0.6, 0.15, 0.6, [0.15, 0.15, 0.15]);
    this.antenna = createBoxMesh(0.05, 1.5, 0.05, [0.1, 0.1, 0.1]);

    if (!Tank.projMesh) {
      // Shape it more like a bullet/shell: slightly thicker, not just a thin long box, maybe standard spherical or shorter box.
      // E.g., 0.3 x 0.3 x 0.8
      Tank.projMesh = createBoxMesh(0.5, 0.5, 1.2, [1.0, 0.8, 0.2]);
    }
    if (!Tank.projGrenadeMesh) {
      Tank.projGrenadeMesh = createBoxMesh(0.5, 0.5, 0.5, [0.2, 0.2, 0.2]);
    }

    this.physicsBody = gfx3JoltManager.addBox({
      width: 3.45, height: 0.9, depth: 3.6,
      x: 0, y: 0.5, z: 0,
      motionType: Gfx3Jolt.EMotionType_Dynamic,
      layer: JOLT_LAYER_MOVING,
      settings: { mAngularDamping: 1.0, mLinearDamping: 0.5, mMassPropertiesOverride: 100.0, mAllowedDOFs: 7 }
    });
  }

  /**
   * Loads high-fidelity JSM models for the tank components.
   */
  async load() {
    const bodyJSM = new Gfx3MeshJSM();
    const turretJSM = new Gfx3MeshJSM();
    const barrelJSM = new Gfx3MeshJSM();

    try {
      await Promise.all([
        bodyJSM.loadFromFile('/models/tank_body.jsm'),
        turretJSM.loadFromFile('/models/tank_turret.jsm'),
        barrelJSM.loadFromFile('/models/tank_barrel.jsm')
      ]);

      this.body = bodyJSM;
      this.turret = turretJSM;
      this.barrel = barrelJSM;
    } catch (e) {
      console.warn('Failed to load JSM models, falling back to procedural boxes.', e);
    }
  }

  /**
   * Updates physics and syncs mesh transforms.
   */
  update(ts: number, moveDir: { x: number, y: number }, fireType: 'none' | 'normal' | 'grenade' = 'none', cameraYaw: number = 0, cameraPitch: number = 0): false | 'normal' | 'grenade' {
    const speed = 15;
    const rotSpeed = 3.5;

    let didShoot: false | 'normal' | 'grenade' = false;
    if (fireType !== 'none') {
        if (this.recoil <= 0) {
            this.shoot(fireType);
            this.recoil = 1.0;
            didShoot = fireType;
        }
        this.wasFiringInternal = true;
    } else {
        this.wasFiringInternal = false;
    }

    this.recoil -= (ts / 1000) * 5; 
    if (this.recoil < 0) this.recoil = 0;
    
    // Steering Logic
    this.rotation -= moveDir.x * rotSpeed * (ts / 1000); 
    
    const throttle = moveDir.y;
    const targetVelocity = throttle * speed;
    const accelRate = throttle !== 0 ? 0.05 : 0.1;
    this.velocity = UT.LERP(this.velocity, targetVelocity, accelRate);

    // Physics Update
    const forward = [-Math.sin(this.rotation), 0, -Math.cos(this.rotation)] as vec3;
    const linVel = UT.VEC3_SCALE(forward, this.velocity);
    
    const curVel = this.physicsBody.body.GetLinearVelocity();
    const joltLinVel = new Gfx3Jolt.Vec3(linVel[0], curVel.GetY(), linVel[2]);
    gfx3JoltManager.bodyInterface.SetLinearVelocity(this.physicsBody.body.GetID(), joltLinVel);
    
    const pos = this.physicsBody.body.GetPosition();
    let quat = Quaternion.createFromEuler(this.rotation, 0, 0, 'YXZ');
    
    // Cast rays from 4 corners down to find the ground normal for smooth banking
    const hw = 1.4; // Half-width
    const hd = 1.6; // Half-depth

    const sinYaw = Math.sin(this.rotation);
    const cosYaw = Math.cos(this.rotation);
    const fx = -sinYaw, fz = -cosYaw;
    const rx = cosYaw, rz = -sinYaw;
    
    const cx = pos.GetX();
    const cy = pos.GetY();
    const cz = pos.GetZ();

    const getHitPoint = (dx: number, dz: number): vec3 => {
      const wx = cx + rx * dx + fx * dz;
      const wz = cz + rz * dx + fz * dz;
      const ray = gfx3JoltManager.createRay(wx, cy, wz, wx, cy - 3.0, wz);
      if (ray.fraction < 1.0) {
        return [wx, cy - ray.fraction * 3.0, wz];
      }
      return [wx, cy - 1.5, wz]; 
    };

    const fl = getHitPoint(-hw, hd);
    const fr = getHitPoint(hw, hd);
    const bl = getHitPoint(-hw, -hd);
    const br = getHitPoint(hw, -hd);

    const vecFront = UT.VEC3_SCALE(UT.VEC3_ADD(fl, fr), 0.5);
    const vecBack = UT.VEC3_SCALE(UT.VEC3_ADD(bl, br), 0.5);
    const vecLeft = UT.VEC3_SCALE(UT.VEC3_ADD(fl, bl), 0.5);
    const vecRight = UT.VEC3_SCALE(UT.VEC3_ADD(fr, br), 0.5);

    const vForward = UT.VEC3_NORMALIZE(UT.VEC3_SUBSTRACT(vecFront, vecBack));
    const vRight = UT.VEC3_NORMALIZE(UT.VEC3_SUBSTRACT(vecRight, vecLeft));

    let targetUp = UT.VEC3_CROSS(vRight, vForward);
    
    if (UT.VEC3_LENGTH(targetUp) < 0.001) {
       targetUp = [0, 1, 0];
    } else {
       targetUp = UT.VEC3_NORMALIZE(targetUp);
       if (targetUp[1] < 0) targetUp = UT.VEC3_SCALE(targetUp, -1);
    }
    
    // Smoothly lerp the current up vector towards the ground normal
    this.currentUp = UT.VEC3_LERP(this.currentUp, targetUp, 6.0 * (ts / 1000));
    this.currentUp = UT.VEC3_NORMALIZE(this.currentUp);

    const up: vec3 = [0, 1, 0];
    let axis = UT.VEC3_CROSS(up, this.currentUp);
    const dot = UT.VEC3_DOT(up, this.currentUp);
    // Only align if there's a valid angle
    if (UT.VEC3_LENGTH(axis) > 0.001 && Math.abs(dot) < 0.999) {
        axis = UT.VEC3_NORMALIZE(axis);
        const clampedDot = Math.max(-1, Math.min(1, dot));
        const angle = Math.acos(clampedDot);
        const alignQ = Quaternion.createFromAxisAngle(axis, angle);
        quat = Quaternion.multiply(alignQ, quat); // Multiply align * yaw
    }

    const joltQuat = new Gfx3Jolt.Quat(quat.x, quat.y, quat.z, quat.w);
    // Physics body rotation is locked via mAllowedDOFs = 7. Visuals rotate using `quat`.

    // Sync Mesh Positions
    const q = quat;

    this.body.setPosition(pos.GetX(), pos.GetY(), pos.GetZ());
    this.body.setQuaternion(q);

    // Component Offsets
    const trackOffsetL = q.rotateVector([-1.425, -0.15, 0]);
    this.trackL.setPosition(pos.GetX() + trackOffsetL[0], pos.GetY() + trackOffsetL[1], pos.GetZ() + trackOffsetL[2]);
    this.trackL.setQuaternion(q);

    const trackOffsetR = q.rotateVector([1.425, -0.15, 0]);
    this.trackR.setPosition(pos.GetX() + trackOffsetR[0], pos.GetY() + trackOffsetR[1], pos.GetZ() + trackOffsetR[2]);
    this.trackR.setQuaternion(q);

    const engineOffset = q.rotateVector([0, 0.3, 1.8]);
    this.engine.setPosition(pos.GetX() + engineOffset[0], pos.GetY() + engineOffset[1], pos.GetZ() + engineOffset[2]);
    this.engine.setQuaternion(q);

    // Turret follows body tilt but has independent yaw
    // We want the turret to smoothly turn to face cameraYaw.
    // Calculate the shortest angle path
    let yawDiff = cameraYaw - this.turretYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    
    const turretTraverseSpeed = 1.5; // rad per second
    const traverseAmount = turretTraverseSpeed * (ts / 1000);
    
    if (Math.abs(yawDiff) < traverseAmount) {
        this.turretYaw = cameraYaw;
    } else {
        this.turretYaw += Math.sign(yawDiff) * traverseAmount;
    }
    
    const localYaw = (this.turretYaw - this.rotation);
    const localYawQ = Quaternion.createFromEuler(localYaw, 0, 0, 'YXZ');
    const turretQ = Quaternion.multiply(q, localYawQ);
    
    // Apply pitch exclusively to the barrel/turret gun
    // Note: To pitch up, we rotate around X axis.
    const pitchQ = Quaternion.createFromEuler(0, cameraPitch, 0, 'YXZ'); // pitch is X axis rotation
    const barrelQ = Quaternion.multiply(turretQ, pitchQ);

    const turretOffset = q.rotateVector([0, 0.675, 0]);
    this.turret.setPosition(pos.GetX() + turretOffset[0], pos.GetY() + turretOffset[1], pos.GetZ() + turretOffset[2]);
    this.turret.setQuaternion(turretQ);

    const visualRecoil = this.recoil > 0 ? this.recoil * 0.45 : 0;
    const barrelRelativePos = barrelQ.rotateVector([0, 0, -1.2 + visualRecoil]);
    const turretPos = this.turret.getPosition();
    this.barrel.setPosition(turretPos[0] + barrelRelativePos[0], turretPos[1] + barrelRelativePos[1], turretPos[2] + barrelRelativePos[2]);
    this.barrel.setQuaternion(barrelQ);
    
    const hatchOffset = turretQ.rotateVector([0, 0.375 + 0.075, 0.3]);
    this.hatch.setPosition(turretPos[0] + hatchOffset[0], turretPos[1] + hatchOffset[1], turretPos[2] + hatchOffset[2]);
    this.hatch.setQuaternion(turretQ);
    
    const antennaOffset = turretQ.rotateVector([-0.6, 0.375 + 0.75, 0.6]);
    this.antenna.setPosition(turretPos[0] + antennaOffset[0], turretPos[1] + antennaOffset[1], turretPos[2] + antennaOffset[2]);
    this.antenna.setQuaternion(turretQ);
    
    // Projectile Lifecycle
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
       const p = this.projectiles[i];
       p.life -= (ts / 1000);
       
       if (p.life <= 0) {
          gfx3JoltManager.remove(p.body.bodyId);
          this.projectiles.splice(i, 1);
       } else {
          const curV = p.body.body.GetLinearVelocity();
          p.lastVel = [curV.GetX(), curV.GetY(), curV.GetZ()];
          
          if (p.type === 'normal') {
             // For normal bullets, make rotation match velocity
             const velLen = Math.sqrt(p.lastVel[0]*p.lastVel[0] + p.lastVel[1]*p.lastVel[1] + p.lastVel[2]*p.lastVel[2]);
             if (velLen > 0.1) {
                 const dir = [-p.lastVel[0]/velLen, -p.lastVel[1]/velLen, -p.lastVel[2]/velLen]; // -Z is forward
                 const up: vec3 = [0, 1, 0];
                 const right = UT.VEC3_NORMALIZE(UT.VEC3_CROSS(up, dir));
                 const newUp = UT.VEC3_CROSS(dir, right);
                 
                 // Create rotation matrix manually or just use lookAt
                 // For now, let's keep it simple: normal bullets don't tumble.
                 const yaw = Math.atan2(dir[0], dir[2]);
                 const pitch = Math.asin(Math.max(-1, Math.min(1, dir[1])));
                 
                 // Apply yaw and pitch
                 const qPitch = Quaternion.createFromAxisAngle([1, 0, 0], -pitch);
                 const qYaw = Quaternion.createFromAxisAngle([0, 1, 0], yaw);
                 p.rot = Quaternion.multiply(qYaw, qPitch);
             }
          }
       }
    }
    
    return didShoot;
  }
  
  /**
   * Spawns a projectile from the barrel.
   */
  shoot(type: 'normal' | 'grenade' = 'normal') {
    const q = this.barrel.getQuaternion();
    const direction = q.rotateVector([0, 0, -1]); 
    const bPos = this.barrel.getPosition();
    const startPos = [
      bPos[0] + direction[0] * 1.5,
      bPos[1] + direction[1] * 1.5,
      bPos[2] + direction[2] * 1.5,
    ];
    
    const pBody = gfx3JoltManager.addBox({
      width: 0.5, height: 0.5, depth: type === 'grenade' ? 0.6 : 1.2,
      x: startPos[0], y: startPos[1], z: startPos[2],
      motionType: Gfx3Jolt.EMotionType_Dynamic,
      layer: JOLT_LAYER_MOVING,
      settings: { 
          mMassPropertiesOverride: 0.01, 
          mRestitution: 0.0,
          mMotionQuality: Gfx3Jolt.EMotionQuality_LinearCast 
      }
    });
    
    let forwardSpeed = 50; // Slower, visible bullets
    let upwardVelocity = 0.5; // slight arc for normal fire
    
    if (type === 'grenade') {
        forwardSpeed = 25;
        upwardVelocity = 15;
    }
    
    const pVel = new Gfx3Jolt.Vec3(
      direction[0] * forwardSpeed, 
      (direction[1] * forwardSpeed) + upwardVelocity, 
      direction[2] * forwardSpeed
    );
    gfx3JoltManager.bodyInterface.SetLinearVelocity(pBody.body.GetID(), pVel);

    if (type === 'grenade') {
        const angVel = new Gfx3Jolt.Vec3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
        gfx3JoltManager.bodyInterface.SetAngularVelocity(pBody.body.GetID(), angVel);
    }
    
    // Tank no longer receives hard physics recoil from shooting to avoid camera jump
    
    this.projectiles.push({ body: pBody, life: 3.0, rot: q, type, lastVel: [pVel.GetX(), pVel.GetY(), pVel.GetZ()] });
  }

  /**
   * Renders all tank components and active projectiles.
   */
  draw() {
    this.body.draw();
    this.trackL.draw();
    this.trackR.draw();
    this.engine.draw();
    this.turret.draw();
    this.barrel.draw();
    this.hatch.draw();
    this.antenna.draw();
    
    if (Tank.projMesh && Tank.projGrenadeMesh) {
      for (const p of this.projectiles) {
         const meshToDraw = p.type === 'grenade' ? Tank.projGrenadeMesh : Tank.projMesh;
         const scale: [number, number, number] = p.type === 'grenade' ? [1.5, 1.5, 1.5] : [1, 1, 1];
         const pPos = p.body.body.GetPosition();
         let q = p.rot;
         if (p.type === 'grenade') {
             const pRot = p.body.body.GetRotation();
             q = new Quaternion(pRot.GetW(), pRot.GetX(), pRot.GetY(), pRot.GetZ());
         }
         
         const ZERO: [number, number, number] = [0,0,0];
         const matProj = UT.MAT4_TRANSFORM([pPos.GetX(), pPos.GetY(), pPos.GetZ()], ZERO, scale, q);
         gfx3MeshRenderer.drawMesh(meshToDraw, matProj);
      }
    }
  }
}

