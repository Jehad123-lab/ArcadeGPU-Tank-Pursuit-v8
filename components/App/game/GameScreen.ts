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

    const targetPos = this.tank.body.getPosition();
    for (const enemy of this.enemies) {
       const res = enemy.update(ts, targetPos);
       if (res.didShoot && res.muzzlePos && res.dir) {
           this.explosions.push(new Explosion(res.muzzlePos[0], res.muzzlePos[1], res.muzzlePos[2], [1.0, 0.5, 0.1], res.dir));
       }
    }
    
    // Update explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
        const alive = this.explosions[i].update(ts);
        if (!alive) this.explosions.splice(i, 1);
    }

    // Hit Detection - Tank projectiles vs Enemies
    for (const p of this.tank.projectiles) {
        if (p.life <= 0) continue;
        const pPos = p.body.body.GetPosition();
        
        // Trail
        if (p.type === 'grenade' && Math.random() < 0.2) {
            this.explosions.push(new Explosion(pPos.GetX(), pPos.GetY(), pPos.GetZ(), [0.4, 0.4, 0.4], undefined, 1.5, 'trail'));
        }
        
        const curV = p.body.body.GetLinearVelocity();
        const velSq = curV.GetX()*curV.GetX() + curV.GetY()*curV.GetY() + curV.GetZ()*curV.GetZ();
        
        let hitEnemy = false;
        
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0) continue;
            const ePos = enemy.physicsBody.body.GetPosition();
            const dx = pPos.GetX() - ePos.GetX();
            const dy = pPos.GetY() - ePos.GetY();
            const dz = pPos.GetZ() - ePos.GetZ();
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (dist < 2.2) {
                hitEnemy = true;
                if (p.type === 'grenade') {
                    enemy.hp -= 100; // instant kill
                    p.life = 0; 
                    this.explosions.push(new Explosion(pPos.GetX(), pPos.GetY(), pPos.GetZ(), [0.8, 0.4, 0.1], undefined, 3.0, 'grenade'));
                } else {
                    enemy.hp -= 34; // 3 hits to kill (100 hp)
                    p.life = 0; 
                    this.explosions.push(new Explosion(pPos.GetX(), pPos.GetY(), pPos.GetZ(), [1.0, 0.7, 0.2], undefined, 1.0));
                }
                
                // Add a consistent visual hop and push
                const pushDir = p.rot.rotateVector([0, 0, -1]);
                const pushMagnitude = p.type === 'grenade' ? 1200 : 600;
                const pushForce = new Gfx3Jolt.Vec3(pushDir[0] * pushMagnitude, p.type === 'grenade' ? 1000 : 500, pushDir[2] * pushMagnitude);
                gfx3JoltManager.bodyInterface.AddImpulse(enemy.physicsBody.body.GetID(), pushForce);

                if (enemy.hp <= 0) {
                    this.explosions.push(new Explosion(ePos.GetX(), ePos.GetY(), ePos.GetZ(), [0.8, 0.2, 0.2], undefined, p.type === 'grenade' ? 2.5 : 1.5));
                    gfx3JoltManager.bodyInterface.SetPosition(enemy.physicsBody.body.GetID(), VEC3_TO_JOLT_RVEC3([0, -100, 0]), Gfx3Jolt.EActivation_DontActivate);
                }
                break;
            }
        }
        
        if (hitEnemy) continue;

        // Detect impact: if it hits the ground OR its horizontal speed drops abruptly (hits a wall)
        const hVelSq = curV.GetX()*curV.GetX() + curV.GetZ()*curV.GetZ();
        const lastHVelSq = p.lastVel[0]*p.lastVel[0] + p.lastVel[2]*p.lastVel[2];
        const isImpact = pPos.GetY() < 0.2 || (Math.abs(lastHVelSq - hVelSq) > 100); 

        if (isImpact) {
            p.life = 0;
            if (p.type === 'grenade') {
                this.explosions.push(new Explosion(pPos.GetX(), pPos.GetY(), pPos.GetZ(), [0.8, 0.4, 0.1], undefined, 3.0, 'grenade'));
                
                // Area of effect damage
                for (const enemy of this.enemies) {
                    if (enemy.hp <= 0) continue;
                    const ePos = enemy.physicsBody.body.GetPosition();
                    const dx = ePos.GetX() - pPos.GetX();
                    const dz = ePos.GetZ() - pPos.GetZ();
                    const aoeDist = Math.sqrt(dx*dx + dz*dz);
                    if (aoeDist < 10) {
                        enemy.hp -= 100;
                        const pushDir = UT.VEC3_NORMALIZE([dx, 1.0, dz]);
                        const pushMagnitude = 1500;
                        const pushForce = new Gfx3Jolt.Vec3(pushDir[0] * pushMagnitude, pushDir[1] * pushMagnitude, pushDir[2] * pushMagnitude);
                        gfx3JoltManager.bodyInterface.AddImpulse(enemy.physicsBody.body.GetID(), pushForce);
                        if (enemy.hp <= 0) {
                            this.explosions.push(new Explosion(ePos.GetX(), ePos.GetY(), ePos.GetZ(), [0.8, 0.2, 0.2], undefined, 2.0));
                            gfx3JoltManager.bodyInterface.SetPosition(enemy.physicsBody.body.GetID(), VEC3_TO_JOLT_RVEC3([0, -100, 0]), Gfx3Jolt.EActivation_DontActivate);
                        }
                    }
                }
            } else {
                this.explosions.push(new Explosion(pPos.GetX(), pPos.GetY(), pPos.GetZ(), [1.0, 0.7, 0.2], undefined, 1.0));
            }
        }
    }
    
    // Enemy projectiles vs Player/Tank
    for (const enemy of this.enemies) {
        for (const p of enemy.projectiles) {
            if (p.life <= 0) continue;
            const pPos = p.body.body.GetPosition();
            
            const pTarget = this.tank.body.getPosition();
            const dx = pPos.GetX() - pTarget[0];
            const dy = pPos.GetY() - pTarget[1];
            const dz = pPos.GetZ() - pTarget[2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            
            const curV = p.body.body.GetLinearVelocity();
            const hVelSq = curV.GetX()*curV.GetX() + curV.GetZ()*curV.GetZ();
            const lastHVelSq = p.lastVel[0]*p.lastVel[0] + p.lastVel[2]*p.lastVel[2];
            
            if (dist < 2.5) {
                p.life = 0;
                this.explosions.push(new Explosion(pPos.GetX(), pPos.GetY(), pPos.GetZ()));
                
                // Add a push to the tank
                const pushDir = p.rot.rotateVector([0, 0, -1]);
                const pushForce = new Gfx3Jolt.Vec3(pushDir[0] * 800, 200, pushDir[2] * 800);
                gfx3JoltManager.bodyInterface.AddImpulse(this.tank.physicsBody.body.GetID(), pushForce);
                
                // Add camera shake or player damage logic here
            } else if (pPos.GetY() < 0.2 || (Math.abs(lastHVelSq - hVelSq) > 100)) {
                p.life = 0;
                this.explosions.push(new Explosion(pPos.GetX(), pPos.GetY(), pPos.GetZ()));
            }
        }
    }

    // Update based on possessed entity
    const didShoot = this.tank.update(ts, combinedMoveDir, isFiring, this.cameraYaw, this.cameraPitch);
    if (didShoot) {
       const bPos = this.tank.barrel.getPosition();
       const bRot = this.tank.barrel.getQuaternion();
       const dir = bRot.rotateVector([0, 0, -1]);
       
       const muzzlePos = [
           bPos[0] + dir[0] * 3.0,
           bPos[1] + dir[1] * 3.0,
           bPos[2] + dir[2] * 3.0,
       ] as vec3;
       
       const muzzleColor: [number, number, number] = didShoot === 'grenade' ? [0.8, 0.4, 0.1] : [1.0, 0.8, 0.2];
       const scaleMultiplier = didShoot === 'grenade' ? 2.5 : 1.0; // Increased scale for grenade muzzle
       this.explosions.push(new Explosion(muzzlePos[0], muzzlePos[1], muzzlePos[2], muzzleColor, dir, scaleMultiplier, 'muzzle'));
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