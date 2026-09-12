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
export type StoredGroup = { id:number; title:string; category:string; area:string; language:string; description:string; women_only:number; trusted_only:number; safety_total:number; safety_count:number; created_at:string; };
export type GroupMembership = { id:number; group_id:number; status:string; created_at:string; };

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
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 60),
      category TEXT NOT NULL,
      area TEXT NOT NULL,
      language TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      women_only INTEGER NOT NULL DEFAULT 0 CHECK(women_only IN (0,1)),
      trusted_only INTEGER NOT NULL DEFAULT 0 CHECK(trusted_only IN (0,1)),
      safety_total INTEGER NOT NULL DEFAULT 0,
      safety_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS group_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','left')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS local_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      gender TEXT NOT NULL DEFAULT 'prefer_not_to_say' CHECK(gender IN ('woman','man','non_binary','prefer_not_to_say'))
    );
    INSERT OR IGNORE INTO local_settings(id) VALUES (1);
    PRAGMA user_version = 4;
  `);
}

export async function listGroups(db:SQLiteDatabase) { return db.getAllAsync<StoredGroup>('SELECT * FROM groups ORDER BY id DESC'); }
export async function saveGroup(db:SQLiteDatabase, g:Omit<StoredGroup,'id'|'created_at'|'safety_total'|'safety_count'>&{womenOnly:boolean;trustedOnly:boolean}) {
  return db.runAsync('INSERT INTO groups(title,category,area,language,description,women_only,trusted_only) VALUES(?,?,?,?,?,?,?)',g.title.trim(),g.category,g.area.trim(),g.language.trim(),g.description.trim(),g.womenOnly?1:0,g.trustedOnly?1:0);
}
export async function requestGroupJoin(db:SQLiteDatabase, groupId:number) { return db.runAsync("INSERT OR IGNORE INTO group_memberships(group_id,status) VALUES(?,'pending')",groupId); }
export async function listMemberships(db:SQLiteDatabase) { return db.getAllAsync<GroupMembership>('SELECT * FROM group_memberships'); }
export async function getGender(db:SQLiteDatabase) { const row=await db.getFirstAsync<{gender:string}>('SELECT gender FROM local_settings WHERE id=1'); return row?.gender??'prefer_not_to_say'; }
export async function setGender(db:SQLiteDatabase, gender:string) { return db.runAsync('UPDATE local_settings SET gender=? WHERE id=1',gender); }
export async function rateGroupSafety(db:SQLiteDatabase, groupId:number, rating:number) { if(await getGender(db)!=='woman') throw new Error('women-only-rating'); return db.runAsync('UPDATE groups SET safety_total=safety_total+?, safety_count=safety_count+1 WHERE id=?',rating,groupId); }

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
