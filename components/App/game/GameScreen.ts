/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useState, useRef } from 'react';
import { em } from '@lib/engine/engine_manager';
import { screenManager } from '@lib/screen/screen_manager';
import { Screen } from '@lib/screen/screen';
import { gfx3Manager } from '@lib/gfx3/gfx3_manager';
import { gfx3MeshRenderer } from '@lib/gfx3_mesh/gfx3_mesh_renderer';
import { gfx3PostRenderer, PostParam } from '@lib/gfx3_post/gfx3_post_renderer';
import { gfx3JoltManager, JOLT_LAYER_MOVING, JOLT_RVEC3_TO_VEC3, VEC3_TO_JOLT_RVEC3, Gfx3Jolt } from '@lib/gfx3_jolt/gfx3_jolt_manager';
import { Gfx3Camera } from '@lib/gfx3_camera/gfx3_camera';
import { Gfx3Mesh } from '@lib/gfx3_mesh/gfx3_mesh';
import { Quaternion } from '@lib/core/quaternion';
import { UT } from '@lib/core/utils';
import { eventManager } from '@lib/core/event_manager';
import { Gfx3Drawable, Gfx3MeshEffect } from '@lib/gfx3/gfx3_drawable';
import { inputManager } from '@lib/input/input_manager';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, Bomb, LogIn, LogOut } from 'lucide-react';
import { Tank } from './Tank';
import { Environment } from './Environment';
import { Enemy } from './Enemy';
import { Explosion } from './Explosion';
import { createBoxMesh } from './GameUtils';

export class GameScreen extends Screen {
  camera: Gfx3Camera;
  tank: Tank;
  level: Environment;
  enemies: Enemy[] = [];
  explosions: Explosion[] = [];
  moveDir = { x: 0, y: 0 };
  virtualFire: 'none' | 'normal' | 'grenade' = 'none';
  wasFiring = false;
  
  cameraYaw = 0; 
  cameraPitch = 0.2;
  cameraDistance = 8;
  isReady: boolean = false;
  cameraLookTarget: vec3 = [0, 0, 0];
  rightClickFire: boolean = false;
  projectiles: any[] = [];
  
  constructor() {
    super();
    this.camera = new Gfx3Camera(0);
    this.tank = new Tank();
    this.level = new Environment();
    
    // Spawn some enemies
    for (let i = 0; i < 15; i++) {
       const x = (Math.random() - 0.5) * 200;
       const z = (Math.random() - 0.5) * 200;
       if (Math.abs(x) < 20 && Math.abs(z) < 20) continue;
       this.enemies.push(new Enemy(x, 2, z));
    }

    if (typeof window !== 'undefined') {
       window.addEventListener('pointerdown', this.handleGlobalPointerDown);
       window.addEventListener('pointerup', this.handleGlobalPointerUp);
    }
  }

  handleGlobalPointerDown = (e: PointerEvent) => {
    if (e.button === 2) { // Right click
      if (inputManager.isPointerLockCaptured()) {
         this.rightClickFire = true;
      }
    }
  };

  handleGlobalPointerUp = (e: PointerEvent) => {
    if (e.button === 2) {
      this.rightClickFire = false;
    }
  };

  async onEnter() {
    gfx3PostRenderer.setParam(PostParam.PIXELATION_ENABLED, 0.0);
    
    // Load Models
    await Promise.all([
      this.tank.load(),
      Enemy.initMeshes()
    ]);
    
    // Desktop Controls
    inputManager.registerAction('keyboard', 'KeyW', 'THR_FWD');
    inputManager.registerAction('keyboard', 'KeyS', 'THR_BWD');
    inputManager.registerAction('keyboard', 'KeyA', 'STR_LFT');
    inputManager.registerAction('keyboard', 'KeyD', 'STR_RGT');
    inputManager.registerAction('keyboard', 'KeyQ', 'CAM_L');
    inputManager.registerAction('keyboard', 'KeyC', 'CAM_R');
    inputManager.registerAction('keyboard', 'KeyR', 'CAM_Z_IN');
    inputManager.registerAction('keyboard', 'KeyF', 'CAM_Z_OUT');
    inputManager.registerAction('keyboard', 'Space', 'FIRE');

    inputManager.setPointerLockEnabled(true);
    eventManager.subscribe(inputManager, 'E_MOUSE_MOVE', this, this.handleMouseMove);

    this.camera.setPosition(0, 10, -10);
    this.camera.lookAt(0, 0, 0);
    this.camera.getView().setBgColor(0.53, 0.81, 0.92, 1.0); // Sky blue
    
    const tankPos = this.tank.body.getPosition();
    this.cameraLookTarget = [tankPos[0], tankPos[1] + 1.5, tankPos[2]];
    this.isReady = true;
  }

  handleMouseMove = (data: any) => {
    if (inputManager.isPointerLockCaptured() || inputManager.isMouseDown()) {
       this.cameraYaw -= data.movementX * 0.005;
       this.cameraPitch += data.movementY * 0.005;
       
       // Limit pitch to avoid flipping over and going way below ground
       this.cameraPitch = Math.max(-0.1, Math.min(Math.PI / 2 - 0.1, this.cameraPitch));
    }
  };

  spawnProjectile(owner: any, type: 'normal' | 'grenade') {
    const isPlayer = owner === this.tank;
    
    // Calculate barrel pos & direction
    let bPos, dir;
    if (isPlayer) {
        bPos = this.tank.barrel.getPosition();
        const bRot = this.tank.barrel.getQuaternion();
        dir = bRot.rotateVector([0, 0, -1]);
    } else {
        const ownerPos = owner.physicsBody.body.GetPosition();
        const currentRot = owner.physicsBody.body.GetRotation();
        const bRot = new Quaternion(currentRot.GetW(), currentRot.GetX(), currentRot.GetY(), currentRot.GetZ());
        const visualRecoil = owner.recoil > 0 ? owner.recoil * 0.3 : 0;
        const barrelRelativePos = bRot.rotateVector([0, 0, -0.8 + visualRecoil]);
        bPos = [ownerPos.GetX() + barrelRelativePos[0], ownerPos.GetY() + 0.45 + barrelRelativePos[1], ownerPos.GetZ() + barrelRelativePos[2]];
        const tempPitch = Quaternion.createFromEuler(0, 0.05, 0, 'YXZ');
        const firingRot = Quaternion.multiply(bRot, tempPitch);
        dir = firingRot.rotateVector([0, 0, -1]);
    }
    dir = UT.VEC3_NORMALIZE(dir);
    
    const spawnDist = type === 'grenade' ? 4.5 : 3.5;
    let bulletX = bPos[0] + dir[0] * spawnDist;
    let bulletY = bPos[1] + dir[1] * spawnDist;
    let bulletZ = bPos[2] + dir[2] * spawnDist;

    if (isPlayer) {
        const tPos = this.tank.body.getPosition();
        let dx = bulletX - tPos[0];
        let dz = bulletZ - tPos[2];
        const dist2D = Math.sqrt(dx*dx + dz*dz);
        const minDist = 3.0;
        if (dist2D < minDist) {
            if (dist2D < 0.001) { dx = dir[0] || 1; dz = dir[2] || 0; }
            const normDist = Math.sqrt(dx*dx + dz*dz);
            bulletX = tPos[0] + (dx / normDist) * minDist;
            bulletZ = tPos[2] + (dz / normDist) * minDist;
        }
    }

    const startPos = [bulletX, Math.max(0.5, bulletY), bulletZ];

    const pBody = gfx3JoltManager.addBox({
      width: 0.15, height: 0.15, depth: type === 'grenade' ? 0.3 : 0.6,
      x: startPos[0], y: startPos[1], z: startPos[2],
      motionType: Gfx3Jolt.EMotionType_Dynamic,
      layer: JOLT_LAYER_MOVING,
      settings: { mIsSensor: true, mMassPropertiesOverride: 0.05, mRestitution: 0.0, mGravityFactor: type === 'grenade' ? 1.5 : 0.2 }
    });

    const speed = isPlayer ? (type === 'grenade' ? 35 : 100) : (type === 'grenade' ? 30 : 60);
    const upVel = type === 'grenade' ? 15 : (isPlayer ? 0.0 : 2.0);
    const pVel = new Gfx3Jolt.Vec3(dir[0] * speed, (dir[1] * speed) + upVel, dir[2] * speed);
    gfx3JoltManager.bodyInterface.SetLinearVelocity(pBody.body.GetID(), pVel);

    this.projectiles.push({
        body: pBody,
        life: 4.0,
        age: 0,
        owner: owner,
        type: type,
        lastVel: [pVel.GetX(), pVel.GetY(), pVel.GetZ()]
    });

    // Muzzle Effect
    const muzzlePos = [startPos[0] + dir[0] * 1.5, startPos[1] + dir[1] * 1.5, startPos[2] + dir[2] * 1.5] as vec3;
    const muzzleColor: [number, number, number] = type === 'grenade' ? [1.0, 0.5, 0.2] : [1.0, 0.9, 0.4];
    this.spawnExplosion(muzzlePos[0], muzzlePos[1], muzzlePos[2], muzzleColor, dir, type === 'grenade' ? 1.5 : 0.8, 'muzzle');
  }

  spawnExplosion(x: number, y: number, z: number, color?: [number, number, number], dir?: vec3, scale: number = 1.0, type: any = 'normal') {
    this.explosions.push(new Explosion(x, y, z, color, dir, scale, type));
  }

  update(ts: number) {
    inputManager.update(ts);
    gfx3JoltManager.update(ts);

    if (inputManager.isActiveAction('CAM_L')) this.cameraYaw -= 0.05;
    if (inputManager.isActiveAction('CAM_R')) this.cameraYaw += 0.05;
    if (inputManager.isActiveAction('CAM_Z_IN')) this.cameraDistance = Math.max(5, this.cameraDistance - 0.5);
    if (inputManager.isActiveAction('CAM_Z_OUT')) this.cameraDistance = Math.min(40, this.cameraDistance + 0.5);

    let kbX = 0;
    let kbY = 0;
    if (inputManager.isActiveAction('THR_FWD')) kbY += 1;
    if (inputManager.isActiveAction('THR_BWD')) kbY -= 1;
    if (inputManager.isActiveAction('STR_LFT')) kbX -= 1;
    if (inputManager.isActiveAction('STR_RGT')) kbX += 1;

    const combinedMoveDir = { 
      x: kbX + (Math.abs(this.moveDir.x) > 0.1 ? this.moveDir.x : 0),
      y: kbY + (Math.abs(this.moveDir.y) > 0.1 ? this.moveDir.y : 0)
    };
    
    combinedMoveDir.x = Math.max(-1, Math.min(1, combinedMoveDir.x));
    combinedMoveDir.y = Math.max(-1, Math.min(1, combinedMoveDir.y));

    const currentFiringInput = inputManager.isActiveAction('FIRE') || (inputManager.isMouseDown() && inputManager.isPointerLockCaptured());
    let isFiring: 'none' | 'normal' | 'grenade' = 'none';
    if (this.virtualFire !== 'none') isFiring = this.virtualFire as any;
    else if (this.rightClickFire) isFiring = 'grenade';
    else if (currentFiringInput) isFiring = 'normal';

    this.level.update(ts);

    let targetYaw = this.cameraYaw;
    let targetPitch = this.cameraPitch;
    let autoFire = isFiring;
    
    let bestEnemy = null;
    let bestScore = -Infinity;
    const tPos = this.tank.body.getPosition();
    
    const camY = this.cameraYaw;
    const camP = this.cameraPitch;
    const camDir = [
        -Math.sin(camY) * Math.cos(camP),
        Math.sin(camP),
        -Math.cos(camY) * Math.cos(camP)
    ];
    
    for (const enemy of this.enemies) {
        if (enemy.hp <= 0) continue;
        const ePos = enemy.physicsBody.body.GetPosition();
        const dx = ePos.GetX() - tPos[0];
        const dy = (ePos.GetY() + 0.5) - (tPos[1] + 1.0);
        const dz = ePos.GetZ() - tPos[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        if (dist > 0 && dist < 200) {
            const dirToEnemy = [dx/dist, dy/dist, dz/dist];
            const dot = camDir[0]*dirToEnemy[0] + camDir[1]*dirToEnemy[1] + camDir[2]*dirToEnemy[2];
            
            if (dot > 0.90) { // within ~25 deg cone
                const score = dot; // prioritize strictly who is closest to crosshair
                if (score > bestScore) {
                    bestScore = score;
                    bestEnemy = enemy;
                }
            }
        }
    }

    if (bestEnemy) {
        const ePos = bestEnemy.physicsBody.body.GetPosition();
        const dx = ePos.GetX() - tPos[0];
        // Target center of enemy
        const dy = (ePos.GetY() + 0.6) - (tPos[1] + 0.8);
        const dz = ePos.GetZ() - tPos[2];
        const distXZ = Math.sqrt(dx*dx + dz*dz);
        targetYaw = Math.atan2(-dx, -dz);
        targetPitch = Math.atan2(dy, distXZ);
    }

    autoFire = isFiring;

    const targetPos = this.tank.body.getPosition();
    for (const enemy of this.enemies) {
       const res = enemy.update(ts, targetPos);
       if (res.didShoot) {
           this.spawnProjectile(enemy, 'normal');
       }
    }
    
    // Update explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
        const alive = this.explosions[i].update(ts);
        if (!alive) this.explosions.splice(i, 1);
    }

    // Update based on possessed entity
    const didShoot = this.tank.update(ts, combinedMoveDir, autoFire, targetYaw, targetPitch);
    if (didShoot) {
       this.spawnProjectile(this.tank, didShoot);
    }
    
    // Process ALL projectiles (Tank + Enemy)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.life -= (ts / 1000);
        p.age += (ts / 1000);
        
        if (p.life <= 0) {
            gfx3JoltManager.remove(p.body.bodyId);
            this.projectiles.splice(i, 1);
            continue;
        }

        const pPos = p.body.body.GetPosition();
        
        // Trail effects
        if (p.type === 'grenade' && Math.random() < 0.3) {
            this.explosions.push(new Explosion(pPos.GetX(), pPos.GetY(), pPos.GetZ(), [0.4, 0.4, 0.4], undefined, 1.5, 'trail'));
        }
        
        const curV = p.body.body.GetLinearVelocity();
        const vX = curV.GetX(), vY = curV.GetY(), vZ = curV.GetZ();
        
        const dvX = vX - p.lastVel[0];
        const dvY = vY - p.lastVel[1];
        const dvZ = vZ - p.lastVel[2];
        const deltaVSq = dvX*dvX + dvY*dvY + dvZ*dvZ;
        
        let impact = false;
        
        // 1. Check hitting player (if not owner)
        if (p.owner !== this.tank && p.age > 0.05) {
            const tPos = this.tank.body.getPosition();
            const dx = pPos.GetX() - tPos[0], dy = pPos.GetY() - tPos[1], dz = pPos.GetZ() - tPos[2];
            const distSq = dx*dx + dy*dy + dz*dz;
            if (distSq < 9.0) {
                impact = true;
                this.explosions.push(new Explosion(pPos.GetX(), pPos.GetY(), pPos.GetZ(), [0.8, 0.2, 0.2]));
                const pushDir = UT.VEC3_NORMALIZE([vX, vY, vZ]);
                const pushForce = new Gfx3Jolt.Vec3(pushDir[0] * 1200, 400, pushDir[2] * 1200);
                gfx3JoltManager.bodyInterface.AddImpulse(this.tank.physicsBody.body.GetID(), pushForce);
            }
        }

        // 2. Check hitting enemies
        if (!impact && p.age > 0.0) {
            for (const enemy of this.enemies) {
                if (enemy.hp <= 0 || enemy === p.owner) continue;

                const ePos = enemy.physicsBody.body.GetPosition();
                const px = pPos.GetX(), py = pPos.GetY(), pz = pPos.GetZ();
                const ex = ePos.GetX(), ey = ePos.GetY(), ez = ePos.GetZ();
                
                const distSq = (px-ex)*(px-ex) + (py-ey)*(py-ey) + (pz-ez)*(pz-ez);
                
                if (distSq < 12.0) { // approx 3.4m radius
                    impact = true;
                    if (p.type === 'grenade') {
                        enemy.hp -= 100;
                        this.spawnExplosion(px, py, pz, [0.8, 0.4, 0.1], undefined, 3.0, 'grenade');
                    } else {
                        enemy.hp -= 34;
                        this.spawnExplosion(px, py, pz, [1.0, 0.7, 0.2], undefined, 1.2);
                    }

                    const pushDir = Math.sqrt(vX*vX + vY*vY + vZ*vZ) > 0.1 ? UT.VEC3_NORMALIZE([vX, vY, vZ]) : [0, 1, 0];
                    const mag = p.type === 'grenade' ? 1500 : 700;
                    const forceVec = UT.VEC3_SCALE([pushDir[0], 0.5, pushDir[2]], mag);
                    gfx3JoltManager.bodyInterface.AddImpulse(enemy.physicsBody.body.GetID(), new Gfx3Jolt.Vec3(forceVec[0], forceVec[1], forceVec[2]));

                    if (enemy.hp <= 0) {
                        this.spawnExplosion(ex, ey, ez, [0.8, 0.2, 0.2], undefined, 2.0);
                        gfx3JoltManager.bodyInterface.SetPosition(enemy.physicsBody.body.GetID(), VEC3_TO_JOLT_RVEC3([0, -100, 0]), Gfx3Jolt.EActivation_DontActivate);
                    }
                    break;
                }
            }
        }

        // 3. Ground/Obstacle impact
        if (!impact && (pPos.GetY() < 0.1 || (p.age > 0.05 && deltaVSq > 600))) {
            impact = true;
            if (p.type === 'grenade') {
                this.spawnExplosion(pPos.GetX(), pPos.GetY(), pPos.GetZ(), [0.8, 0.4, 0.1], undefined, 3.5, 'grenade');
                // AoE damage
                for (const enemy of this.enemies) {
                    if (enemy.hp <= 0) continue;
                    const ePos = enemy.physicsBody.body.GetPosition();
                    const d_x = ePos.GetX() - pPos.GetX(), d_z = ePos.GetZ() - pPos.GetZ();
                    const distAoe = Math.sqrt(d_x*d_x + d_z*d_z);
                    if (distAoe < 12) {
                        enemy.hp -= 100;
                        if (enemy.hp <= 0) {
                            this.spawnExplosion(ePos.GetX(), ePos.GetY() + 0.5, ePos.GetZ(), [0.8, 0.3, 0.2], undefined, 2.5);
                            gfx3JoltManager.bodyInterface.SetPosition(enemy.physicsBody.body.GetID(), VEC3_TO_JOLT_RVEC3([0, -100, 0]), Gfx3Jolt.EActivation_DontActivate);
                        }
                    }
                }
            } else {
                this.spawnExplosion(pPos.GetX(), pPos.GetY(), pPos.GetZ(), [1.0, 0.7, 0.2], undefined, 1.0);
            }
        }

        if (impact) {
            gfx3JoltManager.remove(p.body.bodyId);
            this.projectiles.splice(i, 1);
        } else {
            p.lastVel = [vX, vY, vZ];
        }
    }

    // Camera Follow
    const followPos = this.tank.body.getPosition();
    
    // Convert spherical to cartesian coords for the camera offset
    // Camera is pos relative to target
    const cy = this.cameraYaw;
    const cp = this.cameraPitch;
    
    // We add math to find offset pos based on orbit
    const camOffset = [
        Math.sin(cy) * Math.cos(cp) * this.cameraDistance,
        Math.sin(cp) * this.cameraDistance,
        Math.cos(cy) * Math.cos(cp) * this.cameraDistance
    ];
    
    const targetHeightOffset = 1.5;
    
    // Safety check for followPos to prevent NaN camera
    if (!followPos || isNaN(followPos[0]) || isNaN(followPos[1]) || isNaN(followPos[2])) {
        return;
    }

    const camTarget = [
        followPos[0] + camOffset[0],
        followPos[1] + camOffset[1] + targetHeightOffset,
        followPos[2] + camOffset[2]
    ] as vec3;
    
    const camPos = this.camera.getPosition();
    // Smooth frame-rate independent lerp
    const posLerpRate = 1.0 - Math.exp(-10.0 * (ts / 1000));
    const targetLerpRate = 1.0 - Math.exp(-15.0 * (ts / 1000));

    const lerpedPos = UT.VEC3_LERP(camPos, camTarget, posLerpRate);
    
    const desiredLookTarget = [followPos[0], followPos[1] + targetHeightOffset, followPos[2]] as vec3;
    this.cameraLookTarget = UT.VEC3_LERP(this.cameraLookTarget, desiredLookTarget, targetLerpRate);
    
    // Final NaN check before setting
    if (!isNaN(lerpedPos[0]) && !isNaN(lerpedPos[1]) && !isNaN(lerpedPos[2])) {
        let shakeX = 0, shakeY = 0, shakeZ = 0;
        if (this.tank.recoil > 0) {
            const mag = this.tank.recoil * 0.4;
            shakeX = (Math.random() - 0.5) * mag;
            shakeY = (Math.random() - 0.5) * mag;
            shakeZ = (Math.random() - 0.5) * mag;
        }

        this.camera.setPosition(lerpedPos[0] + shakeX, lerpedPos[1] + shakeY, lerpedPos[2] + shakeZ);
        this.camera.lookAt(this.cameraLookTarget[0] + shakeX * 0.5, this.cameraLookTarget[1] + shakeY * 0.5, this.cameraLookTarget[2] + shakeZ * 0.5);
    }
  }

  draw() {
    gfx3Manager.beginDrawing();
    gfx3MeshRenderer.drawDirLight([0.6, -1.0, 0.4], [1.0, 0.95, 0.85], [1.0, 1.0, 1.0], 1.2);
    gfx3MeshRenderer.setAmbientColor([0.4, 0.4, 0.45]);

    const camPos = this.camera.getPosition();
    this.level.draw(camPos);
    this.tank.draw();
    for (const enemy of this.enemies) {
       enemy.draw();
    }
    
    // Draw all projectiles in one Batch
    if (Tank.projMesh && Tank.projGrenadeMesh) {
        for (const p of this.projectiles) {
            const mesh = p.type === 'grenade' ? Tank.projGrenadeMesh : Tank.projMesh;
            const pPos = p.body.body.GetPosition();
            const pRot = p.body.body.GetRotation();
            const q = new Quaternion(pRot.GetW(), pRot.GetX(), pRot.GetY(), pRot.GetZ());
            
            // For normal bullets, make them face their velocity
            let drawQ = q;
            if (p.type === 'normal') {
                const velLen = Math.sqrt(p.lastVel[0]**2 + p.lastVel[1]**2 + p.lastVel[2]**2);
                if (velLen > 0.1) {
                    const dir = [-p.lastVel[0]/velLen, -p.lastVel[1]/velLen, -p.lastVel[2]/velLen];
                    const yaw = Math.atan2(dir[0], dir[2]);
                    const pitch = Math.asin(Math.max(-1, Math.min(1, dir[1])));
                    drawQ = Quaternion.multiply(Quaternion.createFromAxisAngle([0, 1, 0], yaw), Quaternion.createFromAxisAngle([1, 0, 0], -pitch));
                }
            }

            const mat = UT.MAT4_TRANSFORM([pPos.GetX(), pPos.GetY(), pPos.GetZ()], [0,0,0], [1,1,1], drawQ);
            gfx3MeshRenderer.drawMesh(mesh, mat);
        }
    }

    for (const exp of this.explosions) {
       exp.draw();
    }
    
    gfx3Manager.endDrawing();
  }

  render(ts: number) {
    if (!this.isReady) return;
    
    gfx3Manager.beginRender();
    
    // 1. Render scene to post-processing source texture
    gfx3Manager.setDestinationTexture(gfx3PostRenderer.getSourceTexture());
    gfx3Manager.beginPassRender(0);
    gfx3MeshRenderer.render(ts);
    gfx3Manager.endPassRender();
    
    // 2. Render post-processing to canvas
    gfx3Manager.setDestinationTexture(null);
    gfx3PostRenderer.render(ts, gfx3Manager.getCurrentRenderingTexture());
    
    gfx3Manager.endRender();
  }
}