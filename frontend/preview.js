// 3D STL preview using Three.js (loaded from jsdelivr ESM CDN).
// Lazily initializes a singleton viewer overlay; reuse across previews.
import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let viewer = null;

function ensureOverlay() {
  let el = document.getElementById("preview-overlay");
  if (el) return el;

  el = document.createElement("div");
  el.id = "preview-overlay";
  el.innerHTML = `
    <div class="preview-modal">
      <header>
        <span class="preview-title">3D Preview</span>
        <span class="preview-meta"></span>
        <button class="preview-close" aria-label="Close preview">✕</button>
      </header>
      <div class="preview-canvas"></div>
      <footer class="preview-hint">Drag to orbit · scroll to zoom · right-click to pan</footer>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelector(".preview-close").addEventListener("click", () => closePreview());
  el.addEventListener("click", (e) => { if (e.target === el) closePreview(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.classList.contains("open")) closePreview();
  });
  return el;
}

function ensureViewer(container) {
  if (viewer && viewer.container === container) return viewer;

  const w = container.clientWidth || 800;
  const h = container.clientHeight || 600;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f5f9);

  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
  // STL output is Z-up (kennetek convention). Tell Three.js so OrbitControls
  // rotates around the world Z axis and the bin sits "right side up".
  camera.up.set(0, 0, 1);
  camera.position.set(120, 120, 120);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Lighting — warm key + cool fill so the lip + foot detail reads well.
  const ambient = new THREE.HemisphereLight(0xffffff, 0x9ca3af, 0.7);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(80, 120, 60);
  key.castShadow = true;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
  fill.position.set(-60, 40, -80);
  scene.add(fill);

  // Build plate (a faint grid) for spatial reference.
  const grid = new THREE.GridHelper(420, 10, 0xcbd5e1, 0xe5e7eb);
  grid.rotation.x = Math.PI / 2; // STL is Z-up; rotate grid to match plane below
  grid.position.z = -0.01;
  scene.add(grid);

  // Axes hint (small).
  const axes = new THREE.AxesHelper(20);
  scene.add(axes);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  let meshes = [];
  let raf = 0;
  function animate() {
    raf = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function resize() {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw && ch) {
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  function clearMeshes() {
    for (const mesh of meshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    meshes = [];
  }

  function setMeshes(items) {
    clearMeshes();
    const loader = new STLLoader();
    const colors = [0xf59e0b, 0x2563eb, 0x16a34a, 0xdc2626, 0x7c3aed, 0x0891b2, 0xea580c];
    const worldBox = new THREE.Box3();

    items.forEach((item, index) => {
      const stlBytes = item.bytes || item.stlBytes;
      const buf = stlBytes.buffer.slice(stlBytes.byteOffset, stlBytes.byteOffset + stlBytes.byteLength);
      const geom = loader.parse(buf);
      geom.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: item.color || colors[index % colors.length],
        roughness: 0.5,
        metalness: 0.05,
        flatShading: false,
      });
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true;
      mesh.position.set(item.x || 0, item.y || 0, item.z || 0);
      if (item.mirrorY) {
        mesh.scale.y = -1;
      }
      scene.add(mesh);
      meshes.push(mesh);

      geom.computeBoundingBox();
      mesh.updateMatrixWorld(true);
      const box = geom.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      worldBox.union(box);
    });

    if (worldBox.isEmpty()) return;

    const center = new THREE.Vector3();
    worldBox.getCenter(center);
    for (const mesh of meshes) {
      mesh.position.x -= center.x;
      mesh.position.y -= center.y;
      mesh.position.z -= worldBox.min.z;
    }

    const size = worldBox.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 50;
    camera.position.set(max * 1.4, -max * 1.4, max * 0.9);
    controls.target.set(0, 0, max / 4);
    controls.update();
    resize();
  }

  function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    clearMeshes();
    renderer.dispose();
    container.innerHTML = "";
  }

  viewer = { container, setMeshes, dispose };
  return viewer;
}

function stlStats(items) {
  let triangles = 0;
  let bytes = 0;
  for (const item of items) {
    const stlBytes = item.bytes || item.stlBytes;
    const dv = new DataView(stlBytes.buffer, stlBytes.byteOffset, stlBytes.byteLength);
    triangles += dv.getUint32(80, true);
    bytes += stlBytes.length;
  }
  return { triangles, bytes };
}

export function openPreviewScene(items, label) {
  const overlay = ensureOverlay();
  overlay.classList.add("open");
  const canvas = overlay.querySelector(".preview-canvas");
  const v = ensureViewer(canvas);
  v.setMeshes(items);

  const meta = overlay.querySelector(".preview-meta");
  if (meta) {
    const { triangles, bytes } = stlStats(items);
    meta.textContent = `${label || ""} · ${items.length.toLocaleString()} boxes · ${triangles.toLocaleString()} triangles · ${(bytes / 1024).toFixed(1)} KB`;
  }
}

export function openPreview(stlBytes, label) {
  const overlay = ensureOverlay();
  overlay.classList.add("open");
  const canvas = overlay.querySelector(".preview-canvas");
  const v = ensureViewer(canvas);
  v.setMeshes([{ bytes: stlBytes, label, x: 0, y: 0, z: 0 }]);

  const meta = overlay.querySelector(".preview-meta");
  if (meta) {
    const dv = new DataView(stlBytes.buffer, stlBytes.byteOffset, stlBytes.byteLength);
    const tris = dv.getUint32(80, true);
    meta.textContent = `${label || ""} · ${tris.toLocaleString()} triangles · ${(stlBytes.length / 1024).toFixed(1)} KB`;
  }
}

export function closePreview() {
  const overlay = document.getElementById("preview-overlay");
  if (overlay) overlay.classList.remove("open");
}
