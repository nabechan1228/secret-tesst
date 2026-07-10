import * as THREE from 'three';
import { equatorialToHorizontal, horizonToCartesian } from './calculations';
import { DOME_RADIUS, API_BASE } from './constants';
import { METEOR_SHOWERS } from './celestial-events-data';


export interface MeteorShowerActivity {
  id: string;
  activity: number;
  zhr: number;
}

export interface ActiveMeteor {
  line: THREE.Line;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  length: number;
  life: number;
  decay: number;
}

export const effectsState = {
  showAurora: false,
  showMeteors: false,
  activeMeteorShower: 'perseids',
  auroraKp: 3,
  auroraOpacity: 0.0,
  activeMeteors: [] as ActiveMeteor[],
  currentMeteorShowersActivity: new Map<string, MeteorShowerActivity>(),
  lastMeteorFetchDateStr: '',
  isFetchingMeteors: false
};

let auroraMesh: THREE.Mesh | null = null;
let auroraMaterial: THREE.ShaderMaterial | null = null;

export function initAurora(scene: THREE.Scene) {
  const auroraGeo = new THREE.PlaneGeometry(800, 250, 60, 20);
  auroraGeo.rotateX(-Math.PI / 5); 
  auroraGeo.translate(0, 160, -350); 

  auroraMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uKp: { value: 3.0 },
      uOpacity: { value: 0.0 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uKp;
      varying vec2 vUv;
      varying float vNoise;
      void main() {
        vUv = uv;
        float speed = uTime * (0.35 + uKp * 0.1);
        float amp = 8.0 + uKp * 5.0;
        float wave = sin(position.x * 0.015 + speed) * cos(position.y * 0.02 + speed * 0.8) * amp;
        wave += sin(position.x * 0.035 - speed * 1.3) * 5.0;
        vec3 pos = position;
        pos.z += wave;
        vNoise = wave / (amp + 5.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uKp;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vNoise;
      void main() {
        vec3 green = vec3(0.0, 1.0, 0.3);
        vec3 red = vec3(0.95, 0.0, 0.5);
        vec3 baseColor = mix(green, red, vUv.y * (0.25 + uKp * 0.07));
        float verticalStreaks = sin(vUv.x * 120.0 + vNoise * 6.0) * cos(vUv.x * 55.0 - vNoise * 3.0);
        verticalStreaks = smoothstep(-0.55, 0.75, verticalStreaks) * 0.4 + 0.6;
        float alpha = sin(vUv.y * 3.14159) * verticalStreaks;
        alpha *= (0.05 + (uKp / 9.0) * 0.55);
        alpha *= uOpacity;
        gl_FragColor = vec4(baseColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });

  auroraMesh = new THREE.Mesh(auroraGeo, auroraMaterial);
  auroraMesh.visible = false;
  scene.add(auroraMesh);
}

export function updateAurora(performanceNow: number, latitude: number, sunAlt: number, isForceNightMode: boolean) {
  const isPolar = Math.abs(latitude) >= 60;
  const isNight = isForceNightMode || typeof sunAlt === 'undefined' || sunAlt < -12;
  const isAuroraActive = effectsState.showAurora && isPolar && isNight;

  if (isAuroraActive) {
    effectsState.auroraOpacity += (1.0 - effectsState.auroraOpacity) * 0.03; 
  } else {
    effectsState.auroraOpacity += (0.0 - effectsState.auroraOpacity) * 0.05; 
  }

  if (auroraMaterial && auroraMesh) {
    auroraMaterial.uniforms.uOpacity.value = effectsState.auroraOpacity;
    auroraMaterial.uniforms.uTime.value = performanceNow * 0.001;
    auroraMaterial.uniforms.uKp.value = effectsState.auroraKp;
    auroraMesh.visible = effectsState.auroraOpacity > 0.01;
  }
}

export function clearMeteors(scene: THREE.Scene) {
  effectsState.activeMeteors.forEach(m => {
    scene.remove(m.line);
    m.line.geometry.dispose();
    (m.line.material as THREE.Material).dispose();
  });
  effectsState.activeMeteors = [];
}

export function updateMeteors(lst: number, latitude: number, currentDate: Date, scene: THREE.Scene) {
  if (effectsState.showMeteors) {
    fetchMeteorShowersActivity(currentDate);

    const shower = METEOR_SHOWERS[effectsState.activeMeteorShower];
    if (shower) {
      const activityData = effectsState.currentMeteorShowersActivity.get(effectsState.activeMeteorShower);
      if (activityData && activityData.activity > 0) {
        const hor = equatorialToHorizontal(shower.ra, shower.dec, lst, latitude);
        
        if (hor.alt > 0) {
          const spawnChance = 0.04 * activityData.activity;
          if (Math.random() < spawnChance && effectsState.activeMeteors.length < 30) {
            createMeteor(hor.az, hor.alt, shower.color, activityData.activity, scene);
          }
        }
      }
    }
  }

  const nextMeteors: ActiveMeteor[] = [];
  effectsState.activeMeteors.forEach((m) => {
    m.life += m.decay;
    if (m.life >= 1.0) {
      scene.remove(m.line);
      m.line.geometry.dispose();
      (m.line.material as THREE.Material).dispose();
    } else {
      const progress = m.life * 1.8; 
      const pStart = m.origin.clone().addScaledVector(m.dir, progress * m.speed * DOME_RADIUS * 0.5);
      pStart.normalize().multiplyScalar(DOME_RADIUS * 0.95);
      
      const pEnd = pStart.clone().addScaledVector(m.dir, -m.length * DOME_RADIUS * 0.25);
      pEnd.normalize().multiplyScalar(DOME_RADIUS * 0.95);

      const positions = m.line.geometry.attributes.position.array as Float32Array;
      positions[0] = pStart.x;
      positions[1] = pStart.y;
      positions[2] = pStart.z;
      positions[3] = pEnd.x;
      positions[4] = pEnd.y;
      positions[5] = pEnd.z;
      m.line.geometry.attributes.position.needsUpdate = true;

      const mat = m.line.material as THREE.LineBasicMaterial;
      mat.opacity = Math.sin(m.life * Math.PI) * 0.9;

      nextMeteors.push(m);
    }
  });
  effectsState.activeMeteors = nextMeteors;
}

export function createMeteor(radAz: number, radAlt: number, colorStr: string, activity: number = 1.0, scene: THREE.Scene) {
  const radVector = horizonToCartesian(radAz, radAlt, DOME_RADIUS * 0.95);
  const radNormal = radVector.clone().normalize();
  
  const origin = radVector.clone();
  const offset = new THREE.Vector3(
    (Math.random() - 0.5) * 60,
    (Math.random() - 0.5) * 60,
    (Math.random() - 0.5) * 60
  );
  origin.add(offset).normalize().multiplyScalar(DOME_RADIUS * 0.95);

  const tangent = new THREE.Vector3(1, 0, 0);
  if (Math.abs(radNormal.x) > 0.9) {
    tangent.set(0, 1, 0);
  }
  const dir = new THREE.Vector3().crossVectors(radNormal, tangent).normalize();
  
  const angle = Math.random() * Math.PI * 2;
  dir.applyAxisAngle(radNormal, angle);

  const positions = new Float32Array(6);
  positions[0] = origin.x; positions[1] = origin.y; positions[2] = origin.z;
  positions[3] = origin.x; positions[4] = origin.y; positions[5] = origin.z;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(colorStr),
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    linewidth: 1.5
  });

  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);

  effectsState.activeMeteors.push({
    line,
    origin,
    dir,
    speed: (0.08 + Math.random() * 0.12) * (0.8 + activity * 0.4),  
    length: (0.08 + Math.random() * 0.08) * (0.9 + activity * 0.2), 
    life: 0.0,
    decay: 0.025 + Math.random() * 0.045 
  });
}

export async function fetchMeteorShowersActivity(currentDate: Date) {
  if (effectsState.isFetchingMeteors) return;
  const dateStr = currentDate.toISOString().split('T')[0];
  if (dateStr === effectsState.lastMeteorFetchDateStr) return;
  
  effectsState.isFetchingMeteors = true;
  try {
    const url = `${API_BASE}/api/meteor-showers?time=${encodeURIComponent(currentDate.toISOString())}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('API error');
    const data = await res.json() as { showers: Array<{ id: string; activity: number; zhr: number }> };
    
    effectsState.currentMeteorShowersActivity.clear();
    data.showers.forEach(s => {
      effectsState.currentMeteorShowersActivity.set(s.id, {
        id: s.id,
        activity: s.activity,
        zhr: s.zhr
      });
    });
    effectsState.lastMeteorFetchDateStr = dateStr;
    console.log('Fetched meteor activity for date:', dateStr, data.showers);
  } catch (err) {
    console.error('Failed to fetch meteor showers activity:', err);
  } finally {
    effectsState.isFetchingMeteors = false;
  }
}
