// Hebrew titles of the hard-math and algebra-sprint families, kept apart from mathhard.js / sprint.js so that
// engine.js (topic titles and links, needed by the home screen) does not pull those two big modules (and
// fbuilder.js / trig.js behind them) into the first load. tests/lazy-routes.test.mjs checks both tables against
// the real FAMILIES lists.
export const MATHHARD_TITLES = {
  radical: 'משוואות ואי־שוויונות עם שורשים',
  exponent: 'משוואות ואי־שוויונות מעריכיים',
  rational: 'אי־שוויונות רציונליים',
  param: 'משוואות עם פרמטר',
  circle: 'מעגלים ומערכות אנליטיות',
};

export const SPRINT_TITLES = {
  factor: 'פירוק טרינום לגורמים',
  fracsimp: 'צמצום שברים',
  fracadd: 'חיבור וחיסור שברים',
  exprad: 'חזקות ושורשים',
  lineq: 'משוואות לינאריות',
  quadeq: 'משוואות ריבועיות פשוטות',
  rearrange: 'בידוד משתנה בנוסחה',
  ineq: 'אי־שוויונות וסימן',
  loglaw: 'חוקי לוגריתמים',
};

export const sprintFamilyTitle = (id) => SPRINT_TITLES[id] || id;
