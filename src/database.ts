import type { SQLiteDatabase } from 'expo-sqlite';

export type StoredPlan = {
  id: number;
  title: string;
  category: string;
  area: string;
  starts_at: string;
  language: string;
  spots: number;
  trusted_only: number;
  created_at: string;
};
export type LocalProfile = { id:number; account_code:string; name:string; city:string; zone:string; languages:string; interests:string; bio:string; };
export type LocalConnection = { id:number; account_code:string; display_name:string; status:string; created_at:string; };

export async function migrateDatabase(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 80),
      category TEXT NOT NULL,
      area TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      language TEXT NOT NULL,
      spots INTEGER NOT NULL CHECK(spots BETWEEN 2 AND 12),
      trusted_only INTEGER NOT NULL DEFAULT 0 CHECK(trusted_only IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS profile_trust (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      is_adult INTEGER NOT NULL DEFAULT 1,
      is_verified INTEGER NOT NULL DEFAULT 1,
      attended_plans INTEGER NOT NULL DEFAULT 3,
      has_active_restriction INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO profile_trust(id) VALUES (1);
    CREATE TABLE IF NOT EXISTS local_profile (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      account_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 40),
      city TEXT NOT NULL,
      zone TEXT NOT NULL,
      languages TEXT NOT NULL,
      interests TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_code TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','blocked')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    PRAGMA user_version = 3;
  `);
}

export async function getProfile(db: SQLiteDatabase) { return db.getFirstAsync<LocalProfile>('SELECT * FROM local_profile WHERE id=1'); }
export async function saveProfile(db: SQLiteDatabase, p: Omit<LocalProfile,'id'|'account_code'>) {
  await db.runAsync(`INSERT INTO local_profile(id,account_code,name,city,zone,languages,interests,bio)
    VALUES(1,'NK-' || upper(substr(hex(randomblob(8)),1,12)),?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,city=excluded.city,zone=excluded.zone,languages=excluded.languages,interests=excluded.interests,bio=excluded.bio`,
    p.name.trim(),p.city.trim(),p.zone.trim(),p.languages.trim(),p.interests.trim(),p.bio.trim());
}
export async function addPendingConnection(db:SQLiteDatabase, accountCode:string, displayName:string){return db.runAsync('INSERT INTO connections(account_code,display_name,status) VALUES(?,?,?)',accountCode,displayName,'pending');}
export async function hasConnection(db:SQLiteDatabase, accountCode:string){return !!(await db.getFirstAsync('SELECT 1 FROM connections WHERE account_code=?',accountCode));}

export async function listPlans(db: SQLiteDatabase) {
  return db.getAllAsync<StoredPlan>('SELECT * FROM plans ORDER BY id DESC');
}

export async function savePlan(db: SQLiteDatabase, plan: Omit<StoredPlan, 'id'|'created_at'|'trusted_only'> & {trustedOnly: boolean}) {
  const statement = await db.prepareAsync(`
    INSERT INTO plans(title, category, area, starts_at, language, spots, trusted_only)
    VALUES ($title, $category, $area, $startsAt, $language, $spots, $trustedOnly)
  `);
  try {
    return await statement.executeAsync({
      $title: plan.title.trim(), $category: plan.category, $area: plan.area.trim(),
      $startsAt: plan.starts_at.trim(), $language: plan.language.trim(),
      $spots: plan.spots, $trustedOnly: plan.trustedOnly ? 1 : 0,
    });
  } finally { await statement.finalizeAsync(); }
}
