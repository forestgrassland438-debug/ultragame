// Tipos de la API de scripts de UltraGame Studio.
// Para autocompletado en VS Code, añade al principio de un archivo de script:
//   /// <reference path="ruta/a/types/ultragame.d.ts" />
//   /// <reference path="ruta/a/types/ultragame-studio.d.ts" />
// Dentro de un script del Studio existen tres nombres: `self` (el objeto del motor), `api` (esta API) y `UG` (el motor).

interface UGStudioEntity {
  readonly id: number; readonly name: string; readonly tags: string[]; readonly vars: Record<string, any>; readonly alive: boolean; readonly is3d: boolean;
  /** vida (comportamiento «Vida»), o null si no tiene */ hp: number | null;
  /** objeto del motor: DisplayObject en 2D o Node3D en 3D */ readonly obj: any;
  /** personaje 3D, cuerpo dinámico 3D y vehículo, si los tiene */ readonly ch: UG.CharacterController3D | null; readonly body: UG.Body3D | null; readonly car: UG.Vehicle3D | null;
}
interface UGStudioAPI {
  readonly UG: typeof UG; readonly game: UG.Game; readonly scene: UG.Scene; readonly view: UG.View3D | null; readonly self: any; readonly entity: UGStudioEntity | null;
  /** variables globales del juego */ readonly vars: Record<string, any>; /** variables propias de este objeto */ readonly my: Record<string, any>;
  readonly pointer: UG.Pointer; readonly time: number; readonly camera: UG.Camera | UG.Camera3D; readonly physics: UG.ArcadePhysics | UG.PhysicsWorld3D | null; readonly animKey: string | null;
  log(...args: any[]): void; warn(...args: any[]): void;
  key(name: string): boolean; pressed(name: string): boolean; released(name: string): boolean;
  find(ref: string): any; findAll(ref: string): any[]; entityOf(obj: any): UGStudioEntity | null;
  spawn(template: string, x?: number, y?: number, z?: number): any; destroy(obj?: any, effect?: 'none' | 'explosion' | 'smoke' | 'sparks' | 'magic'): void; damage(obj?: any, amount?: number): void;
  goto(scene: string): void; restart(): void;
  sfx(preset: 'coin' | 'laser' | 'explosion' | 'powerup' | 'hit' | 'jump' | 'blip' | 'click' | 'bounce' | 'shoot' | 'hurt' | 'select', volume?: number): void;
  sound(assetOrSfx: string, volume?: number): void; music(asset: string, volume?: number): void; stopMusic(): void;
  effect(preset: string, x?: number, y?: number, z?: number): void; shake(ms?: number, intensity?: number): void; flash(color?: number | string, ms?: number): void;
  text(template: string): string; floatText(text: string, x?: number, y?: number, color?: string): void;
  after(seconds: number, fn: () => void): UG.TimerEvent; every(seconds: number, fn: () => void): UG.TimerEvent; tween(config: UG.TweenConfig): UG.Tween;
  random(min?: number, max?: number): number; chance(p: number): boolean; distance(a: any, b: any): number;
  emit(name: string, data?: any): void;
  get(name: string): any; set(name: string, value: any): void; add(name: string, amount?: number): void;
  /** guardado entre partidas (JSON, máx. 256 KB por clave) */ save(key: string, value: any): boolean; load<T = any>(key: string, def?: T): T;
}
declare const api: UGStudioAPI;
declare const self: any;
/** Funciones que el Studio llama si están definidas en el script */
declare function onStart(): void;
declare function onUpdate(dt: number): void;
declare function onCollide(other: any, entity: UGStudioEntity): void;
declare function onClick(pointer: UG.Pointer): void;
declare function onDestroy(): void;
declare function onMessage(name: string, data: any): void;
