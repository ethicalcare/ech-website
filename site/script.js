document.documentElement.classList.add("js");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const header = document.querySelector("[data-header]");
const menuButton = document.querySelector(".menu-button");
const primaryNav = document.querySelector("#primary-nav");
const backToTop = document.querySelector("[data-back-to-top]");
const floatingActions = document.querySelector(".floating-actions");
const heroStage = document.querySelector("[data-hero-stage]");
const situationGrid = document.querySelector("[data-situation-grid]");
const situationCards = situationGrid ? [...situationGrid.querySelectorAll(".situation-card")] : [];
const situationsIntro = document.querySelector(".situations-intro");
const heartScrollScene = document.querySelector("[data-heart-scroll]");
const heartScrollAmbient = document.querySelector("[data-heart-scroll-ambient]");
const heartScrollOutlines = heartScrollScene
  ? [...heartScrollScene.querySelectorAll(".heart-scroll-outline")].map((element) => ({
      element,
      length: element.getTotalLength(),
    }))
  : [];
const heartScrollExits = heartScrollScene
  ? [...heartScrollScene.querySelectorAll(".heart-scroll-exit")].map((element) => ({
      element,
      length: element.getTotalLength(),
    }))
  : [];
const servicesSection = document.querySelector("#services");
const servicesFlowPaths = servicesSection
  ? [...servicesSection.querySelectorAll("[data-services-flow] path")].map((element) => ({
      element,
      length: element.getTotalLength(),
    }))
  : [];
const drawIconImages = [...document.querySelectorAll("[data-draw-icon]")];
const serviceCards = [...document.querySelectorAll(".service-card")];
const contactLauncher = document.querySelector("[data-contact-launcher]");
const contactPanel = document.querySelector("[data-contact-panel]");
const contactPanelClose = document.querySelector("[data-contact-close]");
const finalCtaMedia = document.querySelector("[data-final-cta-media]");
const careMomentGallery = document.querySelector(".care-moment-gallery");
const careMoments = careMomentGallery ? [...careMomentGallery.querySelectorAll(".care-moment")] : [];
const detailParallaxHero = document.querySelector("[data-detail-parallax]");
const detailParallaxPhoto = document.querySelector("[data-detail-parallax-photo]");

function closeMenu() {
  if (!menuButton || !primaryNav) return;
  menuButton.setAttribute("aria-expanded", "false");
  primaryNav.classList.remove("is-open");
  document.body.classList.remove("menu-open");
}

menuButton?.addEventListener("click", () => {
  const willOpen = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(willOpen));
  primaryNav?.classList.toggle("is-open", willOpen);
  document.body.classList.toggle("menu-open", willOpen);
});

primaryNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", closeMenu);
});


function updatePersistentUI() {
  const scrolled = window.scrollY > 16;
  header?.classList.toggle("is-scrolled", scrolled);
  backToTop?.classList.toggle("is-visible", window.scrollY > window.innerHeight * 0.9);
  const contactPanelOpen = Boolean(contactPanel && !contactPanel.hidden);
  floatingActions?.classList.toggle("is-ready", window.scrollY > window.innerHeight * 0.55 || contactPanelOpen);
}

updatePersistentUI();

backToTop?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
});

if ("IntersectionObserver" in window && !reducedMotion.matches) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-revealed");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -10%", threshold: 0.08 });

  document.querySelectorAll("[data-reveal]").forEach((element) => revealObserver.observe(element));
} else {
  document.querySelectorAll("[data-reveal]").forEach((element) => element.classList.add("is-revealed"));
}

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const mix = (start, end, amount) => start + (end - start) * amount;
const smoothstep = (start, end, value) => {
  const progress = clamp((value - start) / Math.max(end - start, 0.0001), 0, 1);
  return progress * progress * (3 - 2 * progress);
};

function updateCareMomentParallax() {
  if (!careMomentGallery || !careMoments.length) return;

  if (reducedMotion.matches || window.innerWidth <= 900) {
    careMoments.forEach((moment) => moment.style.setProperty("--care-parallax-y", "0px"));
    return;
  }

  const bounds = careMomentGallery.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  if (bounds.bottom < -80 || bounds.top > viewportHeight + 80) return;

  const progress = smoothstep(0, 1, (viewportHeight - bounds.top) / (viewportHeight + bounds.height));
  const travel = progress * 2 - 1;
  const depth = [12, 24, 9];

  careMoments.forEach((moment, index) => {
    const offset = -(depth[index] || 10) * travel;
    moment.style.setProperty("--care-parallax-y", `${offset.toFixed(2)}px`);
  });
}

function updateDetailHeroParallax() {
  if (!detailParallaxHero || !detailParallaxPhoto) return;

  if (reducedMotion.matches || window.innerWidth <= 900) {
    detailParallaxHero.style.setProperty("--detail-shape-y", "0px");
    detailParallaxPhoto.style.setProperty("--detail-photo-y", "0px");
    return;
  }

  const bounds = detailParallaxHero.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  if (bounds.bottom < -100 || bounds.top > viewportHeight + 100) return;

  const rawProgress = clamp(-bounds.top / Math.max(bounds.height * 0.9, 1), 0, 1);
  const progress = smoothstep(0, 1, rawProgress);
  detailParallaxHero.style.setProperty("--detail-shape-y", `${(progress * 38).toFixed(2)}px`);
  detailParallaxPhoto.style.setProperty("--detail-photo-y", `${(-progress * 28).toFixed(2)}px`);
}

function setSvgDrawProgress(entries, progress) {
  const normalizedProgress = clamp(progress, 0, 1);

  entries.forEach(({ element, length }) => {
    element.style.setProperty("--heart-trace-offset", `${length * (1 - normalizedProgress)}px`);
  });
}

function initializeSvgDraw(entries) {
  entries.forEach(({ element, length }) => {
    element.style.setProperty("--heart-trace-length", `${length}px`);
    element.style.setProperty("--heart-trace-offset", `${length}px`);
  });
}

function setHeartTraceProgress(progress) {
  const normalizedProgress = clamp(progress, 0, 1);
  heartScrollScene?.style.setProperty("--heart-path-progress", (normalizedProgress * 100).toFixed(3));
  setSvgDrawProgress(heartScrollOutlines, normalizedProgress);
}

function setHeartExitProgress(progress) {
  setSvgDrawProgress(heartScrollExits, progress);
}

let heartMotionMetrics;
let heartHasEntered = false;

function measureHeartMotion() {
  const section = heartScrollScene?.closest(".care-flow")?.querySelector(".situations");
  const featuredCard = section?.querySelector(".situation-card-featured");
  const firstCard = section?.querySelector(".situation-card:not(.situation-card-featured)");
  if (!section || !featuredCard || !firstCard || !servicesSection) {
    heartMotionMetrics = undefined;
    return;
  }

  const currentScroll = window.scrollY;
  const bounds = section.getBoundingClientRect();
  const introBounds = situationsIntro?.getBoundingClientRect();
  const firstCardBounds = firstCard.getBoundingClientRect();
  const featuredBounds = featuredCard.getBoundingClientRect();
  const servicesBounds = servicesSection.getBoundingClientRect();

  heartMotionMetrics = {
    sectionTop: currentScroll + bounds.top,
    introTop: currentScroll + (introBounds?.top ?? bounds.top),
    firstCardTop: currentScroll + firstCardBounds.top,
    featuredBottom: currentScroll + featuredBounds.bottom,
    servicesTop: currentScroll + servicesBounds.top,
    servicesHeight: servicesBounds.height,
  };
}

function updateHeartScroll() {
  if (!heartScrollScene) return;

  if (reducedMotion.matches || window.innerWidth <= 1120) {
    setHeartTraceProgress(1);
    setHeartExitProgress(1);
    setSvgDrawProgress(servicesFlowPaths, 1);
    situationsIntro?.style.setProperty("--situations-copy-x", "0px");
    heartScrollAmbient?.style.setProperty("--heart-ambient-opacity", "0");
    return;
  }

  if (!heartMotionMetrics) measureHeartMotion();
  if (!heartMotionMetrics) return;

  const viewportHeight = window.innerHeight;
  const currentScroll = window.scrollY;
  const boundsTop = heartMotionMetrics.sectionTop - currentScroll;
  const introTop = heartMotionMetrics.introTop - currentScroll;
  const heartEntryLine = viewportHeight * 0.76;
  const heartEntryFinishLine = Math.max(88, viewportHeight * 0.11);

  if (!heartHasEntered && introTop <= heartEntryLine) {
    const entryDepth = clamp(
      (heartEntryLine - introTop) / Math.max(heartEntryLine - heartEntryFinishLine, 1),
      0,
      1,
    );
    const catchUpDelay = Math.round(entryDepth * 760);
    heartScrollScene.style.setProperty("--heart-entry-delay", `${-catchUpDelay}ms`);
    heartHasEntered = true;
    heartScrollScene.classList.add("is-entered");
  }

  const entryProgress = clamp(
    (viewportHeight * 0.9 - boundsTop) / Math.max(viewportHeight * 0.95, 1),
    0,
    1,
  );
  const outlineStartScroll = heartMotionMetrics.firstCardTop - viewportHeight * 0.84;
  const exitStartScroll = heartMotionMetrics.featuredBottom - viewportHeight;
  const traceProgress = clamp(
    (currentScroll - outlineStartScroll) / Math.max(exitStartScroll - outlineStartScroll, 1),
    0,
    1,
  );
  const exitProgress = clamp(
    (currentScroll - exitStartScroll) / Math.max(viewportHeight * 0.72, 1),
    0,
    1,
  );
  const servicesFlowProgress = clamp(
    (viewportHeight * 0.92 - (heartMotionMetrics.servicesTop - currentScroll))
      / Math.max(heartMotionMetrics.servicesHeight * 0.82, 1),
    0,
    1,
  );
  const ambientStartScroll = heartMotionMetrics.sectionTop - viewportHeight * 0.7;
  const ambientEndScroll = heartMotionMetrics.featuredBottom - viewportHeight * 0.34;
  const ambientFlow = clamp(
    (currentScroll - ambientStartScroll) / Math.max(ambientEndScroll - ambientStartScroll, 1),
    0,
    1,
  );
  const ambientStageReveal = smoothstep(0.02, 0.16, ambientFlow);
  const ambientPrimaryReveal = smoothstep(0.04, 0.25, ambientFlow);
  const ambientSecondaryReveal = smoothstep(0.2, 0.43, ambientFlow);
  const ambientPrimaryFlow = smoothstep(0.03, 0.88, ambientFlow);
  const ambientSecondaryFlow = smoothstep(0.2, 0.99, ambientFlow);
  const ambientEntryX = mix(180, 0, ambientStageReveal);
  const ambientEntryY = mix(36, 0, ambientStageReveal);
  const ambientFlowX = mix(92, -118, ambientPrimaryFlow);
  const ambientFlowReverse = mix(-96, 78, ambientSecondaryFlow);
  const ambientWaveY = Math.sin(ambientPrimaryFlow * Math.PI * 1.08) * 34;
  const ambientWaveRotate = mix(-3.1, 2.7, ambientPrimaryFlow);
  const ambientWaveReverseY = Math.sin(ambientSecondaryFlow * Math.PI * 1.04) * -27;
  const ambientWaveReverseRotate = mix(2.6, -2.1, ambientSecondaryFlow);

  setHeartTraceProgress(traceProgress);
  setHeartExitProgress(exitProgress);
  setSvgDrawProgress(servicesFlowPaths, servicesFlowProgress);
  heartScrollScene.style.setProperty("--heart-core-opacity", "1");
  heartScrollScene.style.setProperty("--heart-outline-opacity", "1");
  heartScrollScene.style.setProperty("--heart-aura-opacity", "0.52");
  heartScrollScene.style.setProperty("--heart-drift-y", "0px");
  situationsIntro?.style.setProperty("--situations-copy-x", "0px");
  heartScrollAmbient?.style.setProperty("--heart-ambient-opacity", ambientStageReveal.toFixed(3));
  heartScrollAmbient?.style.setProperty("--heart-ambient-primary-opacity", (ambientPrimaryReveal * 0.92).toFixed(3));
  heartScrollAmbient?.style.setProperty("--heart-ambient-secondary-opacity", (ambientSecondaryReveal * 0.8).toFixed(3));
  heartScrollAmbient?.style.setProperty("--heart-ambient-entry-x", `${ambientEntryX.toFixed(2)}px`);
  heartScrollAmbient?.style.setProperty("--heart-ambient-entry-y", `${ambientEntryY.toFixed(2)}px`);
  heartScrollAmbient?.style.setProperty("--heart-ambient-flow-x", `${ambientFlowX.toFixed(2)}px`);
  heartScrollAmbient?.style.setProperty("--heart-ambient-flow-reverse", `${ambientFlowReverse.toFixed(2)}px`);
  heartScrollAmbient?.style.setProperty("--heart-ambient-wave-y", `${ambientWaveY.toFixed(2)}px`);
  heartScrollAmbient?.style.setProperty("--heart-ambient-wave-rotate", `${ambientWaveRotate.toFixed(2)}deg`);
  heartScrollAmbient?.style.setProperty("--heart-ambient-wave-reverse-y", `${ambientWaveReverseY.toFixed(2)}px`);
  heartScrollAmbient?.style.setProperty("--heart-ambient-wave-reverse-rotate", `${ambientWaveReverseRotate.toFixed(2)}deg`);
}

let heartScrollFrame;

function scheduleHeartScroll() {
  if (heartScrollFrame) return;
  heartScrollFrame = requestAnimationFrame(() => {
    updateHeartScroll();
    heartScrollFrame = undefined;
  });
}

if (heartScrollScene) {
  initializeSvgDraw(heartScrollOutlines);
  initializeSvgDraw(heartScrollExits);
  initializeSvgDraw(servicesFlowPaths);
  measureHeartMotion();
  updateHeartScroll();
  window.addEventListener("resize", () => {
    heartMotionMetrics = undefined;
    scheduleHeartScroll();
  }, { passive: true });
  reducedMotion.addEventListener?.("change", scheduleHeartScroll);
}

const iconDrawingEntries = new WeakMap();

function waitForIconImage(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve();

  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", reject, { once: true });
  });
}

function buildConnectedInkOrder(imageData) {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const active = new Uint8Array(pixelCount);
  const labels = new Int32Array(pixelCount);
  labels.fill(-1);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    active[pixel] = data[pixel * 4 + 3] > 0 ? 1 : 0;
  }

  const components = [];
  const neighborOffsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1]
  ];

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!active[pixel] || labels[pixel] !== -1) continue;

    const id = components.length;
    const queue = [pixel];
    const pixels = [];
    labels[pixel] = id;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const x = current % width;
      const y = Math.floor(current / width);
      pixels.push(current);

      neighborOffsets.forEach(([offsetX, offsetY]) => {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return;

        const next = nextY * width + nextX;
        if (!active[next] || labels[next] !== -1) return;
        labels[next] = id;
        queue.push(next);
      });
    }

    components.push({ id, pixels });
  }

  components.sort((componentA, componentB) => {
    const topA = Math.min(...componentA.pixels.map((pixel) => Math.floor(pixel / width)));
    const topB = Math.min(...componentB.pixels.map((pixel) => Math.floor(pixel / width)));
    if (topA !== topB) return topA - topB;

    const leftA = Math.min(...componentA.pixels.map((pixel) => pixel % width));
    const leftB = Math.min(...componentB.pixels.map((pixel) => pixel % width));
    return leftA - leftB;
  });

  const runs = components.map((component, componentIndex) => {
    const distances = new Int32Array(pixelCount);
    distances.fill(-1);
    const startFromRight = componentIndex % 2 === 1;
    let seed = component.pixels[0];
    let seedScore = Number.POSITIVE_INFINITY;

    component.pixels.forEach((pixel) => {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const score = y * 1.8 + (startFromRight ? width - x : x);
      if (score >= seedScore) return;
      seed = pixel;
      seedScore = score;
    });

    const queue = [seed];
    distances[seed] = 0;
    let maximumDistance = 0;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const x = current % width;
      const y = Math.floor(current / width);
      const nextDistance = distances[current] + 1;

      neighborOffsets.forEach(([offsetX, offsetY]) => {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return;

        const next = nextY * width + nextX;
        if (labels[next] !== component.id || distances[next] !== -1) return;
        distances[next] = nextDistance;
        maximumDistance = Math.max(maximumDistance, nextDistance);
        queue.push(next);
      });
    }

    return {
      ...component,
      distances,
      maximumDistance: Math.max(maximumDistance, 1),
      duration: Math.max(5, Math.sqrt(component.pixels.length) * 1.45)
    };
  });

  const totalDuration = runs.reduce((total, run) => total + run.duration, 0) || 1;
  const order = new Float32Array(pixelCount);
  order.fill(2);
  const activePixels = [];
  let elapsed = 0;

  runs.forEach((run) => {
    run.pixels.forEach((pixel) => {
      order[pixel] = (elapsed + (run.distances[pixel] / run.maximumDistance) * run.duration) / totalDuration;
      activePixels.push(pixel);
    });
    elapsed += run.duration;
  });

  return { order, activePixels };
}

function animateFallbackIconInk(entry, { restart = false } = {}) {
  if (entry.started && !restart) return;
  entry.started = true;
  entry.animationGeneration = (entry.animationGeneration || 0) + 1;
  const generation = entry.animationGeneration;
  window.clearTimeout(entry.delayTimer);
  entry.animation?.cancel();

  entry.image.style.clipPath = "inset(0 100% 0 0)";
  entry.image.style.opacity = "1";
  entry.stage.classList.remove("is-drawing", "is-complete");

  entry.delayTimer = window.setTimeout(() => {
    if (generation !== entry.animationGeneration) return;

    if (reducedMotion.matches || typeof entry.image.animate !== "function") {
      entry.image.style.opacity = "1";
      entry.stage.classList.add("is-complete");
      return;
    }

    entry.stage.classList.add("is-drawing");
    entry.animation = entry.image.animate([
      { clipPath: "inset(0 100% 0 0)" },
      { clipPath: "inset(0 0 0 0)" }
    ], {
      duration: 520,
      easing: "cubic-bezier(0.65, 0, 0.35, 1)",
      fill: "forwards"
    });
    entry.animation.addEventListener("finish", () => {
      if (generation !== entry.animationGeneration) return;
      entry.image.style.opacity = "1";
      entry.image.style.clipPath = "inset(0)";
      entry.stage.classList.remove("is-drawing");
      entry.stage.classList.add("is-complete");
    }, { once: true });
  }, entry.orderIndex * 150);
}

function animateIconInk(entry, { restart = false } = {}) {
  if (entry.fallback) {
    animateFallbackIconInk(entry, { restart });
    return;
  }

  if (entry.started && !restart) return;
  entry.started = true;
  entry.animationGeneration = (entry.animationGeneration || 0) + 1;
  const generation = entry.animationGeneration;
  window.clearTimeout(entry.delayTimer);

  if (restart) {
    entry.stage.classList.remove("is-drawing", "is-complete");
    entry.image.style.opacity = "0";
    entry.context.clearRect(0, 0, entry.source.width, entry.source.height);
  }

  entry.delayTimer = window.setTimeout(() => {
    if (generation !== entry.animationGeneration) return;

    if (reducedMotion.matches) {
      entry.context.putImageData(entry.source, 0, 0);
      entry.image.style.opacity = "";
      entry.stage.classList.add("is-complete");
      return;
    }

    entry.stage.classList.add("is-drawing");
    const output = entry.context.createImageData(entry.source.width, entry.source.height);
    const duration = 720;
    const startedAt = performance.now();

    function drawFrame(now) {
      if (generation !== entry.animationGeneration) return;

      const linearProgress = clamp((now - startedAt) / duration, 0, 1);
      const progress = smoothstep(0, 1, linearProgress);
      output.data.fill(0);

      entry.activePixels.forEach((pixel) => {
        const inkOrder = entry.order[pixel];
        if (inkOrder > progress) return;

        const sourceIndex = pixel * 4;
        const freshInk = progress - inkOrder < 0.035;
        for (let channel = 0; channel < 4; channel += 1) {
          output.data[sourceIndex + channel] = entry.source.data[sourceIndex + channel];
        }

        if (freshInk) {
          output.data[sourceIndex] = Math.min(255, output.data[sourceIndex] + 18);
          output.data[sourceIndex + 1] = Math.min(255, output.data[sourceIndex + 1] + 18);
          output.data[sourceIndex + 2] = Math.min(255, output.data[sourceIndex + 2] + 18);
        }
      });

      entry.context.putImageData(output, 0, 0);

      if (linearProgress < 1) {
        requestAnimationFrame(drawFrame);
        return;
      }

      entry.context.putImageData(entry.source, 0, 0);
      entry.stage.classList.remove("is-drawing");
      entry.stage.classList.add("is-complete");
      entry.image.style.opacity = "";
    }

    requestAnimationFrame(drawFrame);
  }, entry.orderIndex * 150);
}

function registerIconDrawingEntry(card, entry) {
  const entries = iconDrawingEntries.get(card) || [];
  entries.push(entry);
  entries.sort((entryA, entryB) => entryA.orderIndex - entryB.orderIndex);
  iconDrawingEntries.set(card, entries);

  entry.stage.addEventListener("mouseenter", () => {
    if (reducedMotion.matches) return;
    animateIconInk(entry, { restart: true });
  });

  if (card.classList.contains("is-icon-drawing")) animateIconInk(entry);
}

function activateServiceCardIcons(card) {
  if (card.classList.contains("is-icon-drawing")) return;
  card.classList.add("is-icon-drawing");
  (iconDrawingEntries.get(card) || []).forEach((entry) => animateIconInk(entry));
}

function replayServiceCardIcons(card) {
  if (reducedMotion.matches) return;

  (iconDrawingEntries.get(card) || []).forEach((entry) => {
    animateIconInk(entry, { restart: true });
  });

  if (card.querySelector(".service-draw-icon")) {
    card.classList.remove("is-icon-drawing");
    void card.offsetWidth;
    card.classList.add("is-icon-drawing");
  }
}

function prepareFallbackDrawIcon(image) {
  const iconGroup = image.closest(".icon-pair");
  const card = image.closest(".service-card");
  if (!iconGroup || !card || image.closest(".draw-icon-stage")) return;

  const orderIndex = [...iconGroup.querySelectorAll("[data-draw-icon]")].indexOf(image);
  const stage = document.createElement("span");
  stage.className = "draw-icon-stage is-draw-fallback";
  image.before(stage);
  stage.append(image);

  registerIconDrawingEntry(card, {
    stage,
    image,
    orderIndex,
    fallback: true,
    started: false,
    animation: undefined,
    animationGeneration: 0,
    delayTimer: undefined
  });
}

async function prepareDrawIcon(image) {
  await waitForIconImage(image);

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const renderedSize = Math.max(image.getBoundingClientRect().width, 96);
  const width = Math.max(image.naturalWidth || 162, Math.ceil(renderedSize * pixelRatio));
  const height = Math.round(width * (image.naturalHeight || 162) / (image.naturalWidth || 162));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    prepareFallbackDrawIcon(image);
    return;
  }
  sourceContext.drawImage(image, 0, 0, width, height);
  const source = sourceContext.getImageData(0, 0, width, height);
  const { order, activePixels } = buildConnectedInkOrder(source);
  const iconGroup = image.closest(".icon-pair");
  const card = image.closest(".service-card");
  if (!iconGroup || !card) return;

  const orderIndex = [...iconGroup.querySelectorAll("[data-draw-icon]")].indexOf(image);
  const stage = document.createElement("span");
  stage.className = "draw-icon-stage";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d");
  if (!context) {
    prepareFallbackDrawIcon(image);
    return;
  }

  image.before(stage);
  stage.append(image, canvas);
  stage.classList.add("is-draw-ready");

  const entry = {
    stage,
    image,
    context,
    source,
    order,
    activePixels,
    orderIndex,
    started: false,
    animationGeneration: 0,
    delayTimer: undefined
  };
  registerIconDrawingEntry(card, entry);
}

if (drawIconImages.length && !reducedMotion.matches) {
  const prepareImage = (image) => {
    prepareDrawIcon(image).catch(() => prepareFallbackDrawIcon(image));
  };
  if ("IntersectionObserver" in window) {
    const preparationObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        prepareImage(entry.target);
      });
    }, { rootMargin: "300px" });
    drawIconImages.forEach((image) => preparationObserver.observe(image));
  } else {
    drawIconImages.forEach((image, index) => {
      window.setTimeout(() => prepareImage(image), index * 50);
    });
  }
}

if (serviceCards.length && !reducedMotion.matches && "IntersectionObserver" in window) {
  const serviceIconObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const cardIndex = serviceCards.indexOf(entry.target);
      window.setTimeout(() => activateServiceCardIcons(entry.target), (cardIndex % 3) * 150);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8%", threshold: 0.18 });

  serviceCards.forEach((card) => serviceIconObserver.observe(card));
} else if (!reducedMotion.matches) {
  serviceCards.forEach(activateServiceCardIcons);
}

serviceCards.forEach((card) => {
  card.addEventListener("mouseenter", () => replayServiceCardIcons(card));
  card.addEventListener("focusin", (event) => {
    if (event.relatedTarget && card.contains(event.relatedTarget)) return;
    replayServiceCardIcons(card);
  });
});

let situationSettleTimer;
let situationFrame;
let maxSituationDelay = 0;
let situationSectionBottom;

function configureSituationMotion() {
  if (!situationGrid || !situationCards.length) return;

  const gridBounds = situationGrid.getBoundingClientRect();
  const sectionBounds = situationGrid.closest(".situations")?.getBoundingClientRect();
  situationSectionBottom = sectionBounds ? window.scrollY + sectionBounds.bottom : undefined;
  const gridCenter = gridBounds.left + gridBounds.width / 2;
  const gridColumns = getComputedStyle(situationGrid).gridTemplateColumns.split(" ").length;
  const singleColumn = gridColumns === 1;
  const rowOffsets = [];

  situationCards.forEach((card) => {
    if (!rowOffsets.some((offset) => Math.abs(offset - card.offsetTop) < 8)) {
      rowOffsets.push(card.offsetTop);
    }
  });

  rowOffsets.sort((a, b) => a - b);
  maxSituationDelay = 0;

  const regularCardGeometry = situationCards
    .map((card, index) => {
      if (card.classList.contains("situation-card-featured")) return null;

      const cardBounds = card.getBoundingClientRect();
      const cardCenter = cardBounds.left + cardBounds.width / 2;
      const rowIndex = rowOffsets.findIndex((offset) => Math.abs(offset - card.offsetTop) < 8);
      const geometricSide = clamp((cardCenter - gridCenter) / Math.max(gridBounds.width / 2, 1), -1, 1);

      return { card, geometricSide, index, rowIndex };
    })
    .filter(Boolean);

  const rowRanges = new Map();
  regularCardGeometry.forEach(({ geometricSide, rowIndex }) => {
    const distance = Math.abs(geometricSide);
    const range = rowRanges.get(rowIndex) || { minimum: distance, maximum: distance };
    range.minimum = Math.min(range.minimum, distance);
    range.maximum = Math.max(range.maximum, distance);
    rowRanges.set(rowIndex, range);
  });

  regularCardGeometry.forEach(({ card, geometricSide, index, rowIndex }) => {
    const motionSide = singleColumn ? (index % 2 === 0 ? -0.3 : 0.3) : geometricSide;
    const horizontalDistance = singleColumn ? motionSide * 34 : motionSide * 54;
    const rowRange = rowRanges.get(rowIndex);
    const rangeSize = rowRange ? rowRange.maximum - rowRange.minimum : 0;
    const inwardStep = !rowRange || rangeSize < 0.01
      ? 0
      : (rowRange.maximum - Math.abs(geometricSide)) / rangeSize;
    const rowCadence = gridColumns === 2 ? 190 : 225;
    const entryDelay = singleColumn
      ? rowIndex * 88
      : rowIndex * rowCadence + Math.round(inwardStep * 125);

    card.dataset.motionSide = motionSide.toFixed(3);
    card.style.setProperty("--entry-x", `${horizontalDistance.toFixed(2)}px`);
    card.style.setProperty("--entry-y", `${singleColumn ? 25 : 34 + rowIndex * 6}px`);
    card.style.setProperty("--entry-rotate", `${(motionSide * 1.35).toFixed(2)}deg`);
    card.style.setProperty("--entry-delay", `${entryDelay}ms`);
    maxSituationDelay = Math.max(maxSituationDelay, entryDelay);
  });

  const featuredCard = situationCards.find((card) => card.classList.contains("situation-card-featured"));
  if (featuredCard) {
    const featuredDelay = maxSituationDelay + (singleColumn ? 125 : 175);
    featuredCard.dataset.motionSide = "0";
    featuredCard.style.setProperty("--entry-x", "0px");
    featuredCard.style.setProperty("--entry-y", `${singleColumn ? 24 : 32}px`);
    featuredCard.style.setProperty("--entry-rotate", "0deg");
    featuredCard.style.setProperty("--entry-delay", `${featuredDelay}ms`);
    maxSituationDelay = featuredDelay;
  }
}

function updateSituationExit() {
  if (!situationGrid?.classList.contains("is-motion-settled")) return;

  if (!situationSectionBottom) configureSituationMotion();
  if (!situationSectionBottom) return;

  const exitRange = window.innerHeight * 0.72;
  const sectionBottom = situationSectionBottom - window.scrollY;
  const progress = clamp((exitRange - sectionBottom) / Math.max(exitRange, 1), 0, 1);

  situationCards.forEach((card) => {
    const side = Number(card.dataset.motionSide || 0);
    const edgeWeight = Math.abs(side);
    card.style.setProperty("--exit-x", `${(side * 19 * progress).toFixed(2)}px`);
    card.style.setProperty("--exit-y", `${(-(7 + edgeWeight * 7) * progress).toFixed(2)}px`);
    card.style.setProperty("--exit-scale", (1 - 0.012 * progress).toFixed(4));
    card.style.setProperty("--exit-rotate", `${(side * 0.32 * progress).toFixed(3)}deg`);
    card.style.setProperty("--exit-opacity", (1 - 0.08 * progress).toFixed(3));
  });
}

function scheduleSituationExit() {
  if (situationFrame) return;
  situationFrame = requestAnimationFrame(() => {
    updateSituationExit();
    situationFrame = undefined;
  });
}

function revealSituationGrid() {
  if (!situationGrid || situationGrid.classList.contains("is-grid-visible")) return;

  situationGrid.classList.add("is-grid-visible");
  window.clearTimeout(situationSettleTimer);
  situationSettleTimer = window.setTimeout(() => {
    situationGrid.classList.add("is-motion-settled");
    updateSituationExit();
  }, maxSituationDelay + 1120);
}

if (situationGrid) {
  configureSituationMotion();

  if ("IntersectionObserver" in window && !reducedMotion.matches) {
    const situationObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        revealSituationGrid();
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -6%", threshold: 0.12 });

    situationObserver.observe(situationGrid);
  } else {
    situationGrid.classList.add("is-grid-visible", "is-motion-settled");
  }

}

let pageScrollFrame;

function schedulePageScroll() {
  if (pageScrollFrame) return;
  pageScrollFrame = requestAnimationFrame(() => {
    updatePersistentUI();
    if (!reducedMotion.matches) {
      updateHeartScroll();
      updateSituationExit();
      updateCareMomentParallax();
      updateDetailHeroParallax();
    }
    pageScrollFrame = undefined;
  });
}

window.addEventListener("scroll", schedulePageScroll, { passive: true });

if (finalCtaMedia) {
  const loadFinalCtaMedia = () => finalCtaMedia.classList.add("is-loaded");

  if ("IntersectionObserver" in window) {
    const finalCtaMediaObserver = new IntersectionObserver((entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      loadFinalCtaMedia();
      observer.disconnect();
    }, { rootMargin: "600px 0px", threshold: 0 });

    finalCtaMediaObserver.observe(finalCtaMedia);
  } else {
    loadFinalCtaMedia();
  }
}

if (heroStage && window.matchMedia("(pointer: fine)").matches && !reducedMotion.matches) {
  const hero = heroStage.closest(".hero");
  hero?.addEventListener("pointermove", (event) => {
    const bounds = hero.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 14;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 10;
    heroStage.style.setProperty("--hero-x", `${x.toFixed(2)}px`);
    heroStage.style.setProperty("--hero-y", `${y.toFixed(2)}px`);
  });
  hero?.addEventListener("pointerleave", () => {
    heroStage.style.setProperty("--hero-x", "0px");
    heroStage.style.setProperty("--hero-y", "0px");
  });
}

document.querySelectorAll(".faq-list details").forEach((detail) => {
  detail.addEventListener("toggle", () => {
    if (!detail.open) return;
    document.querySelectorAll(".faq-list details").forEach((other) => {
      if (other !== detail) other.open = false;
    });
  });
});

function setContactPanelOpen(open) {
  if (!contactPanel || !contactLauncher) return;
  contactPanel.hidden = !open;
  contactLauncher.setAttribute("aria-expanded", String(open));
  if (open) {
    contactPanel.classList.add("is-opening");
    contactPanelClose?.focus();
  } else {
    contactPanel.classList.remove("is-opening");
    contactLauncher.focus();
  }
  updatePersistentUI();
}

contactLauncher?.addEventListener("click", () => setContactPanelOpen(contactPanel?.hidden ?? true));
contactPanelClose?.addEventListener("click", () => setContactPanelOpen(false));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (contactPanel && !contactPanel.hidden) {
    setContactPanelOpen(false);
    return;
  }
  closeMenu();
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 900) closeMenu();
  scheduleHeartScroll();
  configureSituationMotion();
  scheduleSituationExit();
  updateCareMomentParallax();
  updateDetailHeroParallax();
});

updateCareMomentParallax();
updateDetailHeroParallax();
