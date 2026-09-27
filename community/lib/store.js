// 서버 측 영속 저장소.
// 기존 사이트의 결함(localStorage 전용 → 글이 작성자 브라우저 밖으로 나가지 못함)을
// 해결하는 지점이므로, 모든 쓰기는 디스크에 원자적으로 반영된다.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = () => ({
  users: [],
  sessions: [],
  posts: [],
  lunchVotes: [],
  breakScores: [],
  // 퇴근 후 성장 — 전부 사용자가 실제로 남긴 기록만 쌓인다
  goals: [],        // { by, text, updatedAt }        오늘의 10분 목표
  goalDays: [],     // { by, date }                   목표 완료 표시
  quizAttempts: [], // { by, score, total, at }       자격증 문제 풀이 결과
  reading: [],      // { by, bookId, page, pages, updatedAt }  독서 진도
});

export class Store {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    this.load();
  }

  load() {
    if (!existsSync(this.file)) {
      mkdirSync(dirname(this.file), { recursive: true });
      this.persist();
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      this.data = { ...EMPTY(), ...parsed };
    } catch {
      // 손상된 파일로 서버가 죽지 않도록 빈 상태로 복구한다.
      this.data = EMPTY();
      this.persist();
    }
  }

  // 임시 파일에 쓴 뒤 rename — 쓰기 도중 중단돼도 반쪽 파일이 남지 않는다.
  persist() {
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }

  reset(seedData) {
    this.data = { ...EMPTY(), ...(seedData || {}) };
    this.persist();
  }

  // ---- users ----
  findUserByEmail(email) {
    const key = String(email || '').trim().toLowerCase();
    return this.data.users.find((u) => u.email === key) || null;
  }

  findUserById(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  addUser(user) {
    this.data.users.push(user);
    this.persist();
    return user;
  }

  updateUser(id, patch) {
    const user = this.findUserById(id);
    if (!user) return null;
    Object.assign(user, patch);
    this.persist();
    return user;
  }

  // ---- sessions ----
  findSession(token) {
    if (!token) return null;
    return this.data.sessions.find((s) => s.token === token) || null;
  }

  addSession(session) {
    this.data.sessions.push(session);
    this.persist();
    return session;
  }

  updateSession(token, patch) {
    const s = this.findSession(token);
    if (!s) return null;
    Object.assign(s, patch);
    this.persist();
    return s;
  }

  // ---- posts ----
  addPost(post) {
    this.data.posts.push(post);
    this.persist();
    return post;
  }

  findPost(id) {
    return this.data.posts.find((p) => p.id === id) || null;
  }

  allPosts() {
    return this.data.posts;
  }

  save() {
    this.persist();
  }

  // ---- lunch ----
  addLunchVote(vote) {
    this.data.lunchVotes.push(vote);
    this.persist();
    return vote;
  }

  lunchVotes() {
    return this.data.lunchVotes;
  }

  // ---- break ----
  addBreakScore(score) {
    this.data.breakScores.push(score);
    this.persist();
    return score;
  }

  breakScores() {
    return this.data.breakScores;
  }

  // ---- 퇴근 후 성장 ----
  goalOf(key) {
    return this.data.goals.find((g) => g.by === key) || null;
  }

  setGoal(key, text) {
    const existing = this.goalOf(key);
    if (existing) {
      existing.text = text;
      existing.updatedAt = new Date().toISOString();
    } else {
      this.data.goals.push({ by: key, text, updatedAt: new Date().toISOString() });
    }
    this.persist();
    return this.goalOf(key);
  }

  goalDays() {
    return this.data.goalDays;
  }

  markGoalDay(key, date) {
    if (this.data.goalDays.some((d) => d.by === key && d.date === date)) return false;
    this.data.goalDays.push({ by: key, date, at: new Date().toISOString() });
    this.persist();
    return true;
  }

  unmarkGoalDay(key, date) {
    const before = this.data.goalDays.length;
    this.data.goalDays = this.data.goalDays.filter((d) => !(d.by === key && d.date === date));
    if (this.data.goalDays.length !== before) { this.persist(); return true; }
    return false;
  }

  quizAttempts() {
    return this.data.quizAttempts;
  }

  addQuizAttempt(entry) {
    this.data.quizAttempts.push(entry);
    this.persist();
    return entry;
  }

  reading() {
    return this.data.reading;
  }

  readingOf(key, bookId) {
    return this.data.reading.find((r) => r.by === key && r.bookId === bookId) || null;
  }

  setReading(key, bookId, page, pages) {
    const existing = this.readingOf(key, bookId);
    if (existing) {
      existing.page = page;
      if (pages !== null && pages !== undefined) existing.pages = pages;
      existing.updatedAt = new Date().toISOString();
    } else {
      this.data.reading.push({
        by: key, bookId, page, pages: pages ?? null, updatedAt: new Date().toISOString(),
      });
    }
    this.persist();
    return this.readingOf(key, bookId);
  }
}

export function defaultDbPath(root) {
  return join(root, 'data', 'db.json');
}
