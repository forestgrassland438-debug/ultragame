// UltraGame 1.0.0
/**
 * Tipos de UltraGame 1.0 (escritos a mano; cubren la API pública principal).
 * Uso: <script src="ultragame.js"> expone `UG` / `UltraGame`; con módulos: `import UG from './ultragame.esm.js'`.
 */
declare namespace UG {
  const VERSION: string;
  type ColorInput = number | string;
  type RendererType = 'webgpu' | 'webgl2' | 'webgl' | 'canvas';
  type BlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'erase' | 'none' | 'lighten' | 'darken' | 'inherit';
  let defaultRendererOrder: RendererType[];

  /* ------------------------------------------------------------ utilidades */
  class EventEmitter {
    on(event: string, fn: (...args: any[]) => void, context?: any): this;
    once(event: string, fn: (...args: any[]) => void, context?: any): this;
    off(event?: string, fn?: (...args: any[]) => void, context?: any): this;
    emit(event: string, ...args: any[]): boolean;
    listenerCount(event?: string): number;
  }
  class Vec2 { constructor(x?: number, y?: number); x: number; y: number; set(x: number, y?: number): this; copy(v: { x: number; y: number }): this; clone(): Vec2; add(v: Vec2): this; subtract(v: Vec2): this; scale(s: number): this; length(): number; normalize(): this; angle(): number; dot(v: Vec2): number; }
  type Point = Vec2;
  class Matrix { a: number; b: number; c: number; d: number; tx: number; ty: number; set(a: number, b: number, c: number, d: number, tx: number, ty: number): this; identity(): this; apply(x: number, y: number, out?: Vec2): Vec2; applyInverse(x: number, y: number, out?: Vec2): Vec2; append(m: Matrix): this; invert(): this; clone(): Matrix; copyFrom(m: Matrix): this; setTransform(x: number, y: number, pivotX: number, pivotY: number, scaleX: number, scaleY: number, rotation: number, skewX: number, skewY: number): this; }
  class Rectangle { constructor(x?: number, y?: number, width?: number, height?: number); x: number; y: number; width: number; height: number; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; readonly centerX: number; readonly centerY: number; contains(x: number, y: number): boolean; intersects(r: Rectangle): boolean; set(x: number, y: number, w: number, h: number): this; clone(): Rectangle; getRandomPoint(rng?: RNG, out?: Vec2): Vec2; }
  class Circle { constructor(x?: number, y?: number, radius?: number); x: number; y: number; radius: number; contains(x: number, y: number): boolean; getRandomPoint(rng?: RNG, out?: Vec2): Vec2; }
  class Ellipse { constructor(x?: number, y?: number, width?: number, height?: number); contains(x: number, y: number): boolean; }
  class Polygon { constructor(points: number[] | { x: number; y: number }[]); points: number[]; readonly area: number; contains(x: number, y: number): boolean; }
  class Line { constructor(x1?: number, y1?: number, x2?: number, y2?: number); }
  class Bounds { minX: number; minY: number; maxX: number; maxY: number; readonly isEmpty: boolean; }

  /** Generador pseudoaleatorio determinista (xoshiro128**) */
  class RNG {
    constructor(seed?: number | string);
    setSeed(seed: number | string): this; next(): number; /** [0,1) · float(max) -> [0,max) · float(min,max) -> [min,max) */ float(min?: number, max?: number): number; int(min: number, max: number): number; between(min: number, max: number): number;
    chance(p: number): boolean; pick<T>(arr: T[]): T; shuffle<T>(arr: T[]): T[]; angle(): number; sign(): number; gaussian(mean?: number, sd?: number): number;
    getState(): any; setState(state: any): this;
  }
  const rng: RNG;

  const Math: {
    PI2: number; DEG_TO_RAD: number; RAD_TO_DEG: number;
    clamp(v: number, min: number, max: number): number; lerp(a: number, b: number, t: number): number; inverseLerp(a: number, b: number, v: number): number;
    remap(v: number, a1: number, b1: number, a2: number, b2: number): number; wrap(v: number, min: number, max: number): number; wrapAngle(a: number): number;
    degToRad(d: number): number; radToDeg(r: number): number; distance(x1: number, y1: number, x2: number, y2: number): number; distanceSq(x1: number, y1: number, x2: number, y2: number): number;
    angleBetween(x1: number, y1: number, x2: number, y2: number): number; shortestAngle(from: number, to: number): number; rotateTo(current: number, target: number, step: number): number;
    approach(v: number, target: number, step: number): number; damp(a: number, b: number, lambda: number, dt: number): number; snapTo(v: number, step: number): number; snapFloor(v: number, step: number): number;
    smoothstep(e0: number, e1: number, x: number): number; smootherstep(e0: number, e1: number, x: number): number; fract(v: number): number; pingPong(t: number, len: number): number;
    fuzzyEqual(a: number, b: number, eps?: number): boolean; isPowerOfTwo(v: number): boolean; nextPowerOfTwo(v: number): number; sign(v: number): number; average(values: number[]): number;
  };
  /** Alias de UG.Math (nombre interno) */
  const MathUtils: typeof Math;
  const Color: {
    toNumber(c: ColorInput): number; toHex(c: number): string; toCSS(c: number, alpha?: number): string; alphaOf(c: ColorInput): number;
    fromRGB(r: number, g: number, b: number): number; lerp(a: number, b: number, t: number): number; multiply(a: number, b: number): number;
    brighten(c: number, amount: number): number; darken(c: number, amount: number): number; fromHSL(h: number, s: number, l: number): number; toHSV(c: number): { h: number; s: number; v: number }; random(rng?: RNG, min?: number, max?: number): number;
  };
  type EaseFunction = (t: number) => number;
  const Easing: { names: string[]; get(name: string | EaseFunction): EaseFunction; [name: string]: any };

  const Security: {
    allowedOrigins: string[] | null; maxFileSize: number; maxTextureSize: number; maxMapTiles: number; maxTextLength: number; maxParticles: number;
    isSafeURL(url: string): boolean; sanitizeText(text: string, maxLength?: number): string; isForbiddenKey(key: string): boolean;
    safeMerge<T>(target: T, source: any): T; deepFreeze<T>(obj: T): T; secureRandom(): number; secureRandomInt(min: number, max: number): number;
    sha256(data: string | Uint8Array): string; verifyIntegrity(data: string | Uint8Array, sri: string): boolean;
  };
  const Capabilities: { webgpu(): boolean; webgl2(): boolean; webgl(): boolean; canvas(): boolean; [k: string]: any };
  const Debug: { live: Record<string, number>; track(type: string, delta: number): void; snapshot(): Record<string, number>; diff(a: Record<string, number>, b: Record<string, number>): Record<string, [number, number]>; inspect(obj: any, depth?: number): any; hashState(state: any): string };
  const Wasm: { ready: boolean; supported: boolean; simd: boolean; error: string | null; init(): Promise<boolean> };

  /* ------------------------------------------------------------ juego */
  interface ScaleConfig { mode?: 'fit' | 'envelop' | 'fill' | 'resize' | 'none'; autoCenter?: boolean; width?: number; height?: number; }
  interface GameConfig {
    width?: number; height?: number; parent?: string | HTMLElement; canvas?: HTMLCanvasElement; backgroundColor?: ColorInput; transparent?: boolean;
    renderer?: 'auto' | RendererType | RendererType[]; antialias?: boolean; pixelArt?: boolean; roundPixels?: boolean; resolution?: number | 'auto'; maxResolution?: number;
    powerPreference?: 'high-performance' | 'low-power' | 'default'; preserveDrawingBuffer?: boolean; maxTextures?: number; scale?: ScaleConfig;
    fps?: { target?: number; fixedStep?: number; maxDelta?: number; forceSetTimeout?: boolean };
    physics?: { arcade?: { gravity?: { x?: number; y?: number }; debug?: boolean; fps?: number } };
    audio?: { noAudio?: boolean; maxInstances?: number }; input?: any; scenes?: (SceneConfig | (new () => Scene))[]; seed?: number | string;
    banner?: boolean; stats?: boolean; loaderUI?: boolean; security?: Partial<typeof Security>; title?: string; cull?: boolean; pauseOnHidden?: boolean; autoStart?: boolean;
  }
  class Game extends EventEmitter {
    constructor(config?: GameConfig);
    readonly ready: Promise<Game>; readonly width: number; readonly height: number; readonly canvas: HTMLCanvasElement; readonly rendererType: RendererType;
    readonly renderer: any; readonly loop: GameLoop; readonly scene: SceneManager; readonly textures: TextureManager; readonly sound: SoundManager; readonly scale: ScaleManager;
    readonly config: GameConfig; readonly fps: number;
    snapshot(type?: string, quality?: number): Promise<string>; pause(): this; resume(): this; isPaused(): boolean; destroy(removeCanvas?: boolean): void;
    getRecorder(): Recorder;
  }
  class GameLoop { running: boolean; delta: number; actualFps: number; start(): this; stop(): this; step(deltaMs?: number): this; }
  class ScaleManager extends EventEmitter { mode: string; toggleFullscreen(): void; startFullscreen(): void; stopFullscreen(): void; refresh(): void; }

  /* ------------------------------------------------------------ escenas */
  interface SceneConfig {
    key: string; active?: boolean; visible?: boolean;
    init?(this: Scene, data?: any): void; preload?(this: Scene): void; create?(this: Scene, data?: any): void; update?(this: Scene, time: number, delta: number): void;
    [extra: string]: any;
  }
  class Scene {
    readonly sys: any; readonly game: Game; readonly add: GameObjectFactory; readonly make: GameObjectCreator; readonly load: Loader; readonly textures: TextureManager;
    readonly anims: AnimationManager; readonly tweens: TweenManager; readonly time: Clock; readonly input: InputPlugin; readonly physics: ArcadePhysics;
    readonly cameras: CameraManager; readonly sound: SoundManager; readonly scene: ScenePlugin; readonly events: EventEmitter; readonly rng: RNG;
    readonly world: Container; readonly hud: Container;
    [extra: string]: any;
  }
  class ScenePlugin {
    readonly key: string;
    start(key?: string, data?: any): this; restart(data?: any): this; launch(key: string, data?: any): this; run(key: string, data?: any): this; stop(key?: string): this;
    pause(key?: string): this; resume(key?: string): this; sleep(key?: string): this; wake(key?: string, data?: any): this; switch(key: string, data?: any): this;
    transition(config: { target: string; duration?: number; data?: any }): this; bringToTop(key?: string): this; sendToBack(key?: string): this;
    get(key: string): Scene; isActive(key?: string): boolean; isPaused(key?: string): boolean; isSleeping(key?: string): boolean;
  }
  class SceneManager { add(key: string, config: SceneConfig, autoStart?: boolean, data?: any): Scene; start(key: string, data?: any): this; stop(key: string): this; getScene(key: string): Scene | null; getScenes(activeOnly?: boolean): Scene[]; isActive(key: string): boolean; pause(key: string): this; resume(key: string): this; launch(key: string, data?: any): this; }

  interface TextStyle {
    fontFamily?: string; fontSize?: number | string; fontWeight?: string | number; fontStyle?: string; fill?: ColorInput | ColorInput[] | null; fillGradientStops?: number[];
    stroke?: ColorInput; strokeThickness?: number; align?: 'left' | 'center' | 'right'; wordWrap?: boolean; wordWrapWidth?: number; breakWords?: boolean; maxLines?: number;
    lineHeight?: number; leading?: number; letterSpacing?: number; padding?: number; resolution?: number; backgroundColor?: ColorInput | null; backgroundAlpha?: number;
    fixedWidth?: number; fixedHeight?: number; lineJoin?: CanvasLineJoin; miterLimit?: number;
    dropShadow?: { offsetX?: number; offsetY?: number; blur?: number; color?: ColorInput; alpha?: number };
  }
  class GameObjectFactory {
    readonly hud: GameObjectFactory;
    existing<T extends DisplayObject>(obj: T): T;
    sprite(x: number, y: number, key?: string, frame?: string | number): Sprite; image(x: number, y: number, key?: string, frame?: string | number): Sprite;
    animatedSprite(x: number, y: number, textures: (string | Texture)[] | string, options?: any): AnimatedSprite; text(x: number, y: number, text: string, style?: TextStyle): Text;
    bitmapText(x: number, y: number, font: string, text?: string, size?: number, align?: 'left' | 'center' | 'right'): BitmapText; graphics(options?: any): Graphics; container(x?: number, y?: number, children?: DisplayObject[]): Container;
    group(config?: GroupConfig): Group; rectangle(x: number, y: number, w: number, h: number, fill?: ColorInput, alpha?: number): ShapeObject; roundRectangle(x: number, y: number, w: number, h: number, radius?: number, fill?: ColorInput, alpha?: number): ShapeObject;
    circle(x: number, y: number, r: number, fill?: ColorInput, alpha?: number): ShapeObject; ellipse(x: number, y: number, w: number, h: number, fill?: ColorInput, alpha?: number): ShapeObject;
    triangle(x: number, y: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, fill?: ColorInput, alpha?: number): ShapeObject; polygon(x: number, y: number, points: number[], fill?: ColorInput, alpha?: number): ShapeObject;
    star(x: number, y: number, points: number, inner: number, outer: number, fill?: ColorInput, alpha?: number): ShapeObject; line(x: number, y: number, x1: number, y1: number, x2: number, y2: number, color?: ColorInput, alpha?: number): ShapeObject;
    tileSprite(x: number, y: number, w: number, h: number, key: string, frame?: string | number): TilingSprite; tilingSprite(x: number, y: number, w: number, h: number, key: string, frame?: string | number): TilingSprite;
    nineSlice(x: number, y: number, key: string, frame: string | number | undefined, w: number, h: number, left: number, right?: number, top?: number, bottom?: number): NineSlice;
    mesh(x: number, y: number, key: string, frame: string | number | undefined, vertices: number[], uvs: number[], indices?: number[]): Mesh; rope(x: number, y: number, key: string, frame: string | number | undefined, points: Vec2[], options?: any): Rope;
    renderTexture(x: number, y: number, w: number, h: number, resolution?: number): RenderTextureObject; particles(key: string, config?: ParticleConfig): ParticleEmitter; particles(x: number, y: number, key: string, config?: ParticleConfig): ParticleEmitter; particleContainer(options?: any): ParticleContainer;
    zone(x: number, y: number, w: number, h: number): Zone; tilemap(keyOrData: string | object): Tilemap; tween(config: TweenConfig): Tween; timeline(config: any): TweenChain;
    button(x: number, y: number, options: ButtonOptions | string): Button; panel(x: number, y: number, w: number, h: number, options?: any): Panel; progressBar(x: number, y: number, w: number, h: number, options?: any): ProgressBar;
    joystick(options: { x: number; y: number; radius?: number; mode?: '360' | '8dir' | '4dir' }): VirtualJoystick; virtualButton(options: { x: number; y: number; radius?: number; label?: string; color?: ColorInput }): VirtualButton;
  }
  class GameObjectCreator { sprite(config: any): Sprite; image(config: any): Sprite; text(config: any): Text; bitmapText(config: any): BitmapText; graphics(config?: any): Graphics; container(config?: any): Container; tileSprite(config: any): TilingSprite; particles(config: any): ParticleEmitter; fromJSON(json: any): DisplayObject; }

  /* ------------------------------------------------------------ objetos */
  class DisplayObject extends EventEmitter {
    x: number; y: number; scaleX: number; scaleY: number; scale: number | Vec2; rotation: number; angle: number; skewX: number; skewY: number; pivotX: number; pivotY: number;
    alpha: number; tint: number; blendMode: BlendMode; visible: boolean; active: boolean; depth: number; zIndex: number; name: string; parent: Container | null; readonly destroyed: boolean;
    filters: Filter[] | null; mask: DisplayObject | Rectangle | null; maskInvert: boolean; clipRect: Rectangle | null; cacheAsTexture: boolean; cacheResolution: number;
    scrollFactorX: number; scrollFactorY: number; cullable: boolean; body: Body | null; scene: Scene | null; cameraFilter: number;
    setPosition(x: number, y?: number): this; setX(x: number): this; setY(y: number): this; setScale(x: number, y?: number): this; setRotation(r: number): this; setAngle(deg: number): this;
    setAlpha(a: number): this; setTint(c: ColorInput): this; clearTint(): this; setBlendMode(m: BlendMode): this; setVisible(v: boolean): this; setActive(v: boolean): this;
    setDepth(d: number): this; setZIndex(z: number): this; setName(n: string): this; setScrollFactor(x: number, y?: number): this; setSkew(x: number, y?: number): this; setPivot(x: number, y?: number): this;
    setFilters(f: Filter | Filter[] | null): this; addFilter(f: Filter): this; removeFilter(f: Filter): this; setMask(m: DisplayObject | Rectangle | null): this; clearMask(): this; setClip(x: number | Rectangle, y?: number, w?: number, h?: number): this;
    setCacheAsTexture(v?: boolean): this; updateCacheTexture(): this; setData(key: string, value: any): this; getData(key: string): any;
    setInteractive(options?: { cursor?: string; draggable?: boolean; hitArea?: any; pixelPerfect?: boolean; autoDrag?: boolean }): this; disableInteractive(): this; removeInteractive(): this;
    getBounds(out?: Rectangle): Rectangle; getLocalBounds(out?: Rectangle): Rectangle; toGlobal(x: number, y: number, out?: Vec2): Vec2; toLocal(x: number, y: number, out?: Vec2): Vec2;
    getWorldMatrix(out?: Matrix): Matrix; hitTestLocal(x: number, y: number): boolean; removeFromParent(): this; destroy(options?: boolean | { children?: boolean }): void;
  }
  class Container extends DisplayObject {
    constructor(x?: number, y?: number); readonly children: DisplayObject[]; readonly length: number; sortableChildren: boolean;
    add<T extends DisplayObject>(child: T | T[]): T; addChild<T extends DisplayObject>(child: T): T; addChildAt<T extends DisplayObject>(child: T, index: number): T; remove(child: DisplayObject, destroy?: boolean): this;
    removeChild<T extends DisplayObject>(child: T): T; removeChildAt(i: number): DisplayObject; removeChildren(): DisplayObject[]; removeAll(destroy?: boolean): this; getChildAt(i: number): DisplayObject; getChildIndex(c: DisplayObject): number;
    setChildIndex(c: DisplayObject, i: number): this; swapChildren(a: DisplayObject, b: DisplayObject): this; bringToTop(c: DisplayObject): this; sendToBack(c: DisplayObject): this; getByName(n: string): DisplayObject | null;
    contains(c: DisplayObject): boolean; each(fn: (c: DisplayObject, i: number) => void): this; walk(fn: (c: DisplayObject) => void): this; sortChildren(): this; setSortableChildren(v?: boolean): this;
    readonly width: number; readonly height: number;
  }
  class Sprite extends Container {
    constructor(x?: number, y?: number, texture?: string | Texture, frame?: string | number);
    texture: Texture; frame: any; originX: number; originY: number; flipX: boolean; flipY: boolean; roundPixels: boolean; width: number; height: number; displayWidth: number; displayHeight: number;
    anims: AnimationState | null; readonly isPlaying: boolean;
    setTexture(key: string | Texture, frame?: string | number): this; setFrame(frame: string | number): this; setOrigin(x: number, y?: number): this; setAnchor(x: number, y?: number): this;
    setFlip(x: boolean, y: boolean): this; setFlipX(v: boolean): this; setFlipY(v: boolean): this; toggleFlipX(): this; toggleFlipY(): this; setDisplaySize(w: number, h: number): this; setSize(w: number, h: number): this; setRoundPixels(v?: boolean): this;
    play(key: string, ignoreIfPlaying?: boolean): this; playReverse(key: string, ignoreIfPlaying?: boolean): this; chain(key: string | string[]): this; stop(): this;
  }
  class AnimatedSprite extends Sprite {}
  class Text extends Sprite { constructor(x: number, y: number, text: string, style?: TextStyle); text: string; style: TextStyle; lines: string[]; setText(t: string | string[]): this; setStyle(s: TextStyle): this; setFontSize(s: number): this; setFontFamily(f: string): this; setColor(c: ColorInput): this; setFill(c: ColorInput): this; setStroke(c: ColorInput, thickness: number): this; setShadow(x: number, y: number, color?: ColorInput, blur?: number): this; setAlign(a: string): this; setWordWrapWidth(w: number): this; setPadding(p: number): this; setResolution(r: number): this; setLetterSpacing(v: number): this; setLineSpacing(v: number): this; setBackgroundColor(c: ColorInput): this; updateText(res?: number): this; }
  class BitmapText extends Container { constructor(x: number, y: number, font: string, text?: string, size?: number); text: string; setText(t: string): this; setOrigin(x: number, y?: number): this; setFontSize(s: number): this; setLetterSpacing(v: number): this; }
  class BitmapFont { static generate(name: string, options?: any): BitmapFont; }
  class TilingSprite extends Sprite { tilePositionX: number; tilePositionY: number; tileScaleX: number; tileScaleY: number; readonly tilePosition: Vec2; }
  const TileSprite: typeof TilingSprite;
  class NineSlice extends Container { setSize(w: number, h: number): this; }
  class Mesh extends Container { constructor(texture?: Texture, vertices?: number[] | Float32Array, uvs?: number[] | Float32Array, indices?: number[] | Uint32Array, colors?: number[] | Uint32Array); texture: Texture; vertices: Float32Array; uvs: Float32Array; indices: Uint32Array | Uint16Array | null; colors: Uint32Array | null; dirty: boolean; readonly vertexCount: number; }
  class Rope extends Mesh { points: Vec2[]; }
  class ShapeObject extends Graphics { fillColor: number; fillAlpha: number; strokeColor: number; strokeAlpha: number; lineWidth: number; setFillStyle(color?: ColorInput, alpha?: number): this; setStrokeStyle(width?: number, color?: ColorInput, alpha?: number): this; setOrigin(x: number, y?: number): this; }
  class Zone extends Container { constructor(x: number, y: number, width: number, height: number); width: number; height: number; setSize(w: number, h: number): this; }
  interface GroupConfig { classType?: any; defaultKey?: string; key?: string; defaultFrame?: string | number; maxSize?: number; quantity?: number; runChildUpdate?: boolean; createCallback?: (o: any) => void; removeCallback?: (o: any) => void; allowGravity?: boolean; immovable?: boolean; velocityX?: number; velocityY?: number; bounce?: number; collideWorldBounds?: boolean; [k: string]: any; }
  class Group extends EventEmitter {
    constructor(scene: Scene | null, config?: GroupConfig); readonly children: any[]; readonly length: number; maxSize: number;
    add<T>(obj: T, addToContainer?: boolean): T; create(x?: number, y?: number, key?: string, frame?: string | number, visible?: boolean, active?: boolean): any; createMultiple(cfg: any): any[];
    get(x?: number, y?: number, key?: string, frame?: string | number): any; getFirstAlive(): any; getFirstDead(createIfNull?: boolean): any; killAndHide(obj: any): this; kill(obj: any): this;
    countActive(value?: boolean): number; getChildren(): any[]; getMatching(prop: string, value: any): any[]; contains(o: any): boolean; each(fn: (o: any, i: number) => void): this; setVisible(v: boolean): this; isFull(): boolean; destroy(destroyChildren?: boolean): void;
  }
  class PhysicsGroup extends Group { refresh(): this; setVelocity(x: number, y: number): this; setVelocityX(x: number): this; }

  class Graphics extends Container {
    constructor(options?: any); curveQuality: number;
    clear(): this; fillStyle(color: ColorInput | { color?: ColorInput; alpha?: number; gradient?: any }, alpha?: number): this; lineStyle(width: number, color?: ColorInput, alpha?: number, alignment?: number): this;
    fillGradientStyle(tl: ColorInput, tr: ColorInput, bl: ColorInput, br: ColorInput, alphaTL?: number, alphaTR?: number, alphaBL?: number, alphaBR?: number): this; setLineJoin(j: 'miter' | 'round' | 'bevel'): this; setLineCap(c: 'butt' | 'round' | 'square'): this;
    fillRect(x: number, y: number, w: number, h: number): this; strokeRect(x: number, y: number, w: number, h: number): this; fillRoundedRect(x: number, y: number, w: number, h: number, r?: number | { tl: number; tr: number; br: number; bl: number }): this; strokeRoundedRect(x: number, y: number, w: number, h: number, r?: number | object): this;
    fillCircle(x: number, y: number, r: number): this; strokeCircle(x: number, y: number, r: number): this; fillEllipse(x: number, y: number, w: number, h: number): this; strokeEllipse(x: number, y: number, w: number, h: number): this;
    fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): this; strokeTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): this;
    fillPoints(points: number[] | { x: number; y: number }[], close?: boolean): this; strokePoints(points: number[] | { x: number; y: number }[], close?: boolean): this;
    fillStar(x: number, y: number, points: number, radius: number, inner?: number, rotation?: number): this; strokeStar(x: number, y: number, points: number, radius: number, inner?: number, rotation?: number): this;
    lineBetween(x1: number, y1: number, x2: number, y2: number): this; fillPoint(x: number, y: number, size?: number): this;
    beginPath(): this; moveTo(x: number, y: number): this; lineTo(x: number, y: number): this; arc(x: number, y: number, r: number, start: number, end: number, anticlockwise?: boolean): this; arcTo(x1: number, y1: number, x2: number, y2: number, r: number): this;
    quadraticCurveTo(cx: number, cy: number, x: number, y: number): this; bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this; closePath(): this;
    rect(x: number, y: number, w: number, h: number): this; roundRect(x: number, y: number, w: number, h: number, r?: number): this; circle(x: number, y: number, r: number): this; ellipse(x: number, y: number, rx: number, ry?: number): this;
    poly(points: number[] | { x: number; y: number }[], close?: boolean): this; star(x: number, y: number, points: number, radius: number, inner?: number, rotation?: number): this; regularPoly(x: number, y: number, radius: number, sides: number, rotation?: number): this;
    fill(): this; stroke(): this; fillPath(): this; strokePath(): this; cut(): this; generateTexture(key: string, width?: number, height?: number): Texture;
    beginFill(color: ColorInput, alpha?: number): this; endFill(): this; drawRect(x: number, y: number, w: number, h: number): this; drawCircle(x: number, y: number, r: number): this; drawRoundedRect(x: number, y: number, w: number, h: number, r: number): this; drawPolygon(points: number[]): this;
    readonly isEmpty: boolean;
  }

  /* ------------------------------------------------------------ texturas */
  class TextureSource { width: number; height: number; resolution: number; scaleMode: 'linear' | 'nearest'; wrapMode: 'clamp' | 'repeat' | 'mirror'; dynamic: boolean; readonly destroyed: boolean; static defaultScaleMode: 'linear' | 'nearest'; update(): this; setScaleMode(m: 'linear' | 'nearest'): this; setWrapMode(m: string): this; destroy(): void; }
  class Texture { constructor(source: TextureSource, frame?: Rectangle); source: TextureSource; frame: Rectangle; orig: Rectangle; key: string; readonly width: number; readonly height: number; static WHITE: Texture; static EMPTY: Texture; static fromCanvas(c: HTMLCanvasElement, o?: any): Texture; static fromImage(i: HTMLImageElement, o?: any): Texture; destroy(destroySource?: boolean): void; }
  class RenderTexture extends Texture { constructor(width: number, height: number, resolution?: number, options?: any); resize(width: number, height: number, resolution?: number): this; }
  class RenderTextureObject extends Sprite { readonly rt: RenderTexture; draw(obj: DisplayObject | string | Texture | (DisplayObject | string)[], x?: number, y?: number, alpha?: number, tint?: number): this; stamp(key: string | Texture, frame: string | number | undefined, x: number, y: number, config?: { alpha?: number; tint?: number; rotation?: number; scale?: number; scaleX?: number; scaleY?: number; blendMode?: BlendMode; originX?: number; originY?: number }): this; erase(obj: DisplayObject | string, x?: number, y?: number): this; fill(color: ColorInput, alpha?: number, x?: number, y?: number, w?: number, h?: number): this; clear(): this; resize(w: number, h: number): this; snapshot(): Promise<string>; }
  class TextureManager extends EventEmitter {
    exists(key: string): boolean; get(key: string, frame?: string | number): Texture; remove(key: string): this;
    addImage(key: string, image: HTMLImageElement | HTMLCanvasElement | ImageBitmap, options?: any): any; addCanvas(key: string, canvas: HTMLCanvasElement, options?: any): any;
    addSpriteSheet(key: string, image: CanvasImageSource, config: { frameWidth: number; frameHeight?: number; margin?: number; spacing?: number; startFrame?: number; endFrame?: number }): any;
    addAtlas(key: string, image: CanvasImageSource, data: any): any; addFrame(key: string, name: string | number, x: number, y: number, w: number, h: number): Texture;
    generate(key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, options?: { resolution?: number; scaleMode?: 'linear' | 'nearest'; frameWidth?: number; frameHeight?: number; margin?: number; spacing?: number }): any;
    createCanvas(key: string, width: number, height: number, options?: any): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; texture: any; refresh(): void };
    fromDisplayObject(key: string, obj: DisplayObject, options?: any): any;
  }

  /* ------------------------------------------------------------ carga */
  interface LoadOptions { integrity?: string; timeout?: number; [k: string]: any; }
  class Loader extends EventEmitter {
    readonly progress: number; timeout: number; readonly isLoading: boolean;
    setPath(p: string): this; setBaseURL(u: string): this; setCORS(mode: string): this; start(): this; reset(): this; abort(): this;
    image(key: string, url?: string, opts?: LoadOptions): this; svg(key: string, url: string, opts?: LoadOptions): this; spritesheet(key: string, url: string, frameConfig: { frameWidth: number; frameHeight?: number; margin?: number; spacing?: number }): this;
    atlas(key: string, textureURL: string, atlasURL?: string | object, opts?: LoadOptions): this; json(key: string, url: string | object, opts?: LoadOptions): this; text(key: string, url: string, opts?: LoadOptions): this;
    xml(key: string, url: string, opts?: LoadOptions): this; binary(key: string, url: string, opts?: LoadOptions): this; audio(key: string, urls: string | string[], opts?: LoadOptions): this; audioSprite(key: string, json: string, urls: string | string[]): this;
    tilemapTiledJSON(key: string, urlOrData: string | object, opts?: LoadOptions): this; tilemapTMX(key: string, urlOrData: string, opts?: LoadOptions): this; tilemap(key: string, url: string, opts?: LoadOptions): this;
    bitmapFont(key: string, textureURL: string, fontDataURL?: string, opts?: LoadOptions): this; font(family: string, url: string, descriptors?: FontFaceDescriptors): this;
    sfx(key: string, spec?: string | object): this; music(key: string, def: MusicDef): this; generate(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): this;
  }

  /* ------------------------------------------------------------ animación y tweens */
  interface AnimationConfig { key: string; frames: any[]; frameRate?: number; duration?: number; repeat?: number; repeatDelay?: number; yoyo?: boolean; delay?: number; showOnStart?: boolean; hideOnComplete?: boolean; }
  class AnimationManager { create(config: AnimationConfig): Animation; exists(key: string): boolean; get(key: string): Animation; remove(key: string): this; generateFrameNumbers(key: string, config?: { start?: number; end?: number; first?: number; frames?: number[] }): any[]; generateFrameNames(key: string, config?: { prefix?: string; suffix?: string; start?: number; end?: number; zeroPad?: number; frames?: (string | number)[] }): any[]; }
  class Animation { key: string; frames: any[]; frameRate: number; repeat: number; }
  class AnimationState { currentAnim: Animation | null; isPlaying: boolean; isPaused: boolean; timeScale: number; play(key: string, ignoreIfPlaying?: boolean): this; stop(): this; pause(): this; resume(): this; chain(key?: string | string[]): this; setFrame(i: number): this; }
  interface TweenConfig {
    targets: any; duration?: number; delay?: number | ((target: any, key: string, value: number, index: number, total: number) => number); ease?: string | EaseFunction;
    yoyo?: boolean; repeat?: number; repeatDelay?: number; hold?: number; loop?: number; paused?: boolean; persist?: boolean; timeScale?: number; completeDelay?: number;
    onStart?: (tween: Tween) => void; onUpdate?: (tween: Tween, target?: any) => void; onComplete?: (tween: Tween) => void; onYoyo?: (tween: Tween) => void; onRepeat?: (tween: Tween) => void; onStop?: (tween: Tween) => void;
    [property: string]: any;
  }
  class Tween extends EventEmitter { readonly finished: Promise<void>; readonly isPlaying: boolean; readonly isFinished: boolean; progress: number; timeScale: number; play(): this; pause(): this; resume(): this; stop(): this; restart(): this; seek(t: number): this; setTimeScale(s: number): this; getValue(): number; }
  class TweenChain extends Tween {}
  class TweenManager {
    timeScale: number; readonly length: number;
    add(config: TweenConfig): Tween; create(config: TweenConfig): Tween; chain(config: { targets?: any; tweens: TweenConfig[]; loop?: number; onComplete?: () => void }): TweenChain; timeline(config: any): TweenChain;
    addCounter(config: { from?: number; to?: number; duration?: number; ease?: string; onUpdate?: (t: Tween) => void; onComplete?: (t: Tween) => void; [k: string]: any }): Tween;
    stagger(value: number | [number, number], options?: { start?: number; from?: 'first' | 'last' | 'center' | number; grid?: [number, number]; ease?: string }): (target: any, key: string, value: number, index: number, total: number) => number;
    killTweensOf(target: any): this; killAll(): this; getTweensOf(target: any): Tween[]; isTweening(target: any): boolean; pauseAll(): this; resumeAll(): this; setGlobalTimeScale(s: number): this;
  }
  class Clock { now: number; timeScale: number; paused: boolean; delayedCall(ms: number, fn: (...a: any[]) => void, args?: any[], scope?: any): TimerEvent; addEvent(config: { delay: number; callback: (...a: any[]) => void; repeat?: number; loop?: boolean; args?: any[]; callbackScope?: any; startAt?: number; paused?: boolean }): TimerEvent; loop(ms: number, fn: () => void): TimerEvent; removeEvent(e: TimerEvent): this; removeAllEvents(): this; wait(ms: number): Promise<void>; }
  class TimerEvent { paused: boolean; remove(dispatch?: boolean): void; getProgress(): number; getRemaining(): number; }

  /* ------------------------------------------------------------ entrada */
  class Pointer { id: number; pointerId: number; x: number; y: number; readonly worldX: number; readonly worldY: number; isDown: boolean; button: number; buttons: number; type: string; downX: number; downY: number; readonly distance: number; readonly leftButtonDown: boolean; readonly rightButtonDown: boolean; readonly middleButtonDown: boolean; }
  class Key { readonly isDown: boolean; readonly isUp: boolean; readonly justDown: boolean; readonly justUp: boolean; enabled: boolean; }
  interface CursorKeys { up: Key; down: Key; left: Key; right: Key; space: Key; shift: Key; }
  class InputPlugin extends EventEmitter {
    readonly keyboard: { addKey(name: string | number): Key; addKeys(spec: string | Record<string, string | number>): Record<string, Key>; createCursorKeys(): CursorKeys; isDown(name: string): boolean; justPressed(name: string): boolean; on(event: string, fn: (e: KeyboardEvent) => void): any; off(event: string, fn?: any): any; enabled: boolean };
    readonly gamepad: GamepadManager; readonly activePointer: Pointer; readonly mousePointer: Pointer; readonly pointers: Pointer[]; readonly x: number; readonly y: number; readonly worldX: number; readonly worldY: number;
    setDraggable(obj: DisplayObject, v?: boolean): this; setTopOnly(v: boolean): this; setPollAlways(): this; setDefaultCursor(c: string): this; hitTestPointer(p: Pointer): DisplayObject[]; vibrate(pattern: number | number[]): boolean;
    on(event: 'pointerdown' | 'pointerup' | 'pointermove' | 'pointertap' | 'wheel' | string, fn: (pointer: Pointer, objects: DisplayObject[]) => void, ctx?: any): this;
  }
  class InputManager { enabled: boolean; disableContextMenu: boolean; readonly mousePointer: Pointer; readonly activePointer: Pointer; readonly pointers: Pointer[]; releaseAll(): void; }
  class GamepadManager { readonly connected: boolean; isDown(button: number | string, pad?: number): boolean; justDown(button: number | string, pad?: number): boolean; axis(index: number, pad?: number): number; }
  class VirtualJoystick extends Container { forceX: number; forceY: number; force: number; angle: number; isActive: boolean; readonly up: boolean; readonly down: boolean; readonly left: boolean; readonly right: boolean; }
  class VirtualButton extends Container { isDown: boolean; readonly justDown: boolean; readonly justUp: boolean; }
  class InputLog { constructor(game: Game); start(): this; stop(): any[]; }

  /* ------------------------------------------------------------ física */
  class Body {
    readonly gameObject: any; position: Vec2; velocity: Vec2; acceleration: Vec2; drag: Vec2; bounce: Vec2; maxVelocity: Vec2; gravity: Vec2; friction: Vec2; mass: number; maxSpeed: number;
    width: number; height: number; isCircle: boolean; radius: number; immovable: boolean; pushable: boolean; moves: boolean; enable: boolean; allowGravity: boolean; allowDrag: boolean; allowRotation: boolean; useDamping: boolean;
    collideWorldBounds: boolean; onWorldBounds: boolean; angularVelocity: number; checkCollision: { up: boolean; down: boolean; left: boolean; right: boolean; none: boolean };
    readonly blocked: { up: boolean; down: boolean; left: boolean; right: boolean; none: boolean }; readonly touching: { up: boolean; down: boolean; left: boolean; right: boolean; none: boolean };
    readonly x: number; readonly y: number; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; readonly centerX: number; readonly centerY: number; readonly speed: number; readonly angle: number;
    setVelocity(x: number, y?: number): this; setVelocityX(x: number): this; setVelocityY(y: number): this; setAcceleration(x: number, y?: number): this; setAccelerationX(x: number): this; setAccelerationY(y: number): this;
    setDrag(x: number, y?: number): this; setDamping(v?: boolean): this; setBounce(x: number, y?: number): this; setFriction(x: number, y?: number): this; setMass(m: number): this; setMaxVelocity(x: number, y?: number): this; setMaxSpeed(s: number): this;
    setGravity(x: number, y?: number): this; setGravityY(y: number): this; setAllowGravity(v?: boolean): this; setAllowRotation(v?: boolean): this; setAngularVelocity(v: number): this; setImmovable(v?: boolean): this; setPushable(v?: boolean): this;
    setCollideWorldBounds(v?: boolean): this; setCircle(radius: number, offsetX?: number, offsetY?: number): this; setSize(w: number, h?: number, center?: boolean): this; setOffset(x: number, y?: number): this; setEnable(v?: boolean): this;
    reset(x?: number, y?: number): this; stop(): this; refreshBody(): this; onFloor(): boolean; onWall(): boolean; onCeiling(): boolean; hitTest(x: number, y: number): boolean; destroy(): void;
  }
  class Collider { active: boolean; destroy(): void; }
  class ArcadeWorld extends EventEmitter {
    gravity: Vec2; bounds: Rectangle; isPaused: boolean; timeScale: number; fixedStep: boolean; drawDebug: boolean;
    setBounds(x: number, y: number, w: number, h: number, left?: boolean, right?: boolean, up?: boolean, down?: boolean): this; setBoundsCollision(left?: boolean, right?: boolean, up?: boolean, down?: boolean): this;
    setGravity(x: number, y: number): this; setFPS(fps: number): this; pause(): this; resume(): this; enable(obj: any, isStatic?: boolean): void; disable(obj: any): void;
    collider(a: any, b: any, collideCb?: (a: any, b: any) => void, processCb?: (a: any, b: any) => boolean, ctx?: any): Collider; overlapCollider(a: any, b: any, cb?: (a: any, b: any) => void, processCb?: (a: any, b: any) => boolean, ctx?: any): Collider; removeCollider(c: Collider): this;
    collide(a: any, b: any, cb?: (a: any, b: any) => void, processCb?: (a: any, b: any) => boolean, ctx?: any): boolean; overlap(a: any, b?: any, cb?: (a: any, b: any) => void, processCb?: (a: any, b: any) => boolean, ctx?: any): boolean;
    raycastTiles(layer: TilemapLayer, x0: number, y0: number, x1: number, y1: number): { x: number; y: number; tileX: number; tileY: number; distance: number } | null;
    overlapRect(x: number, y: number, w: number, h: number, includeDynamic?: boolean, includeStatic?: boolean): Body[]; overlapCirc(x: number, y: number, r: number, includeDynamic?: boolean, includeStatic?: boolean): Body[];
    wrap(target: any, padding?: number): this; closest(source: any, targets?: any[]): any; furthest(source: any, targets?: any[]): any;
    moveTo(obj: any, x: number, y: number, speed?: number, maxTime?: number): number; moveToObject(obj: any, target: any, speed?: number, maxTime?: number): number; accelerateTo(obj: any, x: number, y: number, speed?: number): number; accelerateToObject(obj: any, target: any, speed?: number): number;
    velocityFromAngle(angleDeg: number, speed?: number, out?: Vec2): Vec2; velocityFromRotation(rad: number, speed?: number, out?: Vec2): Vec2; step(dt: number): void; update(time: number, delta: number): void;
  }
  class ArcadePhysics {
    readonly world: ArcadeWorld;
    readonly add: { sprite(x: number, y: number, key?: string, frame?: string | number): Sprite & { body: Body }; image(x: number, y: number, key?: string, frame?: string | number): Sprite & { body: Body }; existing<T>(obj: T, isStatic?: boolean): T; group(config?: GroupConfig): PhysicsGroup; staticGroup(config?: GroupConfig): PhysicsGroup; collider: ArcadeWorld['collider']; overlap: ArcadeWorld['overlapCollider']; };
    collide: ArcadeWorld['collide']; overlap: ArcadeWorld['overlap']; raycast(layer: TilemapLayer, x0: number, y0: number, x1: number, y1: number): ReturnType<ArcadeWorld['raycastTiles']>;
    pause(): this; resume(): this; closest: ArcadeWorld['closest']; furthest: ArcadeWorld['furthest']; moveTo: ArcadeWorld['moveTo']; moveToObject: ArcadeWorld['moveToObject']; accelerateTo: ArcadeWorld['accelerateTo']; accelerateToObject: ArcadeWorld['accelerateToObject']; velocityFromAngle: ArcadeWorld['velocityFromAngle']; velocityFromRotation: ArcadeWorld['velocityFromRotation']; overlapRect: ArcadeWorld['overlapRect']; overlapCirc: ArcadeWorld['overlapCirc'];
  }

  /* ------------------------------------------------------------ Tiled */
  class Tile { readonly index: number; readonly x: number; readonly y: number; readonly properties: Record<string, any>; readonly collides: boolean | number; readonly flipX: boolean; readonly flipY: boolean; readonly pixelX: number; readonly pixelY: number; }
  class TilemapLayer extends Container {
    readonly tilemap: Tilemap; readonly tileWidth: number; readonly tileHeight: number; readonly widthInPixels: number; readonly heightInPixels: number; tilesDrawn: number;
    getTileAt(tx: number, ty: number, nonNull?: boolean): Tile | null; getTileAtWorldXY(x: number, y: number, nonNull?: boolean): Tile | null; hasTileAt(tx: number, ty: number): boolean; gidAt(tx: number, ty: number): number;
    putTileAt(gid: number | Tile, tx: number, ty: number): Tile | null; putTileAtWorldXY(gid: number, x: number, y: number): Tile | null; removeTileAt(tx: number, ty: number): Tile | null; removeTileAtWorldXY(x: number, y: number): Tile | null;
    fill(gid: number, x?: number, y?: number, w?: number, h?: number): this; replaceByIndex(find: number, replace: number): this; forEachTile(cb: (t: Tile) => void, x?: number, y?: number, w?: number, h?: number, onlyNonEmpty?: boolean): this;
    filterTiles(cb: (t: Tile) => boolean, x?: number, y?: number, w?: number, h?: number): Tile[]; findTile(cb: (t: Tile) => boolean): Tile | null; getTilesWithin(x: number, y: number, w: number, h: number, filter?: any): Tile[]; getTilesWithinWorldXY(x: number, y: number, w: number, h: number, filter?: any): Tile[];
    worldToTileXY(x: number, y: number, snap?: boolean, out?: Vec2): Vec2; worldToTileX(x: number, snap?: boolean): number; worldToTileY(y: number, snap?: boolean): number; tileToWorldXY(tx: number, ty: number, out?: Vec2): Vec2;
    setCollision(indexes: number | number[], collides?: boolean): this; setCollisionBetween(start: number, stop: number, collides?: boolean): this; setCollisionByExclusion(indexes: number[], collides?: boolean): this;
    setCollisionByProperty(props: Record<string, any>, collides?: boolean): this; setCollisionFromCollisionGroup(collides?: boolean): this; setOneWayCollision(v?: boolean): this; collidesAt(tx: number, ty: number): number; setCullPadding(x: number, y?: number): this;
  }
  class Tilemap extends EventEmitter {
    constructor(scene: Scene, keyOrData: string | object);
    readonly width: number; readonly height: number; readonly tileWidth: number; readonly tileHeight: number; readonly orientation: 'orthogonal' | 'isometric' | 'staggered' | 'hexagonal'; readonly properties: Record<string, any>;
    readonly widthInPixels: number; readonly heightInPixels: number; readonly layers: TilemapLayer[]; readonly backgroundColor: number | null;
    createLayer(nameOrIndex: string | number, parentOrX?: Container | number, x?: number, y?: number): TilemapLayer; createAllLayers(parent?: Container): DisplayObject[];
    getLayer(name: string): TilemapLayer | null; getLayerData(nameOrIndex: string | number): any; getObjectLayer(name: string): any; getObjects(layerName: string): any[];
    createFromObjects(layerName: string, config?: { name?: string; type?: string; gid?: number; id?: number; filter?: (o: any) => boolean; key?: string; frame?: string | number; classType?: any; container?: Container }): Sprite[];
    findObject(layerName: string, fn: (o: any) => boolean): any; filterObjects(layerName: string, fn: (o: any) => boolean): any[]; addTilesetImage(name: string, key?: string): any; getTileset(name: string): any; getTileProperties(gid: number): any;
    tileToWorldXY(tx: number, ty: number, out?: Vec2, layer?: TilemapLayer): Vec2; worldToTileXY(x: number, y: number, snap?: boolean, out?: Vec2, layer?: TilemapLayer): Vec2; destroy(): void;
  }
  const TiledParser: { normalize(data: any, options?: any): any; parseTMX(xml: string): any; props(list: any[]): Record<string, any>; GID_MASK: number; FLIP_H: number; FLIP_V: number; FLIP_D: number };
  const Inflate: { zlib(bytes: Uint8Array, maxOutput?: number): Uint8Array; gzip(bytes: Uint8Array, maxOutput?: number): Uint8Array; raw(bytes: Uint8Array, maxOutput?: number): Uint8Array };
  function Earcut(data: number[], holeIndices?: number[] | null, dim?: number): number[];

  /* ------------------------------------------------------------ cámaras */
  class Camera extends EventEmitter {
    x: number; y: number; width: number; height: number; scrollX: number; scrollY: number; zoomX: number; zoomY: number; zoom: number; rotation: number; alpha: number; visible: boolean; name: string;
    originX: number; originY: number; roundPixels: boolean; lerpX: number; lerpY: number; bounds: Rectangle | null; readonly worldView: Rectangle; filters: Filter[] | null; backgroundColor: number | null;
    setViewport(x: number, y: number, w?: number, h?: number): this; setSize(w: number, h?: number): this; setPosition(x: number, y?: number): this; setScroll(x: number, y?: number): this; centerOn(x: number, y: number): this;
    setZoom(x: number, y?: number): this; setRotation(r: number): this; setAngle(d: number): this; setOrigin(x: number, y?: number): this; setBounds(x: number, y: number, w: number, h: number, centerOn?: boolean): this; removeBounds(): this;
    setBackgroundColor(c: ColorInput, alpha?: number): this; setRoundPixels(v?: boolean): this; setAlpha(a: number): this; setVisible(v: boolean): this; setName(n: string): this;
    setFilters(f: Filter | Filter[] | null): this; addFilter(f: Filter): this; removeFilter(f: Filter): this; ignore(obj: DisplayObject | DisplayObject[] | Group): this;
    startFollow(target: { x: number; y: number }, roundPixels?: boolean, lerpX?: number, lerpY?: number, offsetX?: number, offsetY?: number): this; stopFollow(): this; setLerp(x: number, y?: number): this; setFollowOffset(x: number, y?: number): this; setDeadzone(w?: number, h?: number): this;
    shake(duration?: number, intensity?: number, force?: boolean, cb?: () => void): this; flash(duration?: number, color?: ColorInput, alpha?: number, force?: boolean, cb?: () => void): this;
    fadeOut(duration?: number, color?: ColorInput, force?: boolean, cb?: () => void): this; fadeIn(duration?: number, color?: ColorInput, force?: boolean, cb?: () => void): this; fadeOutAsync(ms?: number, color?: ColorInput): Promise<Camera>; fadeInAsync(ms?: number, color?: ColorInput): Promise<Camera>;
    pan(x: number, y: number, duration?: number, ease?: string, force?: boolean, cb?: () => void): this; zoomTo(zoom: number, duration?: number, ease?: string, force?: boolean, cb?: () => void): this; rotateTo(angle: number, shortest?: boolean, duration?: number, ease?: string, force?: boolean, cb?: () => void): this;
    resetFX(): this; getWorldPoint(x: number, y: number, out?: Vec2): Vec2; worldToScreen(x: number, y: number, out?: Vec2): Vec2; containsPoint(x: number, y: number): boolean; isInView(objOrRect: DisplayObject | Rectangle): boolean; readonly isShaking: boolean; readonly isFading: boolean;
  }
  class CameraManager { readonly main: Camera; readonly list: Camera[]; add(x?: number, y?: number, width?: number, height?: number, makeMain?: boolean, name?: string): Camera; remove(cam: Camera): this; getCamera(name: string): Camera | null; }

  /* ------------------------------------------------------------ partículas */
  type Range = number | { min: number; max: number } | [number, number];
  type StartEnd = number | { start: number; end: number; ease?: string } | { min: number; max: number };
  interface ParticleConfig {
    x?: Range; y?: Range; speed?: Range; speedX?: Range; speedY?: Range; angle?: Range; lifespan?: Range; frequency?: number; quantity?: Range; maxParticles?: number;
    gravityX?: number; gravityY?: number; accelerationX?: number; accelerationY?: number; drag?: number; scale?: StartEnd; alpha?: StartEnd; rotate?: StartEnd; rotationSpeed?: Range;
    color?: ColorInput[]; tint?: ColorInput | ColorInput[] | { start: ColorInput; end: ColorInput }; colorEase?: string; blendMode?: BlendMode; emitting?: boolean; duration?: number; stopAfter?: number;
    emitZone?: { source: Rectangle | Circle | Ellipse | any; type?: 'random' | 'edge'; quantity?: number }; deathZone?: any; bounds?: Rectangle; bounce?: number; angleAlign?: boolean; stretch?: number;
    follow?: { x: number; y: number }; followOffset?: { x: number; y: number }; onEmit?: (emitter: ParticleEmitter, index: number) => void; onDeath?: (emitter: ParticleEmitter, index: number) => void;
  }
  class ParticleEmitter extends Container {
    config: ParticleConfig; emitting: boolean; frequency: number; readonly alive: number; readonly usingWasm: boolean; maxParticles: number;
    setConfig(c: ParticleConfig): this; start(): this; stop(kill?: boolean): this; pause(): this; resume(): this; explode(count?: number, x?: number, y?: number): this; emitParticle(count?: number, x?: number, y?: number): this; emitParticleAt(x: number, y: number, count?: number): this;
    setFrequency(ms: number, quantity?: Range): this; setEmitterPosition(x: number, y: number): this; startFollow(target: { x: number; y: number }, offsetX?: number, offsetY?: number): this; stopFollow(): this;
    setParticleTint(c: ColorInput | ColorInput[]): this; setColorRamp(list: ColorInput[]): this; setMaxParticles(n: number): this; killAll(): this; getAliveParticleCount(): number; useWasm(v?: boolean): this;
  }
  class Particle { constructor(texture: Texture, x?: number, y?: number); x: number; y: number; scaleX: number; scaleY: number; rotation: number; alpha: number; tint: number; texture: Texture; [k: string]: any; }
  class ParticleContainer extends Container { readonly particles: Particle[]; addParticle(p: Particle): Particle; addParticles(list: Particle[]): this; removeParticle(p: Particle): this; removeParticles(): this; }

  /* ------------------------------------------------------------ efectos */
  class Filter { enabled: boolean; padding: number; uniforms: Float32Array; static key: string; static glsl: string; static wgsl: string; setEnabled(v?: boolean): this; destroy(): void; }
  class ColorMatrixFilter extends Filter { constructor(options?: { matrix?: number[] }); alpha: number; matrix: number[]; reset(): this; setMatrix(m: number[]): this; brightness(b: number, multiply?: boolean): this; contrast(a: number, multiply?: boolean): this; saturate(a: number, multiply?: boolean): this; desaturate(): this; grayscale(s?: number, multiply?: boolean): this; hue(deg: number, multiply?: boolean): this; negative(multiply?: boolean): this; sepia(multiply?: boolean): this; technicolor(multiply?: boolean): this; polaroid(multiply?: boolean): this; kodachrome(multiply?: boolean): this; browni(multiply?: boolean): this; vintage(multiply?: boolean): this; night(intensity?: number, multiply?: boolean): this; predator(amount?: number, multiply?: boolean): this; lsd(multiply?: boolean): this; tint(color: ColorInput, multiply?: boolean): this; }
  class GrayscaleFilter extends ColorMatrixFilter { constructor(amount?: number); }
  class SepiaFilter extends ColorMatrixFilter {}
  class InvertFilter extends ColorMatrixFilter {}
  class HueRotateFilter extends ColorMatrixFilter { constructor(deg?: number); setHue(deg: number): this; }
  class AlphaFilter extends Filter { constructor(alpha?: number); alpha: number; }
  class BlurFilter extends Filter { constructor(options?: { strength?: number; strengthX?: number; strengthY?: number; quality?: number }); strength: number; strengthX: number; strengthY: number; quality: number; }
  class TiltShiftFilter extends Filter { constructor(options?: { blur?: number; focus?: number; focusSize?: number; gradient?: number }); blur: number; focus: number; focusSize: number; gradient: number; }
  class GlowFilter extends Filter { constructor(options?: { distance?: number; outerStrength?: number; innerStrength?: number; color?: ColorInput; alpha?: number }); distance: number; outerStrength: number; innerStrength: number; color: number; alpha: number; }
  class BloomFilter extends Filter { constructor(options?: { threshold?: number; knee?: number; bloomScale?: number; intensity?: number; brightness?: number; blur?: number; quality?: number; color?: ColorInput }); threshold: number; knee: number; bloomScale: number; brightness: number; blur: number; quality: number; }
  class DropShadowFilter extends Filter { constructor(options?: { color?: ColorInput; alpha?: number; blur?: number; quality?: number; offset?: { x: number; y: number }; distance?: number; angle?: number; shadowOnly?: boolean }); color: number; alpha: number; blur: number; }
  class OutlineFilter extends Filter { constructor(options?: { thickness?: number; color?: ColorInput; alpha?: number; knockout?: boolean }); thickness: number; }
  class PixelateFilter extends Filter { constructor(size?: number); size: number | { x: number; y: number }; sizeX: number; sizeY: number; }
  class CRTFilter extends Filter { constructor(options?: { curvature?: number; lineWidth?: number; lineContrast?: number; noise?: number; vignetting?: number; vignettingAlpha?: number; vignettingBlur?: number; flicker?: number; chromatic?: number }); curvature: number; lineWidth: number; lineContrast: number; noise: number; vignetting: number; vignettingAlpha: number; vignettingBlur: number; flicker: number; chromatic: number; }
  class VignetteFilter extends Filter { constructor(options?: { radius?: number; softness?: number; strength?: number; color?: ColorInput }); radius: number; softness: number; strength: number; color: number; }
  class ChromaticAberrationFilter extends Filter { constructor(options?: { offset?: number; redX?: number; redY?: number; greenX?: number; greenY?: number; blueX?: number; blueY?: number; radial?: boolean }); redX: number; redY: number; greenX: number; greenY: number; blueX: number; blueY: number; radial: number; }
  const RGBSplitFilter: typeof ChromaticAberrationFilter;
  class ShockwaveFilter extends Filter { constructor(options?: { x?: number; y?: number; amplitude?: number; wavelength?: number; speed?: number; brightness?: number; radius?: number; time?: number; autoPlay?: boolean; loop?: boolean }); centerX: number; centerY: number; amplitude: number; wavelength: number; speed: number; brightness: number; radius: number; time: number; autoPlay: boolean; loop: boolean; play(x?: number, y?: number): this; }
  class WaveFilter extends Filter { constructor(options?: { amplitudeX?: number; amplitudeY?: number; frequencyX?: number; frequencyY?: number; speed?: number }); amplitudeX: number; amplitudeY: number; frequencyX: number; frequencyY: number; speed: number; }
  class HeatHazeFilter extends Filter { constructor(options?: { strength?: number; scale?: number; speed?: number }); strength: number; scale: number; speed: number; }
  class GlitchFilter extends Filter { constructor(options?: { slices?: number; offset?: number; density?: number; speed?: number; rgbSplit?: number; seed?: number }); slices: number; offset: number; density: number; speed: number; rgbSplit: number; seed: number; }
  class NoiseFilter extends Filter { constructor(options?: number | { noise?: number; seed?: number; animated?: boolean }); noise: number; seed: number; animated: number; }
  class OldFilmFilter extends Filter { constructor(options?: { sepia?: number; noise?: number; scratch?: number; vignetting?: number; flicker?: number }); sepia: number; noise: number; scratch: number; vignetting: number; flicker: number; }
  class BulgePinchFilter extends Filter { constructor(options?: { x?: number; y?: number; radius?: number; strength?: number }); centerX: number; centerY: number; radius: number; strength: number; }
  class TwistFilter extends Filter { constructor(options?: { x?: number; y?: number; radius?: number; angle?: number }); centerX: number; centerY: number; radius: number; angle: number; }
  class ZoomBlurFilter extends Filter { constructor(options?: { x?: number; y?: number; strength?: number; innerRadius?: number }); centerX: number; centerY: number; strength: number; innerRadius: number; }
  class MotionBlurFilter extends Filter { constructor(options?: { x?: number; y?: number; velocityX?: number; velocityY?: number }); velocityX: number; velocityY: number; }
  class GodRaysFilter extends Filter { constructor(options?: { x?: number; y?: number; exposure?: number; decay?: number; density?: number; weight?: number; threshold?: number; color?: ColorInput }); lightX: number; lightY: number; exposure: number; decay: number; density: number; weight: number; threshold: number; color: number; }
  class PosterizeFilter extends Filter { constructor(levels?: number); levels: number; }
  class DitherFilter extends Filter { constructor(options?: { levels?: number; scale?: number }); levels: number; scale: number; }
  class ThresholdFilter extends Filter { constructor(threshold?: number); threshold: number; }
  class ConvolutionFilter extends Filter { constructor(matrix?: number[], options?: { strength?: number }); strength: number; setMatrix(m: number[]): this; static emboss(strength?: number): ConvolutionFilter; static sharpen(amount?: number): ConvolutionFilter; static edgeDetect(): ConvolutionFilter; }
  class DotScreenFilter extends Filter { constructor(options?: { scale?: number; angle?: number; grayscale?: number }); scale: number; angle: number; grayscale: number; }
  class ReflectionFilter extends Filter { constructor(options?: { boundary?: number; amplitude?: number; wavelength?: number; alphaStart?: number; alphaEnd?: number; speed?: number; mirror?: number }); boundary: number; amplitude: number; wavelength: number; alphaStart: number; alphaEnd: number; speed: number; mirror: number; }
  class ColorOverlayFilter extends Filter { constructor(color?: ColorInput, alpha?: number); color: number; alpha: number; }
  class GradientMapFilter extends Filter { constructor(colors?: ColorInput[], amount?: number); amount: number; setColors(colors: ColorInput[]): this; }
  const Filters: Record<string, typeof Filter>;

  /* ------------------------------------------------------------ audio */
  interface PlayConfig { volume?: number; rate?: number; detune?: number; loop?: boolean; delay?: number; seek?: number; pan?: number; bus?: 'music' | 'sfx' | string; keep?: boolean; force?: boolean; }
  interface MusicDef { bpm?: number; stepsPerBeat?: number; steps?: number; loops?: number; seed?: string; sampleRate?: number; tracks: { notes: string; wave?: 'square' | 'saw' | 'triangle' | 'sine' | 'noise' | 'drums'; drums?: boolean; volume?: number; pan?: number; [k: string]: any }[]; }
  class SoundInstance extends EventEmitter { readonly key: string; readonly isPlaying: boolean; readonly isPaused: boolean; loop: boolean; volume: number; rate: number; play(): this; pause(): this; resume(): this; stop(): this; fadeTo(volume: number, ms: number, stopAtEnd?: boolean): this; destroy(): void; }
  class Sound extends EventEmitter { play(config?: PlayConfig): SoundInstance; pause(): this; resume(): this; stop(): this; readonly isPlaying: boolean; readonly isPaused: boolean; }
  class SoundManager extends EventEmitter {
    readonly context: AudioContext | null; locked: boolean; mute: boolean; volume: number; maxInstancesPerKey: number; readonly playingCount: number; music: SoundInstance | null;
    play(key: string, config?: PlayConfig): SoundInstance | null; playSfx(spec: string | object, config?: PlayConfig): SoundInstance | null; add(key: string, config?: PlayConfig): Sound; exists(key: string): boolean; remove(key: string): this;
    addMusic(key: string, def: MusicDef): string; playMusic(key: string, config?: PlayConfig & { fadeIn?: number; crossFade?: number; waitForUnlock?: boolean }): SoundInstance | null; stopMusic(fadeMs?: number): this;
    addSamples(key: string, samples: Float32Array | Float32Array[], sampleRate?: number): any; makeSfx(spec: string | object, key?: string): string; setVolume(v: number): this; setBusVolume(bus: string, v: number): this; setMute(v: boolean): this; toggleMute(): boolean;
    pauseAll(): this; resumeAll(): this; stopAll(): this; stopByKey(key: string): this; unlock(): void;
  }
  const Sfx: { presets?: string[]; defaults(): any; preset(name: 'coin' | 'pickup' | 'laser' | 'shoot' | 'explosion' | 'powerup' | 'hit' | 'hurt' | 'jump' | 'bounce' | 'blip' | 'select' | 'click' | string, seed?: number): any; generate(params: any, seed?: number): Float32Array };
  const Music: { render(def: MusicDef): { samples?: Float32Array; channels?: Float32Array[]; sampleRate: number } };

  /* ------------------------------------------------------------ interfaz */
  interface ButtonOptions { text?: string; width?: number; height?: number; padding?: number; radius?: number; color?: ColorInput; hoverColor?: ColorInput | null; pressColor?: ColorInput | null; disabledColor?: ColorInput; textStyle?: TextStyle; shadow?: boolean; strokeWidth?: number; strokeColor?: ColorInput; strokeAlpha?: number; onClick?: (btn: Button) => void; }
  class Button extends Container { constructor(scene: Scene, x: number, y: number, options?: ButtonOptions); enabled: boolean; readonly label: Text; setText(t: string): this; setEnabled(v?: boolean): this; onClick(fn: (btn: Button) => void): this; }
  class Panel extends Container {}
  class ProgressBar extends Container { value: number; setValue(v: number): this; }
  class StatsPanel {}

  /* ------------------------------------------------------------ internos expuestos (uso avanzado) */
  class BaseRenderer extends EventEmitter { readonly type: RendererType; width: number; height: number; resolution: number; readonly stats: { drawCalls: number; quads: number; culled: number; filters: number; targets: number; frame: number; textures: number }; readonly extract: { pixels(target: DisplayObject | RenderTexture): Promise<{ width: number; height: number; data: Uint8Array }>; canvas(target: DisplayObject | RenderTexture): Promise<HTMLCanvasElement>; base64(target: DisplayObject | RenderTexture, type?: string, quality?: number): Promise<string> }; resize(width: number, height: number, resolution?: number): void; render(obj: DisplayObject, options?: { target?: RenderTexture; clear?: boolean; transform?: Matrix }): void; destroy(): void; }
  class GPURenderer extends BaseRenderer {}
  class WebGLRenderer extends GPURenderer { readonly gl: WebGLRenderingContext | WebGL2RenderingContext; }
  class WebGPURenderer extends GPURenderer { readonly device: any; /* GPUDevice (con @webgpu/types) */ }
  class CanvasRenderer extends BaseRenderer { readonly ctx: CanvasRenderingContext2D; }
  class Batcher {}
  class RenderTargetPool {}
  class SpatialHash { constructor(cellSize?: number); }
  class Pool<T = any> { constructor(factory: () => T, reset?: (o: T) => void); get(): T; release(o: T): void; }
  class PointProxy { x: number; y: number; set(x: number, y?: number): this; }
  class DataManager { get(key: string): any; set(key: string, value: any): this; has(key: string): boolean; remove(key: string): this; }
  class CacheManager { readonly json: any; readonly text: any; readonly tilemap: any; readonly audio: any; }
  class TilesetRuntime { readonly firstgid: number; readonly name: string; getTileProperties(localId: number): any; }
  class Systems {}
  const Image: typeof Sprite;
  const Particles: typeof ParticleEmitter;

  /* ------------------------------------------------------------ herramientas */
  class GifEncoder { constructor(width: number, height: number, options?: { delay?: number; repeat?: number; dither?: boolean }); readonly frames: number; addFrame(rgba: Uint8Array | Uint8ClampedArray, delayMs?: number): this; finish(): Uint8Array; }
  class Recorder { constructor(game: Game); readonly recording: boolean; readonly frames: number; lastGif: Uint8Array | null; start(options?: { fps?: number; scale?: number; maxFrames?: number }): this; capture(): this; stop(): Blob | Uint8Array | null; }
  const Utils: { base64ToBytes(b64: string): Uint8Array; [k: string]: any };
  const Log: { info(...a: any[]): void; warn(...a: any[]): void; warnOnce(key: string, ...a: any[]): void; error(...a: any[]): void; level: number };

  /* ============================================================ 3D */
  /* ------------------------------------------------------------ matemáticas 3D */
  class Vec3 {
    constructor(x?: number, y?: number, z?: number); x: number; y: number; z: number;
    static readonly UP: Vec3;
    set(x: number, y: number, z: number): this; copy(v: { x: number; y: number; z: number }): this; clone(): Vec3; add(v: Vec3): this; addScaled(v: Vec3, s: number): this; sub(v: Vec3): this;
    subVectors(a: Vec3, b: Vec3): this; addVectors(a: Vec3, b: Vec3): this; scale(s: number): this; multiply(v: Vec3): this; negate(): this; dot(v: Vec3): number; cross(v: Vec3): this; crossVectors(a: Vec3, b: Vec3): this;
    lengthSq(): number; length(): number; normalize(): this; setLength(len: number): this; distanceTo(v: Vec3): number; distanceToSq(v: Vec3): number; lerp(v: Vec3, t: number): this; min(v: Vec3): this; max(v: Vec3): this;
    equals(v: Vec3, eps?: number): boolean; applyMat4(m: Mat4): this; transformDirection(m: Mat4): this; applyQuat(q: Quat): this; setFromMatrixPosition(m: Mat4): this; setFromMatrixColumn(m: Mat4, i: number): this;
    fromArray(a: ArrayLike<number>, offset?: number): this; toArray(a?: number[], offset?: number): number[]; angleTo(v: Vec3): number; projectOnPlane(n: Vec3): this; reflect(n: Vec3): this;
  }
  class Vec4 { constructor(x?: number, y?: number, z?: number, w?: number); x: number; y: number; z: number; w: number; set(x: number, y: number, z: number, w: number): this; copy(v: Vec4): this; clone(): Vec4; }
  class Quat {
    constructor(x?: number, y?: number, z?: number, w?: number); x: number; y: number; z: number; w: number;
    set(x: number, y: number, z: number, w: number): this; identity(): this; copy(q: Quat): this; clone(): Quat; setFromAxisAngle(axis: Vec3, angle: number): this; setFromEuler(x: number, y: number, z: number, order?: string): this;
    setFromRotationMatrix(m: Mat4): this; setFromUnitVectors(a: Vec3, b: Vec3): this; multiply(q: Quat): this; premultiply(q: Quat): this; multiplyQuats(a: Quat, b: Quat): this; invert(): this; dot(q: Quat): number;
    length(): number; normalize(): this; slerp(q: Quat, t: number): this; angleTo(q: Quat): number; rotateTowards(q: Quat, step: number): this; fromArray(a: ArrayLike<number>, o?: number): this; toArray(a?: number[], o?: number): number[];
  }
  class Euler { constructor(x?: number, y?: number, z?: number, order?: string); x: number; y: number; z: number; order: string; set(x: number, y: number, z: number, order?: string): this; copy(e: Euler): this; setFromRotationMatrix(m: Mat4, order?: string): this; }
  class Mat4 {
    constructor(); readonly e: Float32Array;
    identity(): this; copy(m: Mat4): this; clone(): Mat4; fromArray(a: ArrayLike<number>, o?: number): this; multiply(m: Mat4): this; premultiply(m: Mat4): this; multiplyMatrices(a: Mat4, b: Mat4): this;
    compose(p: Vec3, q: Quat, s: Vec3): this; decompose(p: Vec3, q: Quat, s: Vec3): this; determinant(): number; invert(): this; invertFrom(m: Mat4): this; transpose(): this;
    makeTranslation(x: number, y: number, z: number): this; makeScale(x: number, y: number, z: number): this; makeRotationFromQuat(q: Quat): this;
    perspective(fovY: number, aspect: number, near: number, far: number): this; orthographic(l: number, r: number, t: number, b: number, near: number, far: number): this; lookAt(eye: Vec3, target: Vec3, up: Vec3): this; getMaxScale(): number;
  }
  class Box3 { constructor(min?: Vec3, max?: Vec3); min: Vec3; max: Vec3; readonly isEmpty: boolean; makeEmpty(): this; set(min: Vec3, max: Vec3): this; copy(b: Box3): this; clone(): Box3; expandByPoint(p: Vec3): this; expandByXYZ(x: number, y: number, z: number): this; union(b: Box3): this; getCenter(out?: Vec3): Vec3; getSize(out?: Vec3): Vec3; containsPoint(p: Vec3): boolean; intersectsBox(b: Box3): boolean; applyMat4(m: Mat4): this; distanceToPoint(p: Vec3): number; }
  class Sphere { constructor(center?: Vec3, radius?: number); center: Vec3; radius: number; readonly isEmpty: boolean; copy(s: Sphere): this; clone(): Sphere; setFromBox(b: Box3): this; applyMat4(m: Mat4): this; containsPoint(p: Vec3): boolean; intersectsSphere(s: Sphere): boolean; }
  class Plane { constructor(normal?: Vec3, constant?: number); normal: Vec3; constant: number; set(nx: number, ny: number, nz: number, c: number): this; normalize(): this; distanceToPoint(p: Vec3): number; setFromNormalAndPoint(n: Vec3, p: Vec3): this; }
  class Frustum { setFromMatrix(m: Mat4): this; intersectsSphere(s: Sphere): boolean; intersectsSphereXYZ(x: number, y: number, z: number, r: number): boolean; intersectsBox(b: Box3): boolean; containsPoint(v: Vec3): boolean; }
  class Ray { constructor(origin?: Vec3, direction?: Vec3); origin: Vec3; direction: Vec3; set(o: Vec3, d: Vec3): this; copy(r: Ray): this; at(t: number, out?: Vec3): Vec3; applyMat4(m: Mat4): this; intersectBox(b: Box3): number | null; intersectSphere(s: Sphere): number | null; intersectPlane(p: Plane): number | null; intersectTriangle(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, backface?: boolean): number | null; }

  /* ------------------------------------------------------------ escena 3D */
  class Node3D extends EventEmitter {
    constructor(); name: string; type: string; readonly parent: Node3D | null; readonly children: Node3D[]; visible: boolean; castShadow: boolean; receiveShadow: boolean; renderOrder: number; frustumCulled: boolean;
    position: Vec3; quaternion: Quat; rotation: Euler; scale: Vec3; readonly matrix: Mat4; readonly matrixWorld: Mat4; userData: Record<string, any>; readonly destroyed: boolean; animations?: AnimationClip3D[];
    setPosition(x: number, y: number, z: number): this; setRotation(x: number, y: number, z: number): this; setScale(x: number, y?: number, z?: number): this;
    add<T extends Node3D>(child: T): T; remove(child: Node3D): this; removeFromParent(): this; traverse(fn: (n: Node3D) => void): void; traverseVisible(fn: (n: Node3D) => void): void;
    getObjectByName(name: string): Node3D | null; find(pred: (n: Node3D) => boolean): Node3D | null; findAll(pred: (n: Node3D) => boolean): Node3D[];
    updateMatrix(): this; updateMatrixWorld(force?: boolean): this; updateWorldMatrix(): this; getWorldPosition(out?: Vec3): Vec3; getWorldQuaternion(out?: Quat): Quat; getWorldDirection(out?: Vec3): Vec3;
    localToWorld(v: Vec3): Vec3; worldToLocal(v: Vec3): Vec3; translateOnAxis(axis: Vec3, d: number): this; translateX(d: number): this; translateY(d: number): this; translateZ(d: number): this;
    rotateOnAxis(axis: Vec3, a: number): this; rotateOnWorldAxis(axis: Vec3, a: number): this; rotateX(a: number): this; rotateY(a: number): this; rotateZ(a: number): this; lookAt(x: number | Vec3, y?: number, z?: number): this;
    clone(recursive?: boolean): this; destroy(): void;
    /** Solo en instancias de modelos glTF: mezclador de animaciones y atajo para reproducir un clip */
    readonly mixer?: AnimationMixer3D; play?(clip: string, options?: PlayAnimationOptions): AnimationAction3D | null;
  }
  class Group3D extends Node3D {}
  interface SkyOptions { top?: ColorInput; horizon?: ColorInput; bottom?: ColorInput; sunColor?: ColorInput; sunSize?: number; sunIntensity?: number; }
  class Scene3D extends Node3D {
    background: ColorInput; backgroundAlpha: number; sky: SkyOptions | null; fog: { type: 'linear' | 'exp2'; color: number; near: number; far: number; density: number } | null;
    exposure: number; toneMapping: 'aces' | 'none' | string; envIntensity: number; readonly mixers: AnimationMixer3D[];
    setFog(type: 'linear' | 'exp2' | null, color?: ColorInput, nearOrDensity?: number, far?: number): this; setSky(o: SkyOptions | null): this;
  }
  class Geometry3D {
    constructor(); readonly vertexCount: number; index: Uint16Array | Uint32Array | null; keep: boolean; readonly disposed: boolean; attributes: Record<string, { data: Float32Array; size: number; normalized?: boolean; version: number }>;
    setAttribute(name: 'position' | 'normal' | 'uv' | 'color' | 'joints' | 'weights' | 'tangent' | string, data: ArrayLike<number>, size: number, normalized?: boolean): this; getAttribute(name: string): any;
    setIndex(idx: ArrayLike<number>): this; markDirty(name?: string): this; computeBounds(): this; getBoundingSphere(): Sphere; getBoundingBox(): Box3; computeNormals(): this; applyMat4(m: Mat4): this; clone(): Geometry3D; dispose(): void;
    static box(w?: number, h?: number, d?: number, seg?: number): Geometry3D; static plane(w?: number, d?: number, segX?: number, segZ?: number, orient?: 'xz' | 'xy'): Geometry3D;
    static sphere(r?: number, widthSeg?: number, heightSeg?: number): Geometry3D; static cylinder(rTop?: number, rBottom?: number, h?: number, radialSeg?: number, open?: boolean): Geometry3D;
    static cone(r?: number, h?: number, radialSeg?: number): Geometry3D; static capsule(r?: number, len?: number, radialSeg?: number, capSeg?: number): Geometry3D; static torus(R?: number, r?: number, radialSeg?: number, tubularSeg?: number): Geometry3D;
    static heightfield(w: number, d: number, segX: number, segZ: number, heights: ((x: number, z: number) => number) | ArrayLike<number> | null): Geometry3D;
    static extrude(points: [number, number][] | { x: number; z?: number; y?: number }[] | number[], height?: number): Geometry3D;
    static merge(list: (Geometry3D | { geometry: Geometry3D; matrix?: Mat4; color?: ColorInput })[]): Geometry3D;
  }
  interface MaterialOptions {
    type?: 'standard' | 'basic' | 'unlit' | 'toon'; name?: string; color?: ColorInput; opacity?: number; transparent?: boolean; alphaTest?: number; side?: 'front' | 'back' | 'double'; blend?: 'normal' | 'add' | 'multiply' | 'screen';
    map?: Texture | string; normalMap?: Texture | string; metalRoughMap?: Texture | string; emissiveMap?: Texture | string; aoMap?: Texture | string;
    metalness?: number; roughness?: number; emissive?: ColorInput; emissiveIntensity?: number; normalScale?: number; aoStrength?: number; envIntensity?: number;
    uvScale?: number | [number, number]; uvOffset?: number | [number, number]; uvRotation?: number; vertexColors?: boolean; fog?: boolean; flatShading?: boolean; depthWrite?: boolean; depthTest?: boolean;
    toonSteps?: number; rimColor?: ColorInput; rimPower?: number; outline?: number; outlineColor?: ColorInput;
  }
  class Material3D { constructor(o?: MaterialOptions); uid: number; type: string; name: string; color: number; emissive: number; opacity: number; transparent: boolean; metalness: number; roughness: number; map: Texture | null; [k: string]: any; set(o: MaterialOptions): this; clone(): this; dispose(): void; }
  class StandardMaterial extends Material3D {}
  class BasicMaterial extends Material3D {}
  class ToonMaterial extends Material3D {}
  class Mesh3D extends Node3D { constructor(geometry: Geometry3D, material?: Material3D); geometry: Geometry3D; material: Material3D; skeleton: Skeleton3D | null; readonly instanced: boolean; getWorldSphere(out?: Sphere): Sphere; }
  class InstancedMesh3D extends Mesh3D {
    constructor(geometry: Geometry3D, material: Material3D, capacity: number); readonly capacity: number; count: number; instanceMatrix: Float32Array; instanceColor: Float32Array | null; useInstanceColor: boolean; instanceVersion: number;
    setMatrixAt(i: number, m: Mat4): this; getMatrixAt(i: number, out?: Mat4): Mat4; setTransformAt(i: number, pos: Vec3, rotY?: number | Quat, scale?: number | Vec3): this; setColorAt(i: number, c: ColorInput): this;
  }
  class Sprite3D extends Mesh3D { constructor(texture: Texture | string, width?: number, height?: number, options?: { transparent?: boolean; alphaTest?: number; fixedSize?: boolean }); }
  class Skeleton3D { constructor(bones: Node3D[], inverseBind?: Float32Array); readonly bones: Node3D[]; readonly count: number; readonly jointMatrices: Float32Array; version: number; update(meshWorld: Mat4): void; releaseGPU(): void; }
  class Light3D extends Node3D { color: number; intensity: number; }
  class AmbientLight extends Light3D { constructor(color?: ColorInput, intensity?: number); }
  class HemisphereLight extends Light3D { constructor(sky?: ColorInput, ground?: ColorInput, intensity?: number); groundColor: number; }
  class DirectionalLight extends Light3D {
    constructor(color?: ColorInput, intensity?: number); direction: Vec3; shadow: { enabled: boolean; size: number; mapSize: number; bias: number; follow: Node3D | null } | null;
    setDirection(x: number, y: number, z: number): this; enableShadows(opts?: { size?: number; mapSize?: number; bias?: number; follow?: Node3D | null }): this;
  }
  class PointLight extends Light3D { constructor(color?: ColorInput, intensity?: number, range?: number, decay?: number); range: number; decay: number; }
  class SpotLight extends Light3D { constructor(color?: ColorInput, intensity?: number, range?: number, angle?: number, penumbra?: number); range: number; angle: number; penumbra: number; }
  class Camera3D extends Node3D { near: number; far: number; readonly projectionMatrix: Mat4; readonly viewMatrix: Mat4; readonly viewProjection: Mat4; updateProjection(): this; updateView(): this; rayFromNDC(nx: number, ny: number, out?: Ray): Ray; project(v: Vec3, out?: Vec3): Vec3; }
  class PerspectiveCamera extends Camera3D { constructor(fov?: number, aspect?: number, near?: number, far?: number); fov: number; aspect: number; }
  class OrthographicCamera extends Camera3D { constructor(size?: number, aspect?: number, near?: number, far?: number); size: number; aspect: number; }
  class Raycaster3D { ray: Ray; setFromCamera(nx: number, ny: number, camera: Camera3D): this; set(origin: Vec3, direction: Vec3): this; intersect(root: Node3D | Node3D[], options?: RaycastOptions3D): Hit3D[]; }
  interface RaycastOptions3D { filter?: (mesh: Mesh3D) => boolean; recursive?: boolean; first?: boolean; bounds?: boolean; objects?: Node3D | Node3D[]; far?: number; }
  interface Hit3D { object: Mesh3D; distance: number; point: Vec3; normal?: Vec3; instanceId?: number; faceIndex?: number; }

  /* ------------------------------------------------------------ vista 3D (se añade a una escena 2D) */
  interface View3DOptions { x?: number; y?: number; width?: number; height?: number; fov?: number; near?: number; far?: number; renderScale?: number; antialias?: boolean; shadows?: boolean; background?: ColorInput; scene3d?: Scene3D; camera?: Camera3D; autoAspect?: boolean; }
  type MaterialInput = Material3D | MaterialOptions | ColorInput;
  interface Factory3D {
    <T extends Node3D>(node: T): T;
    mesh(geometry: Geometry3D, material?: MaterialInput): Mesh3D;
    box(w?: number, h?: number, d?: number, material?: MaterialInput): Mesh3D; cube(size?: number, material?: MaterialInput): Mesh3D;
    sphere(radius?: number, material?: MaterialInput, segments?: number): Mesh3D; plane(w?: number, d?: number, material?: MaterialInput, segX?: number, segZ?: number): Mesh3D;
    cylinder(rTop?: number, rBottom?: number, h?: number, material?: MaterialInput, segments?: number): Mesh3D; cone(r?: number, h?: number, material?: MaterialInput, segments?: number): Mesh3D;
    capsule(r?: number, len?: number, material?: MaterialInput): Mesh3D; torus(R?: number, r?: number, material?: MaterialInput): Mesh3D;
    extrude(points: any, height?: number, material?: MaterialInput): Mesh3D;
    terrain(w?: number, d?: number, segX?: number, segZ?: number, heights?: ((x: number, z: number) => number) | ArrayLike<number> | null, material?: MaterialInput): Mesh3D;
    instanced(geometry: Geometry3D, material: MaterialInput, count?: number): InstancedMesh3D; group(...children: Node3D[]): Group3D; sprite(texture: Texture | string, w?: number, h?: number, options?: any): Sprite3D;
    ambientLight(color?: ColorInput, intensity?: number): AmbientLight; hemisphereLight(sky?: ColorInput, ground?: ColorInput, intensity?: number): HemisphereLight; directionalLight(color?: ColorInput, intensity?: number): DirectionalLight;
    pointLight(color?: ColorInput, intensity?: number, range?: number, decay?: number): PointLight; spotLight(color?: ColorInput, intensity?: number, range?: number, angle?: number, penumbra?: number): SpotLight;
    sunlight(o?: { sky?: ColorInput; ground?: ColorInput; ambient?: number; color?: ColorInput; intensity?: number; direction?: [number, number, number]; shadows?: boolean; shadowSize?: number; shadowMapSize?: number; follow?: Node3D }): { sun: DirectionalLight; hemi: HemisphereLight };
    /** Instancia un modelo cargado con load.gltf / load.glb / load.obj */
    model(key: string, options?: { castShadow?: boolean; receiveShadow?: boolean; cloneMaterials?: boolean; scale?: number }): Group3D;
  }
  class View3D extends Sprite {
    constructor(x?: number | View3DOptions, y?: number, width?: number, height?: number, options?: View3DOptions);
    readonly scene3d: Scene3D; camera: Camera3D; readonly add: Factory3D; physics: PhysicsWorld3D | null; readonly rt: RenderTexture; readonly mixers: AnimationMixer3D[];
    fullscreen: boolean; viewWidth: number; viewHeight: number; renderScale: number; antialias: boolean; shadows: boolean; autoRender: boolean; timeScale: number; paused: boolean; readonly raycaster: Raycaster3D;
    readonly stats: { [k: string]: number };
    setSize(w: number, h: number): this; setBackground(color: ColorInput, alpha?: number): this; invalidate(): this; material(m?: MaterialInput): Material3D;
    toNDC(x: number, y: number, out?: Vec2): Vec2; screenToRay(x: number, y: number, out?: Ray): Ray; raycast(x: number, y: number, options?: RaycastOptions3D): Hit3D[]; pick(x: number, y: number, options?: RaycastOptions3D): Hit3D | null;
    worldToScreen(v: Vec3, out?: { x: number; y: number; visible: boolean; depth: number }): { x: number; y: number; visible: boolean; depth: number };
    playSound(key: string, where?: Vec3 | Node3D | null, config?: PlayConfig & { refDistance?: number; maxDistance?: number; rolloff?: number }): SoundInstance | null; playSfx(spec: string | object, where?: Vec3 | Node3D | null, config?: PlayConfig): SoundInstance | null;
    addControl(c: Controls3D): Controls3D; removeControl(c: Controls3D): this;
    enablePhysics(o?: { gravity?: number; fixedStep?: number; cell?: number }): PhysicsWorld3D;
    orbitControls(o?: OrbitControlsOptions): OrbitControls3D; firstPersonControls(o?: FirstPersonOptions): FirstPersonControls3D; thirdPersonControls(o?: ThirdPersonOptions): ThirdPersonControls3D;
    followCamera(o?: { target?: Node3D; distance?: number; height?: number; lookHeight?: number; stiffness?: number; lookAhead?: number; collide?: boolean }): FollowCamera3D; flyControls(o?: { speed?: number; fastSpeed?: number; sensitivity?: number; button?: number }): FlyControls3D;
    addParticles(preset: string | Particle3DConfig, options?: Particle3DConfig): ParticleEmitter3D;
    effect(preset: string | Particle3DConfig, position: Vec3 | { x: number; y: number; z: number }, options?: { count?: number; direction?: [number, number, number]; [k: string]: any }): ParticleEmitter3D;
  }
  interface GameObjectFactory { view3d(options?: View3DOptions): View3D; view3d(x: number, y: number, width: number, height: number, options?: View3DOptions): View3D; }
  class Renderer3D { static get(renderer: BaseRenderer): Renderer3D | null; setLimits(maxDir: number, maxPoint: number, maxSpot: number): void; }
  class WebGL3D extends Renderer3D {}
  class WebGPU3D extends Renderer3D {}
  class Shader3D {}
  function colorToLinear(c: ColorInput, out?: number[]): number[];

  /* ------------------------------------------------------------ modelos (Blender -> glTF/GLB, OBJ) */
  class Model3D { readonly name: string; readonly template: Group3D; readonly animations: AnimationClip3D[]; readonly clipNames: string[]; readonly textures: Texture[]; readonly materials: Material3D[]; readonly cameras: Camera3D[]; readonly lights: Light3D[]; readonly destroyed: boolean; instantiate(options?: { castShadow?: boolean; receiveShadow?: boolean; cloneMaterials?: boolean; scale?: number }): Group3D; destroy(): void; }
  const GLTF: { parse(data: ArrayBuffer | string | object, options?: { baseURL?: string; loader?: (uri: string) => Promise<ArrayBuffer>; name?: string; lightScale?: number }): Promise<Model3D>; isGLB(buf: ArrayBuffer): boolean; parseGLB(buf: ArrayBuffer): { json: any; bin: Uint8Array | null }; limits: { maxNodes: number; maxAccessorCount: number; maxImages: number; maxDepth: number; maxPrimitives: number; maxJoints: number } };
  class GLTFParser { constructor(json: any, bin: Uint8Array | null, options?: any); parse(): Promise<Model3D>; }
  const OBJ: { parseText(text: string): any; parseMTL(text: string): Record<string, any>; parse(objText: string, mtlText?: string | null, options?: any): Promise<Model3D> };
  const GLTFExporter: { export(root: Node3D, options?: { animations?: AnimationClip3D[]; name?: string }): { json: any; bin: Uint8Array }; toGLB(json: any, bin: Uint8Array): Uint8Array; exportGLB(root: Node3D, options?: { animations?: AnimationClip3D[]; name?: string }): Uint8Array };
  function encodePNG(width: number, height: number, rgba: Uint8Array): Uint8Array;
  interface Loader { gltf(key: string, url: string, opts?: LoadOptions): this; glb(key: string, url: string, opts?: LoadOptions): this; obj(key: string, url: string, mtlURL?: string, opts?: LoadOptions): this; model(key: string, url: string, opts?: LoadOptions): this; }
  interface CacheManager { readonly models: Map<string, Model3D>; }

  /* ------------------------------------------------------------ animación 3D */
  interface PlayAnimationOptions { fade?: number; loop?: 'repeat' | 'once' | 'pingpong'; repetitions?: number; speed?: number; weight?: number; restart?: boolean; exclusive?: boolean; clamp?: boolean; }
  class AnimationClip3D { constructor(name: string, tracks: any[], duration?: number); name: string; duration: number; tracks: any[]; /** spec: { nodo: { position?: [t, x, y, z][]; scale?: [t, x, y, z][]; quaternion?: [t, x, y, z, w][]; rotationX?|rotationY?|rotationZ?: [t, radianes][] } } */ static fromKeys(name: string, spec: Record<string, { position?: number[][]; scale?: number[][]; quaternion?: number[][]; rotationX?: number[][]; rotationY?: number[][]; rotationZ?: number[][] }>, interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE'): AnimationClip3D; }
  class AnimationAction3D { readonly name: string; readonly isRunning: boolean; readonly progress: number; time: number; speed: number; weight: number; clampWhenFinished: boolean; play(): this; stop(): this; reset(): this; setLoop(mode: 'repeat' | 'once' | 'pingpong', repetitions?: number): this; fadeIn(d: number): this; fadeOut(d: number): this; crossFadeTo(other: AnimationAction3D, d: number): this; }
  /** Eventos: 'finished' (acción) al acabar un clip 'once' o sus repeticiones; 'loop' (acción) en cada vuelta */
  class AnimationMixer3D extends EventEmitter { constructor(root: Node3D, clips?: AnimationClip3D[]); readonly clipNames: string[]; readonly actions: AnimationAction3D[]; current: AnimationAction3D | null; timeScale: number; attach(scene3d: Scene3D): this; detach(): this; getClip(name: string): AnimationClip3D | null; clipAction(clip: string | AnimationClip3D): AnimationAction3D | null; play(name: string, options?: PlayAnimationOptions): AnimationAction3D | null; stop(name?: string): this; isPlaying(name: string): boolean; update(dt: number): void; destroy(): void; }
  function sampleTrack3D(track: any, t: number, out: Float32Array | number[]): void;

  /* ------------------------------------------------------------ física 3D (determinista, 60 Hz) */
  class Collider3D { readonly type: string; readonly id: number; enabled: boolean; layer: number; friction: number; restitution: number; userData: Record<string, any>; node: Node3D | null; min: Vec3; max: Vec3; }
  class BoxCollider3D extends Collider3D { constructor(center: Vec3, half: Vec3, quat?: Quat | null); center: Vec3; half: Vec3; setTransform(center: Vec3, quat?: Quat | null): this; }
  class SphereCollider3D extends Collider3D { constructor(center: Vec3, radius: number); center: Vec3; radius: number; }
  class MeshCollider3D extends Collider3D { constructor(tris: Float32Array, cell?: number); }
  interface RaycastHit3D { distance: number; point: Vec3; normal: Vec3; collider?: Collider3D; body?: Body3D; character?: CharacterController3D; vehicle?: Vehicle3D; }
  class Body3D extends EventEmitter {
    readonly id: number; node: Node3D | null; shape: 'sphere' | 'box'; radius: number; half: Vec3; position: Vec3; velocity: Vec3; mass: number; restitution: number; friction: number; gravityScale: number; linearDamping: number;
    sleeping: boolean; onGround: boolean; enabled: boolean; layer: number; mask: number; userData: Record<string, any>; min: Vec3; max: Vec3;
    applyImpulse(x: number, y: number, z: number): this; setVelocity(x: number, y: number, z: number): this; setPosition(x: number, y: number, z: number): this; wake(): this; destroy(): void;
  }
  class CharacterController3D extends EventEmitter {
    readonly id: number; node: Node3D | null; radius: number; height: number; stepHeight: number; maxSlope: number; gravity: number | null; jumpSpeed: number; coyoteTime: number; pushForce: number; airControl: number;
    position: Vec3; velocity: Vec3; onGround: boolean; groundNormal: Vec3; hitCeiling: boolean; hitWall: boolean; enabled: boolean; layer: number; mask: number; userData: Record<string, any>; min: Vec3; max: Vec3;
    /** Velocidad horizontal deseada para el siguiente paso (m/s) */
    move(vx: number, vz: number): this; jump(speed?: number): boolean; teleport(x: number | Vec3, y?: number, z?: number): this; destroy(): void;
  }
  class Vehicle3D extends EventEmitter {
    readonly id: number; node: Node3D; position: Vec3; heading: number; speed: number; maxSpeed: number; reverseSpeed: number; accel: number; brake: number; drag: number; turnRate: number; grip: number;
    radius: number; length: number; width: number; rideHeight: number; wheelRadius: number; onGround: boolean; enabled: boolean; readonly forward: Vec3; readonly kmh: number;
    setInput(throttle: number, steer: number, brake?: boolean, handbrake?: boolean): this; teleport(p: Vec3, heading?: number): this; destroy(): void;
  }
  class Trigger3D extends EventEmitter { readonly id: number; enabled: boolean; once: boolean; center: Vec3; radius: number; half: Vec3 | null; node: Node3D | null; readonly inside: Set<any>; userData: Record<string, any>; destroy(): void; }
  class PhysicsWorld3D extends EventEmitter {
    constructor(o?: { gravity?: number; fixedStep?: number; cell?: number }); gravity: number; readonly statics: Collider3D[]; readonly bodies: Body3D[]; readonly characters: CharacterController3D[]; readonly vehicles: Vehicle3D[]; readonly triggers: Trigger3D[];
    addBox(center: Vec3, half: Vec3, quat?: Quat | null, o?: { friction?: number; restitution?: number; layer?: number; userData?: any }): BoxCollider3D; addSphere(center: Vec3, radius: number, o?: any): SphereCollider3D; addGround(y?: number, o?: any): BoxCollider3D;
    addMesh(node: Node3D, o?: { cell?: number; [k: string]: any }): MeshCollider3D | null; addBoxFromNode(node: Node3D, o?: any): BoxCollider3D | null; removeStatic(c: Collider3D): this;
    addBody(node: Node3D | null, o?: { shape?: 'sphere' | 'box'; radius?: number; half?: { x: number; y: number; z: number }; mass?: number; restitution?: number; friction?: number; gravityScale?: number; damping?: number; position?: Vec3; roll?: boolean; layer?: number; mask?: number }): Body3D;
    addCharacter(node: Node3D | null, o?: { radius?: number; height?: number; stepHeight?: number; maxSlope?: number; gravity?: number; jumpSpeed?: number; coyoteTime?: number; pushForce?: number; airControl?: number; layer?: number; mask?: number }): CharacterController3D;
    addVehicle(node: Node3D, o?: { heading?: number; maxSpeed?: number; reverseSpeed?: number; accel?: number; brake?: number; drag?: number; turnRate?: number; grip?: number; radius?: number; length?: number; width?: number; rideHeight?: number; wheelRadius?: number; wheels?: (Node3D | null)[] }): Vehicle3D;
    addTrigger(o: { center?: Vec3; radius?: number; half?: Vec3; node?: Node3D; once?: boolean; onEnter?: (who: any) => void; onExit?: (who: any) => void; userData?: any }): Trigger3D;
    remove(obj: Body3D | CharacterController3D | Vehicle3D | Trigger3D): this; step(dt: number): void;
    raycast(origin: Vec3, dir: Vec3, maxDist?: number, options?: { mask?: number; statics?: boolean; bodies?: boolean; characters?: boolean; vehicles?: boolean; ignore?: any }): RaycastHit3D | null;
    lineOfSight(a: Vec3, b: Vec3, mask?: number): boolean; groundHeight(x: number, z: number, fromY?: number, maxDown?: number): number | null; overlapSphere(center: Vec3, radius: number): any[]; explode(center: Vec3, radius: number, force: number): void; clear(): void; destroy(): void;
  }
  function closestPtTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3, out?: Vec3): Vec3;
  function worldTriangles(node: Node3D, out?: number[]): number[];

  /* ------------------------------------------------------------ controles de cámara 3D */
  interface ExternalInput { forward?: number; strafe?: number; run?: boolean; jump?: boolean; }
  class Controls3D { enabled: boolean; readonly destroyed: boolean; readonly view: View3D; readonly camera: Camera3D; update(dt: number): void; destroy(): void; }
  interface OrbitControlsOptions { target?: Vec3 | { x: number; y: number; z: number }; distance?: number; minDistance?: number; maxDistance?: number; yaw?: number; pitch?: number; minPitch?: number; maxPitch?: number; damping?: number; rotateSpeed?: number; zoomSpeed?: number; pan?: boolean; autoRotate?: number; }
  class OrbitControls3D extends Controls3D { target: Vec3; distance: number; yaw: number; pitch: number; autoRotate: number; }
  interface FirstPersonOptions { character?: CharacterController3D; position?: Vec3; eyeHeight?: number; speed?: number; runSpeed?: number; sensitivity?: number; invertY?: boolean; yaw?: number; joystick?: VirtualJoystick; bob?: number; pointerLock?: boolean; }
  class FirstPersonControls3D extends Controls3D { yaw: number; pitch: number; speed: number; runSpeed: number; moving: boolean; running: boolean; readonly isLocked: boolean; lock(): void; unlock(): void; setExternal(o: ExternalInput | null): this; getDirection(out?: Vec3): Vec3; }
  interface ThirdPersonOptions { target?: Node3D; character?: CharacterController3D; distance?: number; height?: number; minDistance?: number; maxDistance?: number; speed?: number; runSpeed?: number; turnSpeed?: number; collide?: boolean; yaw?: number; pitch?: number; sensitivity?: number; joystick?: VirtualJoystick; pointerLock?: boolean; shoulder?: number; aimDistance?: number; aimShoulder?: number; autoFace?: boolean; }
  class ThirdPersonControls3D extends Controls3D { yaw: number; pitch: number; distance: number; facing: number; aiming: boolean; moving: boolean; running: boolean; readonly isLocked: boolean; setExternal(o: ExternalInput | null): this; getAimDirection(out?: Vec3): Vec3; }
  class FollowCamera3D extends Controls3D { target: Node3D | null; distance: number; height: number; stiffness: number; snap(): this; }
  class FlyControls3D extends Controls3D { speed: number; fastSpeed: number; }

  /* ------------------------------------------------------------ partículas 3D y niveles */
  interface Particle3DConfig {
    rate?: number; burst?: number; life?: [number, number]; speed?: [number, number]; spread?: number; direction?: [number, number, number]; gravity?: number; size?: [number, number]; color?: [ColorInput, ColorInput];
    alpha?: [number, number]; blend?: 'add' | 'normal'; drag?: number; radius?: number; box?: [number, number, number]; offset?: [number, number, number]; stretch?: number; wobble?: number; capacity?: number;
    autoStart?: boolean; autoDestroy?: boolean; duration?: number; worldSpace?: boolean; texture?: Texture | string; fog?: boolean; renderOrder?: number;
  }
  const PARTICLE3D_PRESETS: Record<'fire' | 'smoke' | 'explosion' | 'sparks' | 'dust' | 'magic' | 'blood' | 'muzzle' | 'rain' | 'snow' | 'coin' | 'trail', Particle3DConfig>;
  class ParticleEmitter3D extends InstancedMesh3D { constructor(view: View3D, preset: string | Particle3DConfig, options?: Particle3DConfig); emitting: boolean; readonly alive: number; cfg: Particle3DConfig; burst(n: number, position?: Vec3, direction?: [number, number, number]): this; start(): this; stop(): this; update(dt: number): boolean; }
  function softParticleTexture(size?: number): Texture;
  interface Level3DResult { root: Group3D; spawns: Record<string, Vec3[]>; objects: any[]; colliders: Collider3D[]; cell: number; width: number; height: number; origin: Vec3; walls?: InstancedMesh3D | null; crates?: InstancedMesh3D | null; toWorld(x: number, z: number): Vec3; toCell(p: Vec3): { x: number; z: number }; solid?(x: number, z: number): boolean; }
  const Level3D: {
    /** filas de texto + leyenda: { '#': 'wall', '.': 'floor', C: 'crate', P: 'spawn:player' } */
    fromGrid(view: View3D | { scene3d: Scene3D; physics?: PhysicsWorld3D | null; material(m: any): Material3D }, rows: string[], legend: Record<string, string | object | null>, options?: { cell?: number; wallHeight?: number; center?: boolean; offset?: { x?: number; y?: number; z?: number }; materials?: Record<string, MaterialInput | null>; physics?: boolean; name?: string }): Level3DResult;
    fromTiled(view: View3D, map: string | object, options?: { cell?: number; center?: boolean; colors?: ColorInput[]; materials?: Record<number, MaterialOptions>; physics?: boolean; name?: string }): Level3DResult;
  };

  /* ------------------------------------------------------------ audio posicional */
  interface PlayConfig { spatial?: { position?: Vec3 | { x: number; y: number; z: number }; refDistance?: number; maxDistance?: number; rolloff?: number; model?: 'inverse' | 'linear' | 'exponential' }; }
  interface SoundInstance { setPosition(x: number, y: number, z: number): this; }
  interface SoundManager { setListener(px: number, py: number, pz: number, fx?: number, fy?: number, fz?: number, ux?: number, uy?: number, uz?: number): this; }
}
declare global { const UltraGame: typeof UG; }
export = UG;
export as namespace UG;
