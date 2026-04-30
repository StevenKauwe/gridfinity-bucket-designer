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

  let mesh = null;
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

  function setMesh(stlBytes, meta) {
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
    const loader = new STLLoader();
    const buf = stlBytes.buffer.slice(stlBytes.byteOffset, stlBytes.byteOffset + stlBytes.byteLength);
    const geom = loader.parse(buf);
    geom.computeVertexNormals();

    // STL is in millimeters; orient with Z up — same as kennetek output.
    const material = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.5,
      metalness: 0.05,
      flatShading: false,
    });
    mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = true;
    scene.add(mesh);

    // Frame the mesh.
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    mesh.position.sub(center);
    mesh.position.z += (bb.max.z - bb.min.z) / 2; // sit on the grid

    const size = bb.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z) || 50;
    camera.position.set(max * 1.4, -max * 1.4, max * 0.9);
    controls.target.set(0, 0, max / 4);
    controls.update();
    resize();
  }

  function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
    renderer.dispose();
    container.innerHTML = "";
  }

  viewer = { container, setMesh, dispose };
  return viewer;
}

export function openPreview(stlBytes, label) {
  const overlay = ensureOverlay();
  overlay.classList.add("open");
  const canvas = overlay.querySelector(".preview-canvas");
  const v = ensureViewer(canvas);
  v.setMesh(stlBytes, { label });

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
