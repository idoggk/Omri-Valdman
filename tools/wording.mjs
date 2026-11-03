// Shared wording rules for the verifiers (kept free of imports so any tool can use it).
// A stem that throws, drops or shoots something must say that air resistance is negligible (the word "התנגדות").
export const PROJECTILE_RE = /נזרק|נשמט|משוחרר|משתחרר|נופל|נופלת|זורק|נורה|נורית|זריקה|נפילה|מושלך|שוחרר|צונח|מתגלגל|יוצא מקצה/;
export const AIR_WORD = /התנגדות/;
/** Problem text for a physics stem, or null. */
export const airResistanceProblem = (title, stem) => (PROJECTILE_RE.test(`${title || ''} ${stem || ''}`) && !AIR_WORD.test(stem || '') ? 'projectile stem must say that air resistance is negligible (התנגדות האוויר זניחה)' : null);
