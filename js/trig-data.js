// Content of the trig-identities teacher (#/trig). Hebrew text, plain-text expressions understood by js/trig.js.
// Every equation here is checked numerically by tools/verify-trig.mjs at many random angles.
// The idea: memorise only three ANCHORS and derive everything else with visible steps (the CHAIN).

export const CHAIN = [
  { from: "העוגנים", to: "כפולה", how: "מציבים b = a" },
  { from: "כפולה + עוגן", to: "משולשת", how: "מפרקים 3a = 2a + a" },
  { from: "כפולה", to: "הורדת חזקה", how: "מסדרים את cos 2a הפוך" },
  { from: "כפולה", to: "חצי זווית וטי", how: "a/2 במקום a, וחלוקה ב־cos²" },
  { from: "העוגנים", to: "מכפלה ← סכום", how: "מחברים ומחסרים את sin(a+b) ו־sin(a−b)" },
  { from: "מכפלה ← סכום", to: "סכום ← מכפלה", how: "קוראים את אותה נוסחה מהסוף להתחלה" },
  { from: "פיתגורס", to: "tan, cot, sec", how: "מחלקים ב־cos² או ב־sin²" },
];

export const ANCHOR_IDS = ["pyth", "sinsum", "cossum"];

/**
 * Lessons. formulas = what must be remembered (each becomes a flashcard).
 * derive = steps shown one by one: say (Hebrew), eq (equation chain, optional).
 */
export const LESSONS = [
  {
    id: "pyth", anchor: true, title: "עוגן 1: פיתגורס על מעגל היחידה",
    formulas: [{ name: "sin² + cos²", eq: "sin²(a) + cos²(a) = 1" }],
    mnemonic: "הנקודה על מעגל היחידה היא (cos a , sin a): קוסינוס הוא ה־x וסינוס הוא ה־y (בסדר האלפבית x לפני y, וגם ״קוס״ לפני ״סין״). המרחק למרכז הוא 1, ולכן x² + y² = 1.",
    derive: [
      { say: "פיתגורס במשולש ישר זווית שהיתר שלו 1 והניצבים cos a ו־sin a:", eq: "cos²(a) + sin²(a) = 1" },
      { say: "מזה אפשר להעביר אגפים ולקבל כל צורה שצריך:", eq: "sin²(a) = 1 - cos²(a)" },
      { say: "ואם מחלקים ב־cos² (נשתמש בזה בשיעור הקשרים):", eq: "1 + tan²(a) = 1/cos²(a)" },
    ],
    check: "בדיקה: a = 30° נותן 0.25 + 0.75 = 1.",
  },
  {
    id: "sinsum", anchor: true, title: "עוגן 2: סינוס של סכום",
    formulas: [{ name: "sin(a+b)", eq: "sin(a+b) = sin(a)cos(b) + cos(a)sin(b)" }],
    mnemonic: "סינוס ״מערבב״: בכל מכפלה מופיעים סינוס וקוסינוס, וביניהם פלוס. חריזה: ״סינוס – מערבבים ומחברים״.",
    derive: [
      { say: "תבנית: כל מחובר מכיל סינוס אחד וקוסינוס אחד (בלי sin·sin ובלי cos·cos):", eq: "sin(a+b) = sin(a)cos(b) + cos(a)sin(b)" },
      { say: "בדיקה מהירה עם b = 0: צריך לקבל sin a.", eq: "sin(a+0) = sin(a)cos(0) + cos(a)sin(0) = sin(a)" },
    ],
    check: "בדיקה: a = 30°, b = 60°: sin 90° = 1 ו־0.5·0.5 + 0.866·0.866 = 1.",
  },
  {
    id: "cossum", anchor: true, title: "עוגן 3: קוסינוס של סכום",
    formulas: [{ name: "cos(a+b)", eq: "cos(a+b) = cos(a)cos(b) - sin(a)sin(b)" }],
    mnemonic: "קוסינוס ״מזווג״: דומה עם דומה (קוס־קוס וסין־סין), והסימן הפוך לסימן שבתוך הסוגריים. חריזה: ״קוסינוס – מזווגים ומחסירים״.",
    derive: [
      { say: "תבנית: שני מחוברים ״זוגיים״, והסימן שבאמצע הפוך לסימן ב־(a+b):", eq: "cos(a+b) = cos(a)cos(b) - sin(a)sin(b)" },
      { say: "בדיקה עם a = b = 45°: cos 90° = 0, והחיסור נותן אפס.", eq: "cos(a+a) = cos²(a) - sin²(a)" },
    ],
    check: "בדיקה: a = 30°, b = 60°: cos 90° = 0 ו־0.866·0.5 − 0.5·0.866 = 0.",
  },
  {
    id: "diff", title: "חיסור זוויות (b ← −b)",
    formulas: [
      { name: "sin(a−b)", eq: "sin(a-b) = sin(a)cos(b) - cos(a)sin(b)" },
      { name: "cos(a−b)", eq: "cos(a-b) = cos(a)cos(b) + sin(a)sin(b)" },
    ],
    mnemonic: "לא לומדים עוד שתי נוסחאות: מציבים (−b). קוסינוס זוגי (cos(−b) = cos b), סינוס אי־זוגי (sin(−b) = −sin b). לכן בחיסור הסימן באמצע ״מתהפך״.",
    derive: [
      { say: "מציבים (−b) בעוגן של הסינוס:", eq: "sin(a-b) = sin(a)cos(-b) + cos(a)sin(-b) = sin(a)cos(b) - cos(a)sin(b)" },
      { say: "מציבים (−b) בעוגן של הקוסינוס:", eq: "cos(a-b) = cos(a)cos(-b) - sin(a)sin(-b) = cos(a)cos(b) + sin(a)sin(b)" },
    ],
    check: "בדיקה: a = b נותן sin 0 = 0 ו־cos 0 = 1.",
  },
  {
    id: "tansum", title: "tan של סכום (מחלקים את העוגנים)",
    formulas: [
      { name: "tan(a+b)", eq: "tan(a+b) = (tan(a) + tan(b))/(1 - tan(a)tan(b))" },
      { name: "tan(a−b)", eq: "tan(a-b) = (tan(a) - tan(b))/(1 + tan(a)tan(b))" },
    ],
    mnemonic: "tan הוא סינוס חלקי קוסינוס, אז מחלקים את שני העוגנים. במונה הסימן כמו בסוגריים, במכנה הסימן הפוך.",
    derive: [
      { say: "כותבים tan כמנה של שני העוגנים:", eq: "tan(a+b) = sin(a+b)/cos(a+b) = (sin(a)cos(b) + cos(a)sin(b))/(cos(a)cos(b) - sin(a)sin(b))" },
      { say: "מחלקים מונה ומכנה ב־cos a · cos b:", eq: "(sin(a)cos(b) + cos(a)sin(b))/(cos(a)cos(b) - sin(a)sin(b)) = (tan(a) + tan(b))/(1 - tan(a)tan(b))" },
    ],
    check: "בדיקה: b = 0 נותן tan a.",
  },
  {
    id: "double", title: "זווית כפולה (מציבים b = a)",
    formulas: [
      { name: "sin 2a", eq: "sin(2a) = 2sin(a)cos(a)" },
      { name: "cos 2a (הפרש ריבועים)", eq: "cos(2a) = cos²(a) - sin²(a)" },
      { name: "cos 2a (רק sin)", eq: "cos(2a) = 1 - 2sin²(a)" },
      { name: "cos 2a (רק cos)", eq: "cos(2a) = 2cos²(a) - 1" },
      { name: "tan 2a", eq: "tan(2a) = 2tan(a)/(1 - tan²(a))" },
    ],
    mnemonic: "שלושה ״בגדים״ לאותו cos 2a. בוחרים לפי מה שיש בשאלה: רק sin ← 1 − 2sin²; רק cos ← 2cos² − 1; שניהם ← cos² − sin². בדיקת סימן: a = 0 נותן 1 בשלושתם.",
    derive: [
      { say: "מציבים b = a בעוגן של הסינוס:", eq: "sin(2a) = sin(a+a) = sin(a)cos(a) + cos(a)sin(a) = 2sin(a)cos(a)" },
      { say: "מציבים b = a בעוגן של הקוסינוס:", eq: "cos(2a) = cos(a+a) = cos(a)cos(a) - sin(a)sin(a) = cos²(a) - sin²(a)" },
      { say: "מחליפים cos² = 1 − sin² (פיתגורס) ומקבלים צורה בלי cos:", eq: "cos²(a) - sin²(a) = (1 - sin²(a)) - sin²(a) = 1 - 2sin²(a)" },
      { say: "מחליפים sin² = 1 − cos² ומקבלים צורה בלי sin:", eq: "cos²(a) - sin²(a) = cos²(a) - (1 - cos²(a)) = 2cos²(a) - 1" },
      { say: "מחלקים sin 2a ב־cos 2a, ואז מונה ומכנה ב־cos²:", eq: "tan(2a) = sin(2a)/cos(2a) = 2sin(a)cos(a)/(cos²(a) - sin²(a)) = 2tan(a)/(1 - tan²(a))" },
    ],
    check: "בדיקה: a = 30°: sin 60° = 0.866 = 2·0.5·0.866, ו־cos 60° = 0.5 = 1 − 2·0.25.",
  },
  {
    id: "triple", title: "זווית משולשת (3a = 2a + a)",
    formulas: [
      { name: "sin 3a", eq: "sin(3a) = 3sin(a) - 4sin³(a)" },
      { name: "cos 3a", eq: "cos(3a) = 4cos³(a) - 3cos(a)" },
    ],
    mnemonic: "״שלוש־ארבע״ כמו שלישיית פיתגורס: בסינוס 3 קודם ואז 4 (3 sin − 4 sin³), בקוסינוס ההפוך: 4cos³ − 3cos. הפונקציה שמתחילים בה היא גם זו שמעלים בשלישית.",
    derive: [
      { say: "מפרקים 3a = 2a + a ומשתמשים בעוגן ובכפולה:", eq: "sin(3a) = sin(2a+a) = sin(2a)cos(a) + cos(2a)sin(a)" },
      { say: "מציבים sin 2a = 2 sin a cos a ו־cos 2a = 1 − 2sin²a:", eq: "sin(2a)cos(a) + cos(2a)sin(a) = 2sin(a)cos²(a) + (1 - 2sin²(a))sin(a)" },
      { say: "cos² = 1 − sin² כדי להישאר עם סינוס בלבד:", eq: "2sin(a)cos²(a) + (1 - 2sin²(a))sin(a) = 2sin(a)(1 - sin²(a)) + sin(a) - 2sin³(a) = 3sin(a) - 4sin³(a)" },
      { say: "קוסינוס: אותו פירוק, והפעם בוחרים cos 2a = 2cos² − 1 ו־sin² = 1 − cos²:", eq: "cos(3a) = cos(2a+a) = cos(2a)cos(a) - sin(2a)sin(a) = (2cos²(a) - 1)cos(a) - 2sin²(a)cos(a)" },
      { say: "מסיימים:", eq: "(2cos²(a) - 1)cos(a) - 2sin²(a)cos(a) = (2cos²(a) - 1)cos(a) - 2(1 - cos²(a))cos(a) = 4cos³(a) - 3cos(a)" },
    ],
    check: "בדיקת סימן: a = 90°: sin 270° = −1 ו־3 − 4 = −1. ו־a = 60°: cos 180° = −1 ו־4·0.125 − 1.5 = −1.",
  },
  {
    id: "power", title: "הורדת חזקה (cos 2a הפוך)",
    formulas: [
      { name: "sin²a", eq: "sin²(a) = (1 - cos(2a))/2" },
      { name: "cos²a", eq: "cos²(a) = (1 + cos(2a))/2" },
      { name: "sin²a·cos²a", eq: "sin²(a)cos²(a) = (1 - cos(4a))/8" },
      { name: "sin³a", eq: "sin³(a) = (3sin(a) - sin(3a))/4" },
      { name: "cos³a", eq: "cos³(a) = (3cos(a) + cos(3a))/4" },
    ],
    mnemonic: "ריבוע ״יורד״ לזווית כפולה: מחלקים ב־2 ומוסיפים ״cos 2a״. ל־cos² הסימן פלוס (כי cos 0 = 1) ול־sin² הסימן מינוס (כי sin 0 = 0, וחייבים לקבל אפס). קוביות באות מהמשולשת, מסודרת הפוך.",
    derive: [
      { say: "מבודדים sin² מהצורה 1 − 2sin² של cos 2a:", eq: "cos(2a) = 1 - 2sin²(a)  ⟹  sin²(a) = (1 - cos(2a))/2" },
      { say: "מבודדים cos² מהצורה 2cos² − 1:", eq: "cos(2a) = 2cos²(a) - 1  ⟹  cos²(a) = (1 + cos(2a))/2" },
      { say: "מכפלה ריבועית: sin a cos a = ½ sin 2a, ואז מורידים חזקה שוב:", eq: "sin²(a)cos²(a) = sin²(2a)/4 = (1 - cos(4a))/8" },
      { say: "מבודדים sin³ מנוסחת הסינוס המשולש:", eq: "sin(3a) = 3sin(a) - 4sin³(a)  ⟹  sin³(a) = (3sin(a) - sin(3a))/4" },
      { say: "מבודדים cos³ מנוסחת הקוסינוס המשולש:", eq: "cos(3a) = 4cos³(a) - 3cos(a)  ⟹  cos³(a) = (3cos(a) + cos(3a))/4" },
    ],
    check: "בדיקת סימן: a = 0: sin² = 0 = (1 − 1)/2, ו־cos² = 1 = (1 + 1)/2.",
  },
  {
    id: "half", title: "חצי זווית ו־t = tan(a/2)",
    formulas: [
      { name: "sin a לפי t", eq: "sin(a) = 2t/(1 + t²)" },
      { name: "cos a לפי t", eq: "cos(a) = (1 - t²)/(1 + t²)" },
      { name: "tan a לפי t", eq: "tan(a) = 2t/(1 - t²)" },
      { name: "tan²(a/2)", eq: "tan²(a/2) = (1 - cos(a))/(1 + cos(a))" },
      { name: "tan(a/2)", eq: "tan(a/2) = sin(a)/(1 + cos(a))" },
    ],
    mnemonic: "t קטן עושה הכול. המכנה של sin ושל cos זהה (1 + t²), ובמונה: 2t לסינוס, (1 − t²) לקוסינוס. tan הוא המנה שלהם, ולכן מכנה 1 − t². לפי תבנית: ״2t על 1 ועוד, 1 פחות על 1 ועוד״.",
    derive: [
      { say: "כותבים sin a כזווית כפולה של a/2 ומחלקים ב־1 = sin² + cos² ואז ב־cos²:", eq: "sin(a) = 2sin(a/2)cos(a/2) = 2sin(a/2)cos(a/2)/(sin²(a/2) + cos²(a/2)) = 2tan(a/2)/(tan²(a/2) + 1) = 2t/(1 + t²)" },
      { say: "אותו טריק לקוסינוס:", eq: "cos(a) = cos²(a/2) - sin²(a/2) = (cos²(a/2) - sin²(a/2))/(cos²(a/2) + sin²(a/2)) = (1 - tan²(a/2))/(1 + tan²(a/2)) = (1 - t²)/(1 + t²)" },
      { say: "tan a הוא המנה:", eq: "tan(a) = sin(a)/cos(a) = 2t/(1 - t²)" },
      { say: "ל־tan² של חצי זווית: 1 − cos a = 2sin²(a/2) ו־1 + cos a = 2cos²(a/2):", eq: "tan²(a/2) = sin²(a/2)/cos²(a/2) = 2sin²(a/2)/(2cos²(a/2)) = (1 - cos(a))/(1 + cos(a))" },
      { say: "ועוד צורה שימושית (מכפילים מונה ומכנה ב־2cos(a/2)):", eq: "tan(a/2) = sin(a/2)/cos(a/2) = 2sin(a/2)cos(a/2)/(2cos²(a/2)) = sin(a)/(1 + cos(a))" },
    ],
    check: "בדיקת סימן: a = 90° ← t = 1: sin = 2/2 = 1, cos = 0/2 = 0.",
  },
  {
    id: "p2s", title: "מכפלה ← סכום (מחברים ומחסרים עוגנים)",
    formulas: [
      { name: "sin·cos", eq: "sin(a)cos(b) = (sin(a+b) + sin(a-b))/2" },
      { name: "cos·cos", eq: "cos(a)cos(b) = (cos(a+b) + cos(a-b))/2" },
      { name: "sin·sin", eq: "sin(a)sin(b) = (cos(a-b) - cos(a+b))/2" },
      { name: "cos·sin", eq: "cos(a)sin(b) = (sin(a+b) - sin(a-b))/2" },
    ],
    mnemonic: "מכפלה = חצי מסכום של זוג זוויות: הסכום (a+b) וההפרש (a−b). בסינוס־סינוס ההפרש קודם ויש מינוס (״הפרש פחות סכום״), כי כש־a = b חייב לצאת (1 − cos 2a)/2, כלומר sin².",
    derive: [
      { say: "מחברים את שני עוגני הסינוס (sin(a+b) ו־sin(a−b)). הגורמים sin·cos מוכפלים פי 2 והשאר מתבטל:", eq: "sin(a+b) + sin(a-b) = 2sin(a)cos(b)" },
      { say: "מחסרים אותם: נשאר רק cos·sin:", eq: "sin(a+b) - sin(a-b) = 2cos(a)sin(b)" },
      { say: "מחברים את שני עוגני הקוסינוס:", eq: "cos(a+b) + cos(a-b) = 2cos(a)cos(b)" },
      { say: "מחסרים (החיסור הפוך כדי לקבל ערך חיובי ל־sin·sin):", eq: "cos(a-b) - cos(a+b) = 2sin(a)sin(b)" },
    ],
    check: "בדיקת סימן: b = a בנוסחת sin·sin נותן sin²a = (1 − cos 2a)/2, בדיוק הורדת החזקה.",
  },
  {
    id: "s2p", title: "סכום ← מכפלה (קוראים את אותה נוסחה הפוך)",
    formulas: [
      { name: "sin + sin", eq: "sin(a) + sin(b) = 2sin((a+b)/2)cos((a-b)/2)" },
      { name: "sin − sin", eq: "sin(a) - sin(b) = 2cos((a+b)/2)sin((a-b)/2)" },
      { name: "cos + cos", eq: "cos(a) + cos(b) = 2cos((a+b)/2)cos((a-b)/2)" },
      { name: "cos − cos", eq: "cos(a) - cos(b) = -2sin((a+b)/2)sin((a-b)/2)" },
    ],
    mnemonic: "ממוצע קודם, חצי הפרש אחריו. חריזה לארבע הנוסחאות לפי הסדר: ״סי־קו, קו־סי, קו־קו, מינוס סי־סי״ (sin+sin ← סין·קוס; sin−sin ← קוס·סין; cos+cos ← קוס·קוס; cos−cos ← מינוס שניים סין·סין). כלל: פלוס שומר על השם, מינוס מחליף.",
    pattern: [
      ["sin + sin", "2 · sin(ממוצע) · cos(חצי הפרש)", "סי־קו"],
      ["sin − sin", "2 · cos(ממוצע) · sin(חצי הפרש)", "קו־סי"],
      ["cos + cos", "2 · cos(ממוצע) · cos(חצי הפרש)", "קו־קו"],
      ["cos − cos", "−2 · sin(ממוצע) · sin(חצי הפרש)", "מינוס סי־סי"],
    ],
    derive: [
      { say: "מסמנים p = (a+b)/2 ו־q = (a−b)/2, כלומר a = p+q ו־b = p−q, ומציבים בנוסחת המכפלה←סכום (הפעם קוראים אותה מהסוף להתחלה):", eq: "sin(a) + sin(b) = sin((a+b)/2 + (a-b)/2) + sin((a+b)/2 - (a-b)/2) = 2sin((a+b)/2)cos((a-b)/2)" },
      { say: "אותו מהלך עם הפרש סינוסים:", eq: "sin(a) - sin(b) = sin((a+b)/2 + (a-b)/2) - sin((a+b)/2 - (a-b)/2) = 2cos((a+b)/2)sin((a-b)/2)" },
      { say: "סכום קוסינוסים:", eq: "cos(a) + cos(b) = cos((a+b)/2 + (a-b)/2) + cos((a+b)/2 - (a-b)/2) = 2cos((a+b)/2)cos((a-b)/2)" },
      { say: "הפרש קוסינוסים (כאן המינוס מגיע מהחיסור ההפוך):", eq: "cos(a) - cos(b) = cos((a+b)/2 + (a-b)/2) - cos((a+b)/2 - (a-b)/2) = -2sin((a+b)/2)sin((a-b)/2)" },
    ],
    check: "בדיקת סימן מהירה: a = 60°, b = 0°. cos a − cos b = 0.5 − 1 = −0.5, וגם −2·sin30°·sin30° = −0.5. אם יצא חיובי שכחתם את המינוס. ובסינוס: sin 60° − sin 0° = 0.866 = 2·cos30°·sin30°.",
  },
  {
    id: "rel", title: "קשרים: tan, cot, sec",
    formulas: [
      { name: "tan ו־cot", eq: "tan(a) = sin(a)/cos(a)" },
      { name: "1 + tan²", eq: "1 + tan²(a) = 1/cos²(a)" },
      { name: "1 + cot²", eq: "1 + cot²(a) = 1/sin²(a)" },
      { name: "tan + cot", eq: "tan(a) + cot(a) = 2/sin(2a)" },
      { name: "cot − tan", eq: "cot(a) - tan(a) = 2cot(2a)" },
    ],
    mnemonic: "sec a הוא פשוט 1/cos a (ו־csc a הוא 1/sin a): אין צורך להכיר אותם כפונקציות חדשות. מחלקים את פיתגורס ב־cos² ← 1 + tan² = sec², וב־sin² ← 1 + cot² = csc². ״tan ועוד cot״ תמיד מתכנס למכנה אחד sin·cos.",
    derive: [
      { say: "מחלקים את sin² + cos² = 1 ב־cos²:", eq: "1 + tan²(a) = (cos²(a) + sin²(a))/cos²(a) = 1/cos²(a)" },
      { say: "מחלקים ב־sin²:", eq: "1 + cot²(a) = (sin²(a) + cos²(a))/sin²(a) = 1/sin²(a)" },
      { say: "מכנה משותף sin·cos, פיתגורס במונה, ואז sin 2a = 2 sin a cos a:", eq: "tan(a) + cot(a) = sin(a)/cos(a) + cos(a)/sin(a) = (sin²(a) + cos²(a))/(sin(a)cos(a)) = 2/sin(2a)" },
      { say: "אותו מהלך, רק במונה cos² − sin² = cos 2a:", eq: "cot(a) - tan(a) = cos(a)/sin(a) - sin(a)/cos(a) = (cos²(a) - sin²(a))/(sin(a)cos(a)) = 2cos(2a)/sin(2a) = 2cot(2a)" },
    ],
    check: "בדיקה: a = 45°: tan + cot = 2 = 2/sin 90°, ו־cot − tan = 0 = 2cot 90°.",
  },
];

/* ---------- drills ---------- */

/** Fill the blank. `?` in the template is replaced by the option text; options[ans] must make an identity, the rest must not. */
export const FILL = [
  { id: "f1", template: "sin(a+b) = sin(a)cos(b) + ?", options: ["cos(a)sin(b)", "cos(a)cos(b)", "sin(a)sin(b)", "-cos(a)sin(b)"], ans: 0, tip: "סינוס מערבב: סינוס־קוסינוס פלוס קוסינוס־סינוס." },
  { id: "f2", template: "cos(a+b) = cos(a)cos(b) ? sin(a)sin(b)", options: ["-", "+", "- 2", "+ 2"], ans: 0, tip: "קוסינוס מזווג, והסימן הפוך לסימן שבסוגריים." },
  { id: "f3", template: "cos(2a) = 1 - ?", options: ["2sin²(a)", "2cos²(a)", "sin²(a)", "sin(2a)"], ans: 0, tip: "הצורה שמכילה רק sin: 1 − 2sin²a." },
  { id: "f4", template: "cos(2a) = ? - 1", options: ["2cos²(a)", "2sin²(a)", "cos²(a)", "4cos²(a)"], ans: 0, tip: "הצורה שמכילה רק cos: 2cos²a − 1." },
  { id: "f5", template: "sin(3a) = 3sin(a) - ?", options: ["4sin³(a)", "4cos³(a)", "3sin³(a)", "4sin(a)"], ans: 0, tip: "שלוש־ארבע: 3 sin − 4 sin³." },
  { id: "f6", template: "cos(3a) = 4cos³(a) - ?", options: ["3cos(a)", "3sin(a)", "4cos(a)", "3cos²(a)"], ans: 0, tip: "בקוסינוס ההפוך: 4 cos³ − 3 cos." },
  { id: "f7", template: "sin²(a) = (1 - ?)/2", options: ["cos(2a)", "cos(a)", "sin(2a)", "cos²(a)"], ans: 0, tip: "הורדת חזקה: sin² = (1 − cos 2a)/2." },
  { id: "f8", template: "tan(2a) = 2tan(a)/(1 - ?)", options: ["tan²(a)", "tan(a)", "2tan(a)", "tan(2a)"], ans: 0, tip: "המכנה 1 − tan²a." },
  { id: "f9", template: "sin(a) + sin(b) = 2sin((a+b)/2)?", options: ["cos((a-b)/2)", "cos((a+b)/2)", "sin((a-b)/2)", "sin((a+b)/2)"], ans: 0, tip: "סי־קו: ממוצע בסינוס, חצי הפרש בקוסינוס." },
  { id: "f10", template: "cos(a) - cos(b) = ? sin((a+b)/2)sin((a-b)/2)", options: ["-2", "2", "-1", "1"], ans: 0, tip: "מינוס סי־סי: מינוס שניים." },
  { id: "f11", template: "sin(a)cos(b) = (sin(a+b) + ?)/2", options: ["sin(a-b)", "cos(a-b)", "sin(b-a)", "cos(a+b)"], ans: 0, tip: "מחברים את שני עוגני הסינוס: sin(a+b) + sin(a−b)." },
  { id: "f12", template: "sin(a)sin(b) = (cos(a-b) - ?)/2", options: ["cos(a+b)", "cos(a-b)", "sin(a+b)", "sin(a-b)"], ans: 0, tip: "ההפרש קודם: cos(a−b) פחות cos(a+b)." },
  { id: "f13", template: "tan²(a/2) = (1 - cos(a))/(1 ? cos(a))", options: ["+", "-", "+ 2"], ans: 0, tip: "מונה 1 − cos, מכנה 1 + cos." },
  { id: "f14", template: "sin(a) = 2t/(1 + ?)", options: ["t²", "t", "2t", "1"], ans: 0, tip: "t = tan(a/2) והמכנה 1 + t²." },
  { id: "f15", template: "1 + tan²(a) = ?", options: ["1/cos²(a)", "1/sin²(a)", "1/cos(a)", "cos²(a)"], ans: 0, tip: "מחלקים פיתגורס ב־cos²." },
  { id: "f16", template: "cot(a) - tan(a) = 2?", options: ["cot(2a)", "tan(2a)", "cot(a)", "sin(2a)"], ans: 0, tip: "cos² − sin² במונה נותן cos 2a." },
];

/** "Which identity is wrong?" Exactly one statement is false (index `wrong`); it must also differ at a=30°, b=60°. */
export const WRONG = [
  { id: "w1", statements: ["sin(2a) = 2sin(a)cos(a)", "cos(2a) = 1 - 2sin²(a)", "sin²(a) = (1 + cos(2a))/2", "tan(2a) = 2tan(a)/(1 - tan²(a))"], wrong: 2, why: "ב־sin² הסימן מינוס: sin²a = (1 − cos 2a)/2. הנוסחה עם הפלוס שייכת ל־cos²." },
  { id: "w2", statements: ["cos(a+b) = cos(a)cos(b) + sin(a)sin(b)", "sin(a-b) = sin(a)cos(b) - cos(a)sin(b)", "cos(a-b) = cos(a)cos(b) + sin(a)sin(b)", "sin(a+b) = sin(a)cos(b) + cos(a)sin(b)"], wrong: 0, why: "בקוסינוס של סכום הסימן באמצע הוא מינוס. הפלוס שייך ל־cos(a−b)." },
  { id: "w3", statements: ["sin(3a) = 3sin(a) - 4sin³(a)", "cos(3a) = 4cos³(a) - 3cos(a)", "sin(3a) = 4sin(a) - 3sin³(a)", "cos(3a) = cos(a)(4cos²(a) - 3)"], wrong: 2, why: "הסדר בסינוס הוא 3 sin − 4 sin³ (שלוש קודם)." },
  { id: "w4", statements: ["sin(a) + sin(b) = 2sin((a+b)/2)cos((a-b)/2)", "cos(a) + cos(b) = 2cos((a+b)/2)cos((a-b)/2)", "sin(a) - sin(b) = 2cos((a+b)/2)sin((a-b)/2)", "cos(a) - cos(b) = 2sin((a+b)/2)sin((a-b)/2)"], wrong: 3, why: "ב־cos − cos חסר מינוס: cos a − cos b = −2 sin(ממוצע) sin(חצי הפרש). אצלנו a = 30°, b = 60° נותן 0.366 מול −0.366." },
  { id: "w5", statements: ["tan²(a/2) = (1 - cos(a))/(1 + cos(a))", "sin(a) = 2t/(1 + t²)", "cos(a) = (1 - t²)/(1 + t²)", "tan(a) = 2t/(1 + t²)"], wrong: 3, why: "מכנה ה־tan הוא 1 − t² (המכנה 1 + t² שייך ל־sin ול־cos)." },
  { id: "w6", statements: ["sin²(a) = (1 - cos(2a))/2", "cos(a)cos(b) = (cos(a+b) - cos(a-b))/2", "sin(a)cos(b) = (sin(a+b) + sin(a-b))/2", "cos²(a) = (1 + cos(2a))/2"], wrong: 1, why: "בצד ימין של cos·cos שני הקוסינוסים מתחברים: (cos(a+b) + cos(a−b))/2." },
  { id: "w7", statements: ["1 + tan²(a) = 1/cos²(a)", "cot(a) - tan(a) = 2/sin(2a)", "1 + cot²(a) = 1/sin²(a)", "tan(a) + cot(a) = 2/sin(2a)"], wrong: 1, why: "cot − tan נותן 2cot(2a), כי המונה הוא cos² − sin² = cos 2a. רק tan + cot נותן 2/sin 2a." },
  { id: "w8", statements: ["cos(2a) = 1 - 2cos²(a)", "sin(2a) = 2sin(a)cos(a)", "cos(2a) = cos²(a) - sin²(a)", "tan(2a) = 2tan(a)/(1 - tan²(a))"], wrong: 0, why: "1 − 2cos² מערבב שתי צורות: הנכונות הן 1 − 2sin² או 2cos² − 1." },
];

/* ---------- proof trainer ---------- */

// step: { hint, ok: next expression, why, bad: [{to, why}], detour?: {to, why} }
const S = (hint, ok, why, bad, detour) => ({ hint, ok, why, bad, detour });
const B = (to, why) => ({ to, why });

export const PROOFS = [
  {
    id: "p1", tier: 1, title: "מנה עם זווית כפולה",
    lhs: "(1 - cos(2a))/sin(2a)", rhs: "tan(a)",
    steps: [
      S("בוחרים את cos 2a בצורה שמתחילה ב־1: cos 2a = 1 − 2sin²a, כך שה־1 מתבטל.", "(1 - (1 - 2sin²(a)))/sin(2a)",
        "נכון. cos 2a = 1 − 2sin²a, והמינוס לפני הסוגריים מבטל את ה־1.",
        [B("(1 - (1 - 2cos²(a)))/sin(2a)", "ערבבתם צורות: 1 − 2cos²a אינו cos 2a. הצורה הנכונה היא 2cos²a − 1."), B("(1 - 2sin²(a))/sin(2a)", "שכחתם להחליף את כל ה־cos 2a: ה־1 שבמונה נשאר, אבל cos 2a נעלם.")],
        B("(1 - (2cos²(a) - 1))/sin(2a)", "נכון מספרית (זו הצורה השנייה של cos 2a), אבל ממנה לא ה־1 מתבטל. הצורה עם sin² חוסכת צעד.")),
      S("פותחים סוגריים במונה, ובמכנה sin 2a = 2 sin a cos a.", "2sin²(a)/(2sin(a)cos(a))",
        "נכון: המונה 2sin²a והמכנה 2sin a cos a.",
        [B("2sin²(a)/(sin(a)cos(a))", "sin 2a הוא 2 sin a cos a, בלי ה־2 איבדתם גורם."), B("sin²(a)/(2sin(a)cos(a))", "במונה נשאר 2sin²a, ה־2 לא נעלם.")]),
      S("מצמצמים 2 ואחד מה־sin.", "sin(a)/cos(a)",
        "נכון.",
        [B("sin(a)cos(a)", "אחרי צמצום ה־cos נשאר במכנה."), B("cos(a)/sin(a)", "הצמצום משאיר את sin במונה.")]),
      S("sin חלקי cos הוא פונקציה מוכרת.", "tan(a)", "נכון, וסיימנו.", [B("cot(a)", "cot הוא cos/sin, כלומר ההפוך."), B("sin(a)cos(a)", "אין כאן כפל.")]),
    ],
  },
  {
    id: "p2", tier: 1, title: "הפרש חזקות רביעיות",
    lhs: "cos⁴(a) - sin⁴(a)", rhs: "cos(2a)",
    steps: [
      S("הפרש ריבועים x² − y² = (x − y)(x + y) עם x = cos²a ו־y = sin²a.", "(cos²(a) - sin²(a))(cos²(a) + sin²(a))",
        "נכון: cos⁴ = (cos²)².",
        [B("(cos²(a) - sin²(a))(cos²(a) - sin²(a))", "בגורם השני צריך פלוס: (x−y)(x+y)."), B("(cos²(a) - sin²(a))²", "זה אינו הפירוק של הפרש ריבועים.")]),
      S("עוגן הפיתגורס: הסוגריים השניים שווים ל־1.", "(cos²(a) - sin²(a))·1",
        "נכון.",
        [B("(cos²(a) - sin²(a))·2", "sin² + cos² שווה 1, לא 2."), B("(cos²(a) - sin²(a))·0", "זה סכום ולא הפרש, לכן לא אפס.")]),
      S("cos² − sin² הוא אחד מהבגדים של cos 2a.", "cos(2a)",
        "נכון.",
        [B("sin(2a)", "הצורה cos² − sin² שייכת לקוסינוס."), B("1 - 2cos²(a)", "הצורה הנכונה היא 1 − 2sin²a או 2cos²a − 1.")]),
    ],
  },
  {
    id: "p3", tier: 1, title: "ריבוע של סכום",
    lhs: "(sin(a) + cos(a))²", rhs: "1 + sin(2a)",
    steps: [
      S("פותחים (x + y)² = x² + 2xy + y².", "sin²(a) + 2sin(a)cos(a) + cos²(a)",
        "נכון.",
        [B("sin²(a) + cos²(a)", "שכחתם את המכפלה הכפולה 2xy."), B("sin²(a) + sin(a)cos(a) + cos²(a)", "המכפלה האמצעית היא 2xy, לא xy.")]),
      S("מקבצים sin² + cos² (עוגן הפיתגורס).", "1 + 2sin(a)cos(a)",
        "נכון.",
        [B("2 + 2sin(a)cos(a)", "sin² + cos² שווה 1."), B("1 + sin(a)cos(a)", "ה־2 במכפלה נשאר.")]),
      S("2 sin a cos a הוא sin 2a.", "1 + sin(2a)", "נכון.", [B("1 + sin²(a)", "sin 2a אינו sin² a."), B("1 + 2sin(2a)", "ה־2 כבר נכלל ב־sin 2a.")]),
    ],
  },
  {
    id: "p4", tier: 1, title: "tan ועוד cot",
    lhs: "tan(a) + cot(a)", rhs: "2/sin(2a)",
    steps: [
      S("מציבים tan = sin/cos ו־cot = cos/sin.", "sin(a)/cos(a) + cos(a)/sin(a)",
        "נכון.",
        [B("sin(a)/cos(a) + sin(a)/cos(a)", "cot הוא ההפוך של tan: cos/sin."), B("sin(a)/cos(a) - cos(a)/sin(a)", "החיבור נשאר חיבור.")]),
      S("מכנה משותף sin·cos.", "(sin²(a) + cos²(a))/(sin(a)cos(a))",
        "נכון: sin·sin במונה הראשון ו־cos·cos בשני.",
        [B("(sin(a) + cos(a))/(sin(a)cos(a))", "כל שבר מוכפל במכנה של השני, ולכן מופיעים ריבועים."), B("(sin²(a) - cos²(a))/(sin(a)cos(a))", "זה חיבור, המונה הוא סכום.")]),
      S("עוגן הפיתגורס במונה.", "1/(sin(a)cos(a))", "נכון.", [B("2/(sin(a)cos(a))", "הסכום sin² + cos² שווה 1, לא 2."), B("sin(a)cos(a)", "המכנה לא עובר למונה.")]),
      S("רוצים sin 2a במכנה, לכן מכפילים מונה ומכנה ב־2.", "2/(2sin(a)cos(a))", "נכון.", [B("1/(2sin(a)cos(a))", "הכפלה רק של המכנה משנה את הערך."), B("2/(sin(a)cos(a))", "אתם לא מכפילים את המכנה ב־2.")]),
      S("2 sin a cos a הוא sin 2a.", "2/sin(2a)", "נכון, וסיימנו.", [B("2/sin²(a)", "sin 2a אינו sin²a."), B("1/sin(2a)", "המונה 2 נשאר.")]),
    ],
  },
  {
    id: "p5", tier: 2, title: "sin 3a חלקי sin a",
    lhs: "sin(3a)/sin(a)", rhs: "4cos²(a) - 1",
    steps: [
      S("3a = 2a + a, ואז עוגן הסינוס.", "(sin(2a)cos(a) + cos(2a)sin(a))/sin(a)",
        "נכון.",
        [B("(sin(2a)cos(a) - cos(2a)sin(a))/sin(a)", "זה סכום זוויות, לכן פלוס."), B("(sin(2a) + sin(a))/sin(a)", "sin של סכום אינו סכום הסינוסים.")]),
      S("מחליפים sin 2a ב־2 sin a cos a.", "(2sin(a)cos(a)cos(a) + cos(2a)sin(a))/sin(a)",
        "נכון.",
        [B("(2sin(a)cos(a) + cos(2a)sin(a))/sin(a)", "נשאר גם הגורם cos a מהעוגן."), B("(2sin(a)cos(a)cos(a) + cos(2a)cos(a))/sin(a)", "במחובר השני הגורם הוא sin a.")]),
      S("מוציאים sin a מהמונה ומצמצמים עם המכנה.", "2cos²(a) + cos(2a)",
        "נכון.",
        [B("2cos(a) + cos(2a)", "cos a מופיע פעמיים במחובר הראשון."), B("2cos²(a) + cos(2a)sin(a)", "אחרי צמצום ה־sin נעלם גם מהמחובר השני.")]),
      S("יש לנו רק cos, אז בוחרים את cos 2a שמכילה רק cos.", "2cos²(a) + 2cos²(a) - 1",
        "נכון.",
        [B("2cos²(a) + 1 - 2cos²(a)", "זה 1 − 2cos² בלי המינוס הנכון, לא cos 2a."), B("2cos²(a) + 2sin²(a) - 1", "הצורה 2sin² − 1 אינה cos 2a.")],
        B("2cos²(a) + 1 - 2sin²(a)", "נכון מספרית, אבל נשארים עם שני סוגי פונקציות ולא נוכל לאחד.")),
      S("מאחדים.", "4cos²(a) - 1", "נכון.", [B("4cos²(a) + 1", "הקבוע נשאר −1."), B("2cos²(a) - 1", "יש שני מחוברים 2cos² שמתחברים.")]),
    ],
  },
  {
    id: "p6", tier: 2, title: "שבר של חצי זווית",
    lhs: "(1 - cos(a))/(1 + cos(a))", rhs: "tan²(a/2)",
    steps: [
      S("cos a = 1 − 2sin²(a/2) היא cos 2x עם x = a/2, ולכן 1 − cos a = 2sin²(a/2).", "2sin²(a/2)/(1 + cos(a))",
        "נכון.",
        [B("sin²(a/2)/(1 + cos(a))", "1 − cos a שווה 2sin²(a/2), עם ה־2."), B("2cos²(a/2)/(1 + cos(a))", "במונה (1 − cos) יוצא sin² ולא cos².")]),
      S("אותו רעיון למכנה: cos a = 2cos²(a/2) − 1, ולכן 1 + cos a = 2cos²(a/2).", "2sin²(a/2)/(2cos²(a/2))",
        "נכון.",
        [B("2sin²(a/2)/cos²(a/2)", "נשאר 2 במכנה."), B("2sin²(a/2)/(2sin²(a/2))", "במכנה (1 + cos) יוצא cos²(a/2).")]),
      S("מצמצמים 2.", "sin²(a/2)/cos²(a/2)", "נכון.", [B("sin(a/2)/cos(a/2)", "החזקות נשארות ריבועיות."), B("cos²(a/2)/sin²(a/2)", "ההיפוך של השבר.")]),
      S("שבר של ריבועים הוא ריבוע של tan.", "tan²(a/2)", "נכון, וסיימנו.", [B("cot²(a/2)", "cot הוא cos/sin."), B("tan²(a)", "הזווית נשארת a/2.")]),
    ],
  },
  {
    id: "p7", tier: 2, title: "סכום ← מכפלה במנה",
    lhs: "(sin(7a) - sin(a))/(cos(7a) + cos(a))", rhs: "tan(3a)",
    steps: [
      S("sin − sin = 2 cos(ממוצע) sin(חצי הפרש), ממוצע 4a וחצי הפרש 3a.", "2cos(4a)sin(3a)/(cos(7a) + cos(a))",
        "נכון: ממוצע (7a+a)/2 = 4a וחצי הפרש (7a−a)/2 = 3a.",
        [B("2sin(4a)cos(3a)/(cos(7a) + cos(a))", "בהפרש סינוסים הממוצע בקוסינוס (קו־סי)."), B("2cos(3a)sin(4a)/(cos(7a) + cos(a))", "בלבלתם בין הממוצע לחצי ההפרש."), B("2cos(4a)sin(4a)/(cos(7a) + cos(a))", "חצי ההפרש הוא 3a, לא 4a.")]),
      S("cos + cos = 2 cos(ממוצע) cos(חצי הפרש).", "2cos(4a)sin(3a)/(2cos(4a)cos(3a))",
        "נכון.",
        [B("2cos(4a)sin(3a)/(2sin(4a)sin(3a))", "בסכום קוסינוסים שני הגורמים הם קוסינוסים."), B("2cos(4a)sin(3a)/(2cos(4a)sin(3a))", "במכנה כתבתם את המונה, אבל הוא סכום קוסינוסים.")]),
      S("מצמצמים 2cos 4a.", "sin(3a)/cos(3a)", "נכון.", [B("sin(3a)/cos(4a)", "לאחר הצמצום cos 3a נשאר במכנה."), B("cos(3a)/sin(3a)", "היפוך.")]),
      S("שבר סינוס חלקי קוסינוס של אותה זווית.", "tan(3a)", "נכון, וסיימנו.", [B("cot(3a)", "cot הוא ההפוך.")]),
    ],
  },
  {
    id: "p8", tier: 2, title: "הפרש קוסינוסים: מלכודת הסימן",
    lhs: "(cos(a) - cos(3a))/(sin(3a) + sin(a))", rhs: "tan(a)",
    steps: [
      S("cos x − cos y = −2 sin(ממוצע) sin(חצי הפרש). הממוצע של a ו־3a הוא 2a וחצי ההפרש (a − 3a)/2 = −a.", "-2sin(2a)sin(-a)/(sin(3a) + sin(a))",
        "נכון: חצי ההפרש שלילי, וזו הסיבה שבסוף המינוס יתבטל.",
        [B("2sin(2a)sin(-a)/(sin(3a) + sin(a))", "שכחתם את המינוס שבנוסחה."), B("-2sin(2a)sin(a)/(sin(3a) + sin(a))", "חצי ההפרש הוא (a−3a)/2 = −a, לא a.")]),
      S("sin(−a) = −sin a (סינוס אי־זוגי).", "2sin(2a)sin(a)/(sin(3a) + sin(a))",
        "נכון: שני המינוסים מתבטלים.",
        [B("-2sin(2a)sin(a)/(sin(3a) + sin(a))", "מינוס כפול מינוס נותן פלוס."), B("2sin(2a)cos(a)/(sin(3a) + sin(a))", "sin(−a) שווה −sin a ולא cos a.")]),
      S("sin + sin = 2 sin(ממוצע) cos(חצי הפרש), ממוצע 2a וחצי הפרש a.", "2sin(2a)sin(a)/(2sin(2a)cos(a))",
        "נכון.",
        [B("2sin(2a)sin(a)/(2cos(2a)sin(a))", "סי־קו: בסכום סינוסים הממוצע בסינוס וחצי ההפרש בקוסינוס."), B("2sin(2a)sin(a)/(2sin(2a)sin(a))", "במכנה חצי ההפרש בקוסינוס.")]),
      S("מצמצמים 2 sin 2a.", "sin(a)/cos(a)", "נכון.", [B("cos(a)/sin(a)", "ההיפוך.")]),
      S("sin חלקי cos.", "tan(a)", "נכון, וסיימנו.", [B("cot(a)", "cot הוא ההפוך.")]),
    ],
  },
  {
    id: "p9", tier: 3, title: "cot פחות tan",
    lhs: "cot(a) - tan(a)", rhs: "2cot(2a)",
    steps: [
      S("מציבים cot = cos/sin ו־tan = sin/cos.", "cos(a)/sin(a) - sin(a)/cos(a)",
        "נכון.",
        [B("cos(a)/sin(a) + sin(a)/cos(a)", "החיסור נשאר חיסור."), B("sin(a)/cos(a) - cos(a)/sin(a)", "הסדר: cot בא ראשון.")]),
      S("מכנה משותף sin·cos.", "(cos²(a) - sin²(a))/(sin(a)cos(a))",
        "נכון.",
        [B("(cos(a) - sin(a))/(sin(a)cos(a))", "המונה מכיל ריבועים כי כל שבר מוכפל במכנה של השני."), B("(cos²(a) + sin²(a))/(sin(a)cos(a))", "זה חיסור, לכן cos² − sin².")]),
      S("cos² − sin² הוא cos 2a.", "cos(2a)/(sin(a)cos(a))", "נכון.", [B("sin(2a)/(sin(a)cos(a))", "הצורה cos² − sin² היא קוסינוס."), B("1/(sin(a)cos(a))", "זה היה מתקבל מסכום ריבועים.")]),
      S("הכפלה ב־2 במונה ובמכנה כדי לקבל sin 2a במכנה.", "2cos(2a)/(2sin(a)cos(a))",
        "נכון.",
        [B("2cos(2a)/(sin(a)cos(a))", "המכנה חייב להיות מוכפל ב־2 גם הוא."), B("cos(2a)/(2sin(a)cos(a))", "הכפלה רק במכנה משנה את הערך.")]),
      S("2 sin a cos a הוא sin 2a.", "2cos(2a)/sin(2a)", "נכון.", [B("2cos(2a)/sin²(a)", "sin 2a אינו sin² a."), B("cos(2a)/sin(2a)", "ה־2 במונה נשאר.")]),
      S("cos חלקי sin הוא cot.", "2cot(2a)", "נכון, וסיימנו.", [B("2tan(2a)", "cos/sin הוא cot."), B("cot(2a)", "ה־2 נשאר.")]),
    ],
  },
  {
    id: "p10", tier: 3, title: "שלישיית סינוסים עם 60°",
    lhs: "4sin(a)sin(60° - a)sin(60° + a)", rhs: "sin(3a)",
    steps: [
      S("sin x sin y = ½ (cos(x−y) − cos(x+y)) על שני הסינוסים האחרונים. x−y = −2a ו־x+y = 120°.", "4sin(a)(cos(2a) - cos(120°))/2",
        "נכון: cos(−2a) = cos 2a.",
        [B("4sin(a)(cos(2a) + cos(120°))/2", "במכפלת סינוסים ההפרש פחות הסכום."), B("4sin(a)(cos(120°) - cos(2a))/2", "ההפרש בא קודם: cos(x−y) פחות cos(x+y).")]),
      S("הערך המדויק: cos 120° = −½.","4sin(a)(cos(2a) + 1/2)/2",
        "נכון.",
        [B("4sin(a)(cos(2a) - 1/2)/2", "מינוס כפול מינוס נותן פלוס."), B("4sin(a)(cos(2a) + 1)/2", "cos 120° הוא −½ ולא −1.")]),
      S("מצמצמים 4/2 ופותחים סוגריים.", "2sin(a)cos(2a) + sin(a)",
        "נכון.",
        [B("2sin(a)cos(2a) + 2sin(a)", "2·½ הוא 1."), B("4sin(a)cos(2a) + sin(a)", "4 חלקי 2 הוא 2.")]),
      S("2 sin x cos y = sin(x+y) + sin(x−y) עם x = a, y = 2a.", "sin(3a) + sin(-a) + sin(a)",
        "נכון.",
        [B("sin(3a) + sin(a) + sin(a)", "ההפרש x−y הוא a − 2a = −a."), B("cos(3a) + sin(-a) + sin(a)", "בעוגן הזה מופיעים רק סינוסים.")]),
      S("sin(−a) = −sin a ולכן שני החיבורים האחרונים מתבטלים.", "sin(3a)", "נכון, וסיימנו.", [B("sin(3a) + 2sin(a)", "הסכום sin(−a) + sin(a) הוא 0."), B("sin(3a) - 2sin(a)", "הסכום sin(−a) + sin(a) הוא 0.")]),
    ],
  },
  {
    id: "p11", tier: 3, title: "ארבעה קוסינוסים",
    lhs: "cos(a) + cos(3a) + cos(5a) + cos(7a)", rhs: "4cos(a)cos(2a)cos(4a)",
    steps: [
      S("מקבצים זוגות עם אותו ממוצע: a עם 7a וגם 3a עם 5a (ממוצע 4a בשניהם).", "(cos(a) + cos(7a)) + (cos(3a) + cos(5a))",
        "נכון.",
        [B("(cos(a) + cos(7a)) - (cos(3a) + cos(5a))", "הקיבוץ לא משנה את הסימן בין הזוגות.")],
        B("(cos(a) + cos(3a)) + (cos(5a) + cos(7a))", "נכון מספרית, אבל הממוצעים 2a ו־6a שונים ולא נוכל להוציא גורם משותף.")),
      S("cos + cos = 2 cos(ממוצע) cos(חצי הפרש) בכל זוג.", "2cos(4a)cos(3a) + 2cos(4a)cos(a)",
        "נכון: חצי ההפרש הוא 3a בזוג הראשון ו־a בשני.",
        [B("2cos(4a)sin(3a) + 2cos(4a)sin(a)", "בסכום קוסינוסים שני הגורמים קוסינוסים."), B("2cos(8a)cos(6a) + 2cos(8a)cos(2a)", "ממוצע ולא סכום: (a+7a)/2 = 4a.")]),
      S("מוציאים 2cos 4a כגורם משותף.", "2cos(4a)(cos(3a) + cos(a))",
        "נכון.",
        [B("2cos(4a)(cos(3a)cos(a))", "הגורם המשותף מוצא מחיבור ולא ממכפלה."), B("4cos(4a)(cos(3a) + cos(a))", "הגורם המשותף הוא 2cos 4a, לא 4.")]),
      S("שוב cos + cos בסוגריים: ממוצע 2a וחצי הפרש a.", "2cos(4a)·2cos(2a)cos(a)",
        "נכון.",
        [B("2cos(4a)·2cos(2a)sin(a)", "בסכום קוסינוסים שני הגורמים קוסינוסים."), B("2cos(4a)·2cos(a)cos(a)", "הממוצע של 3a ו־a הוא 2a.")]),
      S("2·2 = 4 וסידור הגורמים.", "4cos(a)cos(2a)cos(4a)", "נכון, וסיימנו.", [B("2cos(a)cos(2a)cos(4a)", "2 כפול 2 הוא 4."), B("4cos(a)cos(2a)cos(8a)", "הגורם הראשון הוא cos 4a.")]),
    ],
  },
  {
    id: "p12", tier: 3, title: "שבר עם 1, sin ו־cos",
    lhs: "(1 + sin(a) - cos(a))/(1 + sin(a) + cos(a))", rhs: "tan(a/2)",
    steps: [
      S("הופכים הכול לחצי זווית: 1 − cos a = 2sin²(a/2), 1 + cos a = 2cos²(a/2), sin a = 2 sin(a/2)cos(a/2).", "(2sin²(a/2) + 2sin(a/2)cos(a/2))/(2cos²(a/2) + 2sin(a/2)cos(a/2))",
        "נכון.",
        [B("(2cos²(a/2) + 2sin(a/2)cos(a/2))/(2sin²(a/2) + 2sin(a/2)cos(a/2))", "החלפתם מונה ומכנה: 1 − cos הוא sin² ו־1 + cos הוא cos²."), B("(2sin²(a/2) + sin(a/2)cos(a/2))/(2cos²(a/2) + sin(a/2)cos(a/2))", "sin a = 2 sin(a/2) cos(a/2) ובו ה־2.")]),
      S("מוציאים גורם משותף: 2 sin(a/2) במונה ו־2 cos(a/2) במכנה.", "2sin(a/2)(sin(a/2) + cos(a/2))/(2cos(a/2)(cos(a/2) + sin(a/2)))",
        "נכון.",
        [B("2sin(a/2)(sin(a/2) + cos(a/2))/(2cos(a/2)(cos(a/2) - sin(a/2)))", "במכנה: 2cos² + 2sin cos נותן (cos + sin), בלי מינוס."), B("2sin(a/2)(sin(a/2) + cos(a/2))/(2sin(a/2)(cos(a/2) + sin(a/2)))", "במכנה מוציאים 2 cos(a/2) כי cos² הוא המחובר הראשון.")]),
      S("מצמצמים 2 ואת הסוגריים (sin + cos).", "sin(a/2)/cos(a/2)", "נכון.", [B("sin(a/2)/(cos(a/2) + sin(a/2))", "הסוגריים מצטמצמים לגמרי."), B("cos(a/2)/sin(a/2)", "ההיפוך.")]),
      S("sin חלקי cos של אותה זווית.", "tan(a/2)", "נכון, וסיימנו.", [B("2tan(a/2)", "אין ה־2."), B("tan(a)", "הזווית היא a/2.")]),
    ],
  },
];

/** All flashcards, one per lesson formula. */
export const CARDS = LESSONS.flatMap((l) => l.formulas.map((f, i) => ({
  id: `${l.id}:${i}`, lessonId: l.id, name: f.name, eq: f.eq,
})));
