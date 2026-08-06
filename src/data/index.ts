// src/data/index.ts — JSON 데이터 로드 + 타입 부여 (ui 진입점에서 사용)
import configJson from "./config.json";
import beatsJson from "./beats/demo2_zeroc.json";
import cardsJson from "./cards.json";
import gatesJson from "./gates.json";
import tuningJson from "./tuning.json";
import charactersJson from "./characters.json";
import ticketsJson from "./tickets.json";
import beatmapsJson from "./beatmaps.json";
import { DEFAULT_TUNING } from "../engine/state";
import type { GameConfig, Beat, CardTemplate, GateDef, Tuning, CharacterDef, TicketDef, BeatmapSet } from "../engine/types";

export const config = configJson as unknown as GameConfig;
export const beats = (beatsJson as unknown as { beats: Beat[] }).beats;
export const cardTemplates = cardsJson as unknown as CardTemplate[];
export const gates = gatesJson as unknown as GateDef[];
// 기본값 병합 — tuning.json에 키가 없어도(구버전·watch 제외로 인한 stale 포함) 안전
export const tuning: Tuning = { ...DEFAULT_TUNING, ...(tuningJson as Partial<Tuning>) };
export const casting = (beatsJson as unknown as { casting: Record<string, string> }).casting ?? {};
export const characters = (charactersJson as unknown as { characters: CharacterDef[] }).characters;
export const tickets = (ticketsJson as unknown as { tickets: TicketDef[] }).tickets;
export const beatmaps = (beatmapsJson as unknown as { maps: Record<string, BeatmapSet> }).maps;
