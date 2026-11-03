// The 20 false claims of #/counter (counterexample challenge). Each task is a claim that is NOT true in general.
// The student types numbers for the variables; the task's numeric predicates decide:
//   domain(v)  the values are inside the claim's domain (every expression defined, every hypothesis satisfied)
//   holds(v)   the claim is true at these values (then they are NOT a counterexample)
// A counterexample = domain(v) && !holds(v). tools/verify-counter.mjs checks that every claim has counterexamples, that the
// declared witness works, and that holds-values and out-of-domain values are rejected. Angles are in degrees.
const EPS = 1e-9;
const near = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= EPS * Math.max(1, Math.abs(x), Math.abs(y));
const fin = (...xs) => xs.every(Number.isFinite);
const rad = (d) => (d * Math.PI) / 180;
const nz = (x) => Math.abs(x) > 1e-12;

const V = (id, label) => ({ id, label });

export const TASKS = [
  {
    id: 'ce-01', title: 'העלאה בריבוע ושקילות', eq: 'a² = b²  ⟹  a = b',
    claim: 'אם מעלים בריבוע שני צדדים של משוואה מקבלים משוואה שקולה: מ־a² = b² נובע ש־a = b.',
    vars: [V('a', 'a'), V('b', 'b')], domainText: 'המספרים צריכים לקיים a² = b² (זו ההנחה בטענה).',
    domain: ({ a, b }) => fin(a, b) && near(a * a, b * b), holds: ({ a, b }) => near(a, b), witness: { a: 3, b: -3 },
    why: 'ריבוע "מוחק" את הסימן: 3 ו־(−3) נותנים אותו ריבוע, אבל הם לא שווים. לכן העלאה בריבוע יכולה להוסיף פתרונות.',
    correct: 'a² = b²  ⟺  a = b או a = −b. ובכיוון ההפוך: a = b  ⟹  a² = b². ',
  },
  {
    id: 'ce-02', title: 'חילוק במשתנה', eq: 'x² = 3x  ⟹  x = 3',
    claim: 'במשוואה x² = 3x אפשר תמיד לחלק את שני הצדדים ב־x, ולכן הפתרון היחיד הוא x = 3.',
    vars: [V('x', 'x')], domainText: 'x צריך לפתור את המשוואה x² = 3x.',
    domain: ({ x }) => fin(x) && near(x * x, 3 * x), holds: ({ x }) => near(x, 3), witness: { x: 0 },
    why: 'ב־x = 0 שני הצדדים שווים ל־0, אבל חילוק ב־x אסור כשהוא מתאפס, ולכן הפתרון הזה "הלך לאיבוד".',
    correct: 'מעבירים אגף ופורקים: x(x − 3) = 0, ולכן x = 0 או x = 3. מחלקים במשתנה רק אחרי שמוודאים שהוא שונה מאפס, ובודקים בנפרד את המקרה שהוא אפס.',
  },
  {
    id: 'ce-03', title: 'לוגריתם של סכום', eq: 'log(a + b) = log a + log b',
    claim: 'הלוגריתם של סכום שווה לסכום הלוגריתמים.',
    vars: [V('a', 'a'), V('b', 'b')], domainText: 'a ו־b חיוביים (אחרת הלוגריתם לא מוגדר).',
    domain: ({ a, b }) => fin(a, b) && a > 0 && b > 0, holds: ({ a, b }) => near(Math.log(a + b), Math.log(a) + Math.log(b)), witness: { a: 1, b: 1 },
    why: 'ב־a = b = 1: log 2 ≈ 0.69 אבל log 1 + log 1 = 0. הכלל האמיתי הוא על כפל: לוגריתם הופך מכפלה לסכום.',
    correct: 'log(a·b) = log a + log b  (עבור a, b > 0). לסכום בתוך הלוגריתם אין כלל פירוק.',
  },
  {
    id: 'ce-04', title: 'שורש של ריבוע', eq: '√(a²) = a',
    claim: 'השורש הריבועי של a² תמיד שווה ל־a.',
    vars: [V('a', 'a')], domainText: 'כל מספר ממשי a.',
    domain: ({ a }) => fin(a), holds: ({ a }) => near(Math.sqrt(a * a), a), witness: { a: -3 },
    why: 'שורש ריבועי הוא תמיד אי־שלילי. √((−3)²) = √9 = 3 ולא −3.',
    correct: '√(a²) = |a|.  בלי ערך מוחלט אפשר לכתוב a רק כש־a ≥ 0.',
  },
  {
    id: 'ce-05', title: 'ריבוע ואי־שוויון', eq: 'a > b  ⟹  a² > b²',
    claim: 'אם a גדול מ־b אז גם a² גדול מ־b².',
    vars: [V('a', 'a'), V('b', 'b')], domainText: 'המספרים צריכים לקיים a > b.',
    domain: ({ a, b }) => fin(a, b) && a > b, holds: ({ a, b }) => a * a > b * b, witness: { a: 1, b: -2 },
    why: 'ב־a = 1 ו־b = −2: 1 > −2 אבל 1 < 4. כשיש מספרים שליליים הריבוע הופך את הסדר.',
    correct: 'אם a > b ≥ 0 אז a² > b². בלי ההנחה ששניהם אי־שליליים צריך לבדוק סימנים, או להשוות |a| ו־|b|.',
  },
  {
    id: 'ce-06', title: 'כפל של שני אי־שוויונות', eq: 'a < b  ו־  c < d  ⟹  a·c < b·d',
    claim: 'אפשר לכפול שני אי־שוויונות באותו כיוון, אגף באגף.',
    vars: [V('a', 'a'), V('b', 'b'), V('c', 'c'), V('d', 'd')], domainText: 'המספרים צריכים לקיים a < b וגם c < d.',
    domain: ({ a, b, c, d }) => fin(a, b, c, d) && a < b && c < d, holds: ({ a, b, c, d }) => a * c < b * d, witness: { a: -3, b: -2, c: 1, d: 5 },
    why: 'ב־a = −3, b = −2, c = 1, d = 5: a·c = −3 ו־b·d = −10, ו־−3 אינו קטן מ־−10. כפל אגף באגף עובד רק כשהכול חיובי.',
    correct: 'אם 0 < a < b ו־0 < c < d אז a·c < b·d. חיבור אגף באגף תמיד מותר: a + c < b + d.',
  },
  {
    id: 'ce-07', title: 'צמצום גורם באי־שוויון', eq: 'a·c < b·c  ⟹  a < b',
    claim: 'אם יש גורם משותף בשני צדדים של אי־שוויון אפשר לצמצם אותו בלי לשנות את האי־שוויון.',
    vars: [V('a', 'a'), V('b', 'b'), V('c', 'c')], domainText: 'המספרים צריכים לקיים a·c < b·c.',
    domain: ({ a, b, c }) => fin(a, b, c) && a * c < b * c, holds: ({ a, b }) => a < b, witness: { a: 3, b: 2, c: -1 },
    why: 'ב־c = −1, a = 3, b = 2: a·c = −3 קטן מ־b·c = −2, אבל a = 3 אינו קטן מ־b = 2. חילוק במספר שלילי הופך את כיוון האי־שוויון.',
    correct: 'אם c > 0: a·c < b·c  ⟺  a < b.   אם c < 0: a·c < b·c  ⟺  a > b.',
  },
  {
    id: 'ce-08', title: 'סינוס של סכום זוויות', eq: 'sin(a + b) = sin a + sin b',
    claim: 'הסינוס של סכום זוויות שווה לסכום הסינוסים (זוויות במעלות).',
    vars: [V('a', 'a (במעלות)'), V('b', 'b (במעלות)')], domainText: 'כל זוג זוויות, במעלות.',
    domain: ({ a, b }) => fin(a, b), holds: ({ a, b }) => near(Math.sin(rad(a + b)), Math.sin(rad(a)) + Math.sin(rad(b))), witness: { a: 90, b: 90 },
    why: 'ב־a = b = 90°: sin 180° = 0 אבל sin 90° + sin 90° = 2. הסינוס אינו פונקציה לינארית.',
    correct: 'sin(a + b) = sin a·cos b + cos a·sin b.',
  },
  {
    id: 'ce-09', title: 'סימן של שבר באי־שוויון', eq: '(x − 3)/(x + 1) ≥ 0  ⟹  x − 3 ≥ 0',
    claim: 'אם המנה אי־שלילית אז בהכרח גם המונה אי־שלילי, ולכן אפשר להתעלם מהמכנה.',
    vars: [V('x', 'x')], domainText: 'x ≠ −1, והשבר (x − 3)/(x + 1) צריך להיות ≥ 0.',
    domain: ({ x }) => fin(x) && nz(x + 1) && (x - 3) / (x + 1) >= 0, holds: ({ x }) => x - 3 >= 0, witness: { x: -5 },
    why: 'ב־x = −5: המונה −8 והמכנה −4, והמנה 2 חיובית. המונה שלילי אבל גם המכנה שלילי, וצריך לבדוק את הסימנים של שניהם.',
    correct: '(x − 3)/(x + 1) ≥ 0  ⟺  x < −1 או x ≥ 3.  קובעים סימן לכל גורם בנפרד ובודקים תחום הגדרה (x ≠ −1).',
  },
  {
    id: 'ce-10', title: 'מהירות ממוצעת בתאוצה משתנה', eq: 'v(t) = v₀ + k·t²  ⟹  מהירות ממוצעת על [0, T] = (v(0) + v(T))/2',
    claim: 'המהירות הממוצעת בין שני רגעים היא תמיד ממוצע המהירויות ההתחלתית והסופית.',
    vars: [V('v0', 'v₀ (מ/ש)'), V('k', 'k (מ/ש³)'), V('T', 'T (ש)')], domainText: 'T חיובי, והמהירות היא v(t) = v₀ + k·t² (תאוצה שמשתנה בזמן).',
    // average of v over [0,T] is v0 + k T²/3; the endpoint mean is v0 + k T²/2
    domain: ({ v0, k, T }) => fin(v0, k, T) && T > 0, holds: ({ v0, k, T }) => near(v0 + (k * T * T) / 3, v0 + (k * T * T) / 2), witness: { v0: 0, k: 3, T: 2 },
    why: 'ב־v₀ = 0, k = 3, T = 2: הדרך היא ∫3t²dt = 8 מ׳ ב־2 שניות, מהירות ממוצעת 4 מ/ש, אבל (0 + 12)/2 = 6 מ/ש.',
    correct: 'v_ממוצע = (v₀ + v)/2 נכון רק כשהתאוצה קבועה. בכלל: v_ממוצע = (הדרך הכוללת)/(הזמן הכולל).',
  },
  {
    id: 'ce-11', title: 'ריבוע של סכום', eq: '(a + b)² = a² + b²',
    claim: 'הריבוע של סכום שווה לסכום הריבועים.',
    vars: [V('a', 'a'), V('b', 'b')], domainText: 'כל זוג מספרים ממשיים.',
    domain: ({ a, b }) => fin(a, b), holds: ({ a, b }) => near((a + b) ** 2, a * a + b * b), witness: { a: 1, b: 1 },
    why: 'ב־a = b = 1: (1 + 1)² = 4 אבל 1 + 1 = 2. חסר האיבר 2ab.',
    correct: '(a + b)² = a² + 2ab + b².',
  },
  {
    id: 'ce-12', title: 'שורש של סכום', eq: '√(a + b) = √a + √b',
    claim: 'השורש של סכום שווה לסכום השורשים.',
    vars: [V('a', 'a'), V('b', 'b')], domainText: 'a ≥ 0 ו־b ≥ 0 (כדי ששלושת השורשים יהיו מוגדרים).',
    domain: ({ a, b }) => fin(a, b) && a >= 0 && b >= 0, holds: ({ a, b }) => near(Math.sqrt(a + b), Math.sqrt(a) + Math.sqrt(b)), witness: { a: 4, b: 9 },
    why: 'ב־a = 4, b = 9: √13 ≈ 3.61 אבל √4 + √9 = 5.',
    correct: '√(a·b) = √a·√b עבור a, b ≥ 0. לסכום אין כלל כזה: (√a + √b)² = a + b + 2√(ab).',
  },
  {
    id: 'ce-13', title: 'הופכי של סכום', eq: '1/(a + b) = 1/a + 1/b',
    claim: 'ההופכי של סכום שווה לסכום ההופכיים.',
    vars: [V('a', 'a'), V('b', 'b')], domainText: 'a ≠ 0, b ≠ 0 ו־a + b ≠ 0.',
    domain: ({ a, b }) => fin(a, b) && nz(a) && nz(b) && nz(a + b), holds: ({ a, b }) => near(1 / (a + b), 1 / a + 1 / b), witness: { a: 2, b: 2 }, alwaysFalse: true,
    why: 'ב־a = b = 2: 1/4 אבל 1/2 + 1/2 = 1. אפילו אין זוג ממשי שעבורו זה מתקיים: השוויון שקול ל־a² + ab + b² = 0.',
    correct: '1/a + 1/b = (a + b)/(a·b). כדי לחבר שברים מביאים למכנה משותף.',
  },
  {
    id: 'ce-14', title: 'היפוך אי־שוויון בהופכי', eq: 'x > y  ⟹  1/x < 1/y',
    claim: 'אם x גדול מ־y אז ההופכי של x קטן מההופכי של y.',
    vars: [V('x', 'x'), V('y', 'y')], domainText: 'x > y, וגם x ≠ 0 ו־y ≠ 0.',
    domain: ({ x, y }) => fin(x, y) && x > y && nz(x) && nz(y), holds: ({ x, y }) => 1 / x < 1 / y, witness: { x: 2, y: -3 },
    why: 'ב־x = 2 ו־y = −3: 1/2 חיובי ו־−1/3 שלילי, ולכן 1/x גדול מ־1/y. ההיפוך נכון רק כששניהם חיוביים (או שניהם שליליים).',
    correct: 'אם x > y > 0 אז 1/x < 1/y. כך גם אם 0 > x > y. כשהסימנים שונים ההופכי של החיובי חיובי וההופכי של השלילי שלילי.',
  },
  {
    id: 'ce-15', title: 'ערך מוחלט של סכום', eq: '|a + b| = |a| + |b|',
    claim: 'הערך המוחלט של סכום שווה לסכום הערכים המוחלטים.',
    vars: [V('a', 'a'), V('b', 'b')], domainText: 'כל זוג מספרים ממשיים.',
    domain: ({ a, b }) => fin(a, b), holds: ({ a, b }) => near(Math.abs(a + b), Math.abs(a) + Math.abs(b)), witness: { a: 3, b: -1 },
    why: 'ב־a = 3, b = −1: |2| = 2 אבל 3 + 1 = 4. כשהסימנים שונים יש "ביטול" בסכום.',
    correct: '|a + b| ≤ |a| + |b| (אי־שוויון המשולש), ושוויון רק כש־a ו־b באותו סימן (או שאחד מהם 0).',
  },
  {
    id: 'ce-16', title: 'לוגריתם של ריבוע', eq: 'ln(x²) = 2·ln x',
    claim: 'לכל x שונה מאפס מתקיים ln(x²) = 2·ln x.',
    vars: [V('x', 'x')], domainText: 'x ≠ 0. מספרים שעבורם אחד הצדדים לא מוגדר נחשבים דוגמה נגדית.',
    domain: ({ x }) => fin(x) && nz(x), holds: ({ x }) => x > 0 && near(Math.log(x * x), 2 * Math.log(x)), witness: { x: -3 },
    why: 'ב־x = −3 האגף השמאלי ln 9 מוגדר, אבל ln(−3) בצד ימין לא מוגדר. הכלל נכון רק עבור x > 0.',
    correct: 'ln(x²) = 2·ln|x| לכל x ≠ 0.  הכלל 2·ln x מותר רק כש־x > 0.',
  },
  {
    id: 'ce-17', title: 'חיבור שברים', eq: 'a/b + c/d = (a + c)/(b + d)',
    claim: 'כדי לחבר שני שברים מחברים מונה למונה ומכנה למכנה.',
    vars: [V('a', 'a'), V('b', 'b'), V('c', 'c'), V('d', 'd')], domainText: 'b ≠ 0, d ≠ 0 ו־b + d ≠ 0.',
    domain: ({ a, b, c, d }) => fin(a, b, c, d) && nz(b) && nz(d) && nz(b + d), holds: ({ a, b, c, d }) => near(a / b + c / d, (a + c) / (b + d)), witness: { a: 1, b: 2, c: 1, d: 3 },
    why: 'ב־1/2 + 1/3: התוצאה האמיתית 5/6, אבל הנוסחה נותנת 2/5. אפשר לבדוק גם שחצי ועוד שליש הוא יותר מחצי, ו־2/5 קטן מחצי.',
    correct: 'a/b + c/d = (a·d + b·c)/(b·d).',
  },
  {
    id: 'ce-18', title: 'ריבוע גדול מ־4', eq: 'x² > 4  ⟹  x > 2',
    claim: 'אם הריבוע של x גדול מ־4 אז x גדול מ־2.',
    vars: [V('x', 'x')], domainText: 'x צריך לקיים x² > 4.',
    domain: ({ x }) => fin(x) && x * x > 4, holds: ({ x }) => x > 2, witness: { x: -3 },
    why: 'ב־x = −3: x² = 9 > 4, אבל −3 אינו גדול מ־2. פתרון אי־שוויון ריבועי נותן שני קטעים.',
    correct: 'x² > 4  ⟺  |x| > 2  ⟺  x < −2 או x > 2.',
  },
  {
    id: 'ce-19', title: 'מהירות ממוצעת בהלוך וחזור', eq: 'אותו מרחק במהירויות v₁ ו־v₂  ⟹  v_ממוצע = (v₁ + v₂)/2',
    claim: 'נוסעים מרחק מסוים במהירות v₁ ובחזרה אותו מרחק במהירות v₂: המהירות הממוצעת בכל הדרך היא ממוצע שתי המהירויות.',
    vars: [V('v1', 'v₁ (קמ״ש)'), V('v2', 'v₂ (קמ״ש)')], domainText: 'שתי המהירויות חיוביות.',
    // total distance 2s over time s/v1 + s/v2: average = 2 v1 v2 / (v1 + v2)
    domain: ({ v1, v2 }) => fin(v1, v2) && v1 > 0 && v2 > 0, holds: ({ v1, v2 }) => near((2 * v1 * v2) / (v1 + v2), (v1 + v2) / 2), witness: { v1: 40, v2: 60 },
    why: 'ב־40 קמ״ש ו־60 קמ״ש: בכל קילומטר עם 40 קמ״ש מבלים יותר זמן. המהירות הממוצעת האמיתית 48 קמ״ש ולא 50.',
    correct: 'v_ממוצע = (הדרך הכוללת)/(הזמן הכולל) = 2·v₁·v₂/(v₁ + v₂) (ממוצע הרמוני) כשהמרחקים שווים.',
  },
  {
    id: 'ce-20', title: 'דרך עצירה ומהירות', eq: 'd = v²/(2a)  ⟹  d(v₂)/d(v₁) = v₂/v₁',
    claim: 'אם מכפילים את מהירות הרכב לפני בלימה (בתאוצת בלימה קבועה), גם דרך העצירה מוכפלת: דרך העצירה פרופורציונית למהירות.',
    vars: [V('v1', 'v₁ (מ/ש)'), V('v2', 'v₂ (מ/ש)')], domainText: 'שתי המהירויות חיוביות, תאוצת הבלימה קבועה וזהה בשני המקרים.',
    domain: ({ v1, v2 }) => fin(v1, v2) && v1 > 0 && v2 > 0, holds: ({ v1, v2 }) => near((v2 * v2) / (v1 * v1), v2 / v1), witness: { v1: 10, v2: 20 },
    why: 'ב־10 מ/ש ו־20 מ/ש: דרך העצירה היא v²/(2a), לכן היחס בין הדרכים הוא 4 ולא 2. דרך העצירה פרופורציונית לריבוע המהירות.',
    correct: 'd = v²/(2a). הכפלת המהירות פי 2 מכפילה את דרך העצירה פי 4.',
  },
];

export const byId = (id) => TASKS.find((t) => t.id === id) || null;
