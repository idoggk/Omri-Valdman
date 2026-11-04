// Service worker. Bump CACHE_VERSION when the shell list changes.
// All URLs are relative to the SW scope, so it works under /Omri-Valdman/.
const CACHE_VERSION = 'v65';
const CACHE_NAME = 'omri-study-' + CACHE_VERSION;
const BUILD_HASH = '0cdbcbb98e09a60d'; // written by tools/stamp-version.mjs; do not edit by hand

const PRECACHE = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/check.js',
  'js/store.js',
  'js/answersets.js',
  'js/bidi.js',
  'js/eqblocks.js',
  'js/math.js',
  'js/mathtex.js',
  'js/mathdir.js',
  'vendor/katex/katex.min.js',
  'vendor/katex/katex.min.css',
  'vendor/katex/fonts/KaTeX_AMS-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2',
  'vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2',
  'vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Main-Bold.woff2',
  'vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2',
  'vendor/katex/fonts/KaTeX_Main-Italic.woff2',
  'vendor/katex/fonts/KaTeX_Main-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2',
  'vendor/katex/fonts/KaTeX_Math-Italic.woff2',
  'vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  'vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2',
  'vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Script-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Size1-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Size2-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Size3-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Size4-Regular.woff2',
  'vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2',
  'js/progress.js',
  'js/sanitize.js',
  'js/pwa.js',
  'js/runroutes.js',
  'js/clock.js',
  'js/dom.js',
  'js/signkey.js',
  'js/storage.js',
  'js/engine.js',
  'js/exam.js',
  'js/exam-ui.js',
  'js/guided.js',
  'js/examples.js',
  'js/sheet.js',
  'js/srs.js',
  'js/workout.js',
  'js/practice-ui.js',
  'js/drills-ui.js',
  'js/findmistake-ui.js',
  'js/multipart.js',
  'js/trig.js',
  'js/trig-data.js',
  'js/trig-ui.js',
  'js/mathhard.js',
  'js/mathhard-ui.js',
  'js/ceiling.js',
  'js/transfer.js',
  'js/transfer-ui.js',
  'js/recover.js',
  'js/recover-ui.js',
  'js/notebook.js',
  'js/notebook-ui.js',
  'js/writing.js',
  'js/writing-ui.js',
  'js/booklet.js',
  'js/booklet-ui.js',
  'js/replay.js',
  'js/replay-ui.js',
  'js/blind.js',
  'js/blind-ui.js',
  'js/recovery.js',
  'js/recovery-ui.js',
  'js/pressure.js',
  'js/pressure-ui.js',
  'js/fbuilder.js',
  'js/fbuilder-ui.js',
  'js/sprint.js',
  'js/sprint-ui.js',
  'js/units.js',
  'js/units-data.js',
  'js/units-ui.js',
  'js/estimate.js',
  'js/estimate-data.js',
  'js/estimate-ui.js',
  'js/plan.js',
  'js/plan-ui.js',
  'js/tryfirst.js',
  'js/tryfirst-ui.js',
  'js/logs.js',
  'js/logs-ui.js',
  'js/notes.js',
  'js/notes-ui.js',
  'js/derive.js',
  'js/derive-ui.js',
  'js/calibration.js',
  'js/calibration-ui.js',
  'js/journal.js',
  'js/journal-ui.js',
  'js/examday.js',
  'js/examday-ui.js',
  'js/counter.js',
  'js/counter-data.js',
  'js/counter-ui.js',
  'js/summary.js',
  'js/backup.js',
  'js/variants.js',
  'js/endless-ui.js',
  'js/order-ui.js',
  'js/checkpoints-ui.js',
  'js/methods-ui.js',
  'js/edgecases-ui.js',
  'js/reverse-ui.js',
  'js/ladder.js',
  'js/ladder-ui.js',
  'js/fullsolve-ui.js',
  'js/fading-ui.js',
  'js/feedback.js',
  'js/feedback-ui.js',
  'js/skills.js',
  'js/skills-ui.js',
  'js/nav.js',
  'js/hub.js',
  'js/boot.js',
  'js/exercise-view.js',
  'js/routes.js',
  'js/core-views.js',
  'js/backup-lite.js',
  'js/derive-state.js',
  'js/family-titles.js',
  'js/home-data.js',
  'data/drills.json',
  'data/checkpoints.json',
  'data/methods.json',
  'data/edgecases.json',
  'data/reverse.json',
  'data/ladder.json',
  'data/ladder-math.json',
  'data/fading.json',
  'data/skills.json',
  'data/findmistake.json',
  'data/multipart.json',
  'data/transfer.json',
  'data/recover.json',
  'data/writing.json',
  'data/booklet.json',
  'data/recovery-hard.json',
  'data/formula-catalogue.json',
  'data/logs-lessons.json',
  'data/logs-ex-1.json',
  'data/logs-ex-2.json',
  'data/logs-ex-3.json',
  'data/notes.json',
  'data/derive-math.json',
  'data/derive-physics.json',
  'data/mathhard-radical.json',
  'data/mathhard-exponent.json',
  'data/mathhard-rational.json',
  'data/mathhard-param.json',
  'data/mathhard-circle.json',
  'data/math.json',
  'data/physics.json',
  'data/formulas.json',
  'data/examples.json',
  'icons/icon-v3-180.png',
  'icons/icon-v3-192.png',
  'icons/icon-v3-512.png',
  'icons/icon-v3-maskable-512.png',
];

// BEGIN PRECACHE_HASHES (written by tools/stamp-version.mjs; do not edit by hand)
const PRECACHE_HASHES = {
  'index.html': '59b3d89d5aadbfb0b27da1b415212a78',
  'styles.css': '3ed793471f73ca6c8286d6a3fc544611',
  'manifest.webmanifest': '28f87cc0bc065de22d0dd25b8fc8d9cb',
  'js/app.js': '9628521a064d7d90afe05426e477fcfe',
  'js/check.js': 'f205c7bed82b7be3193de064378ccf5a',
  'js/store.js': '4a633cadb227293a430b262f80c73240',
  'js/answersets.js': 'd7b2e681d2c3f4badc8e0a7672e65e48',
  'js/bidi.js': 'e7164f7e23cbe647d71cf8e4fffbfac5',
  'js/eqblocks.js': 'cb139270f123ad44db42d5e38335f241',
  'js/math.js': '0a50c69174ade4736afc1bb0b29ef414',
  'js/mathtex.js': '9b358a01b2635c2c5d582d53252e991c',
  'js/mathdir.js': '7432c1e6e1ce7d190113dedc6c069fe2',
  'vendor/katex/katex.min.js': 'e6bfe5deebd4c7ccd272055bab63bd3a',
  'vendor/katex/katex.min.css': 'f0dbfcc2940b4d788c805c1a1e117e89',
  'vendor/katex/fonts/KaTeX_AMS-Regular.woff2': '0cdd387c9590a1a9f9794560022dbb59',
  'vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2': 'de7701e42cf1f4cf0b766c03fb279772',
  'vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2': '5d53e70ad607c2352162dec9e0923fb5',
  'vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2': '74444efd593c005e3f4573b44524704c',
  'vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2': '51814d270d06ff0255dba0799994fa4d',
  'vendor/katex/fonts/KaTeX_Main-Bold.woff2': '0f60d1b897938ec918c8ce073092411b',
  'vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2': '99cd42a3c072d918f2f44984a807cf7a',
  'vendor/katex/fonts/KaTeX_Main-Italic.woff2': '97479ca6cce906abc961ecac96faa5f9',
  'vendor/katex/fonts/KaTeX_Main-Regular.woff2': 'c2342cd8b869e01752a9321dc17213fc',
  'vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2': 'dc47344dbb6cb5b655c8460d561f4df5',
  'vendor/katex/fonts/KaTeX_Math-Italic.woff2': '7af58c5ec8f132a2ddde9027c6d7814d',
  'vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2': 'e99ae51144bf1232efcc1bfe5add3626',
  'vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2': '00b26ac825e2095056396e0553b8ac26',
  'vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2': '68e8c73ef42afd3ccec58bf0fba302cc',
  'vendor/katex/fonts/KaTeX_Script-Regular.woff2': '036d4e95149b69ff9bcc0cd55771efeb',
  'vendor/katex/fonts/KaTeX_Size1-Regular.woff2': '6b47c40166b6dbe21a5dfca7718413f2',
  'vendor/katex/fonts/KaTeX_Size2-Regular.woff2': 'd04c54219f9eaec6d4d4fd42dfb28785',
  'vendor/katex/fonts/KaTeX_Size3-Regular.woff2': '73d591271b1604960cb10bb90fee0216',
  'vendor/katex/fonts/KaTeX_Size4-Regular.woff2': 'a4af7d414440a1c1790825cfb700cf9c',
  'vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2': '71d517d67827787cfabdf186914cc335',
  'js/progress.js': '849a210e71b3d25db7569fd1cabf3295',
  'js/sanitize.js': 'da1e31cbcc99132688f0121cbb66d92f',
  'js/pwa.js': '494e0d00f759df76ffbf0d576bcbc7f5',
  'js/runroutes.js': 'f373864f446c2941a986b37aff778ec1',
  'js/clock.js': 'e42f0d1efdd266bc8c422090d0f5c0b4',
  'js/dom.js': '837bd95deab6127a7d0356a44b52b076',
  'js/signkey.js': 'a77b0fa2a8a9e0ec7d0785826d2c9948',
  'js/storage.js': '50ad718a976db0d124e4ab32ef1300d3',
  'js/engine.js': 'c8e709d10449d77e637f23527de23c92',
  'js/exam.js': 'd61986c8d77383cf78ec5e5aa2becbbf',
  'js/exam-ui.js': '9e684140ea327ef692a3d5c127ccba23',
  'js/guided.js': '6b9ae7bec5e832b2a28c44d11cd4c853',
  'js/examples.js': '4d007d7eb0ed1ad019afc951cb885464',
  'js/sheet.js': 'ba14d4d768ca77ad92f586e3f23dd979',
  'js/srs.js': '4bb3977bd9dac1fdd167c7e14dd70fda',
  'js/workout.js': '4815899282e11ddc6946e3c72f00e6a2',
  'js/practice-ui.js': '1effb2a28889099fa459b4091b04a384',
  'js/drills-ui.js': '43ce027e06db08fd9f2debb61c26b772',
  'js/findmistake-ui.js': '25ce3922390981d3330edeb25cd715f0',
  'js/multipart.js': '2811340ee94531540c667eee20682bfc',
  'js/trig.js': 'bd35c3cb79c0b9c5a19fbbd32ca22c49',
  'js/trig-data.js': 'ea94b091b61ae049770a26774197c91e',
  'js/trig-ui.js': '745b1519dd4c5f0e8823cb6e46114754',
  'js/mathhard.js': '5f3d2c4868778bfa8e2c4f3b11f68e83',
  'js/mathhard-ui.js': '0e5051ee9a99107421ef3b6761295783',
  'js/ceiling.js': 'afaec432aeb2080ffa252387957dbca5',
  'js/transfer.js': '660bfa8121bf5a27489a51e8d8a9030d',
  'js/transfer-ui.js': '52c179d1ffece2b4a06c816fa74805be',
  'js/recover.js': '2ae84e74bd84b5ff5a2fb99a77b9db18',
  'js/recover-ui.js': 'fdba3f9263a1a56fcfa7ee2569604c80',
  'js/notebook.js': '3cbd9c4a408234c64162deb05f291e62',
  'js/notebook-ui.js': '0606cddaece90f68753e7c6121f5afb4',
  'js/writing.js': 'bdde55fd808aed49fc6b0b8fda633cf9',
  'js/writing-ui.js': 'd75174ad952aeb3cf745f3c7dafefe22',
  'js/booklet.js': '92ced86513a9206188dc468a0f6b35b0',
  'js/booklet-ui.js': '900576a37a40022a769eb1b1d822989a',
  'js/replay.js': '20ee3bcbdbf7a4f2874852b27d6a332e',
  'js/replay-ui.js': 'fb382c5ab91b6780179190295a595fd9',
  'js/blind.js': '451fe6c82183332e04fa48d58f161ac1',
  'js/blind-ui.js': '3ee5acc6a95ed4a51ade432cdaec3130',
  'js/recovery.js': 'd4cc534f092fdebe6e5ef869e3f24b6f',
  'js/recovery-ui.js': '92f9c453d2c515bc4cb664980d1a0db0',
  'js/pressure.js': 'b2a7d2e23d32525ea3eec16086990b9e',
  'js/pressure-ui.js': '9562957244c6e861514de0d877247552',
  'js/fbuilder.js': 'b37bbc6361480a2b990a5edc417e6662',
  'js/fbuilder-ui.js': 'fb0804dadf4900aefa1fa23fe9f36b42',
  'js/sprint.js': '79cade6854765754c754d4df7b4ac10d',
  'js/sprint-ui.js': '6614d25035df07e632e744cc036560c5',
  'js/units.js': 'f55d81dccb532285160327ca3f15df9f',
  'js/units-data.js': '2b8068df9f6fed8b24e4c74bc1b85688',
  'js/units-ui.js': '02097d7aafbb28644085c064ab630bfc',
  'js/estimate.js': '471c1a60aced1d18641b837550c6f2b7',
  'js/estimate-data.js': 'a0f875b882718e6182f1163ea50f1d8e',
  'js/estimate-ui.js': '8c74e8e84ddf71907f8adaa9e2d7d51a',
  'js/plan.js': '4563c0a32404ca3a5d7e3233d1fb74a3',
  'js/plan-ui.js': '517918d7e28d4c59a877d5be61e4cb6a',
  'js/tryfirst.js': 'a21f94388ce24e46b94dbc6dbcdbedd1',
  'js/tryfirst-ui.js': 'e67d0c64637d3b70bc3e771a0e045698',
  'js/logs.js': 'b4f3f7e3cde11596ebd5f2a4ed67d9dc',
  'js/logs-ui.js': 'ed72c4f6d40fae5b344f32659e167b95',
  'js/notes.js': 'd9cc90a47d05de4b7f77f4bff1da2894',
  'js/notes-ui.js': '52eb1af6208ff743ec3affe9cee558aa',
  'js/derive.js': 'ec2f63c5de17e0ed3ba7cb5f2c617960',
  'js/derive-ui.js': 'ca2e6f2cb633d09461243d5bc5705f2f',
  'js/calibration.js': 'd9f6060ac6434cb6e4fa04f033589dc8',
  'js/calibration-ui.js': '5fc9d518a89d485c4a900cc2d9c96399',
  'js/journal.js': 'e2dc4c970dd2836e564c93b45c8887b1',
  'js/journal-ui.js': '16d77533ea92beb28c6fe6e47b93fdb2',
  'js/examday.js': 'eec61bef400ab3176b3ed95a0dc0cb75',
  'js/examday-ui.js': '61490bf3d68b7c534ea306c97c50c650',
  'js/counter.js': 'd12c578f65b75fc11994bccda3b9b225',
  'js/counter-data.js': '24f2f015f23781b63a2350b0f88a7e67',
  'js/counter-ui.js': '6558850692ded1fd4894c6a931b2e0c4',
  'js/summary.js': '3abb7bcd769ff42972ce296520fac57b',
  'js/backup.js': '71f1b6356bd391a9083da899d33754ae',
  'js/variants.js': '2b82da750ef1541838b35d7c7ffb511f',
  'js/endless-ui.js': '32cf6bd04637b312f8d3b7aedf40b5d9',
  'js/order-ui.js': '4d82d001579a59036575ad710f3b35e9',
  'js/checkpoints-ui.js': '141a277796e9f1240fe06b90f6028f4c',
  'js/methods-ui.js': 'be9275d057c083cc5bfcd3edf2ef22c1',
  'js/edgecases-ui.js': '5c638d985993645aa5e4f69ac1478ba8',
  'js/reverse-ui.js': 'f1d431a272ad757ba2a6cbe4501d3396',
  'js/ladder.js': 'd48a139b22eb0d3577632f811c60b17e',
  'js/ladder-ui.js': '391b183b44da4366917c331da0c57c4f',
  'js/fullsolve-ui.js': 'd8af18ea89eee78163df2d3b972708b1',
  'js/fading-ui.js': 'faa195f311b9a0a2717cf39b4390745b',
  'js/feedback.js': '675fcc5281ef32594611c6b7fd29940a',
  'js/feedback-ui.js': '07733779836fe78dc20a372a9a481e7e',
  'js/skills.js': '1360d03b35228dcd7e34dbf4c4903940',
  'js/skills-ui.js': 'd41ec4d5ad8c35186e16de1333544d30',
  'js/nav.js': '8afa99cc87063f83f0bd6cccb9166c1c',
  'js/hub.js': '2ee320e863873ba6da65f3dece4a430f',
  'js/boot.js': '6f00d468a80ea200db02ef06df499704',
  'js/exercise-view.js': 'edb0a407fc97a493a159c7e744428be0',
  'js/routes.js': '0605cba15c06ed35fdf16f17543b047e',
  'js/core-views.js': 'f810a70b979075ce794cd8ab12a55c73',
  'js/backup-lite.js': '2a0161c579083697c38339abfc465bc4',
  'js/derive-state.js': '266921c3caca00c90888865a56918848',
  'js/family-titles.js': '08b4cbc979d68f771fa83718b490e674',
  'js/home-data.js': 'fab1d0470499ed8ffb06fea8c37efe88',
  'data/drills.json': '617ff1bbae52aac5934cbfb93ab67168',
  'data/checkpoints.json': 'ec3a773f8a9cac71b7f105b7c6b62e67',
  'data/methods.json': '7d6a43c89982537f25a390fdee632a22',
  'data/edgecases.json': 'fa50c73ae8134c0595de9c24a336b6c8',
  'data/reverse.json': '5cc7b1c19c6df465efe258614bc23926',
  'data/ladder.json': 'fb0c0c4a392f8fdd7576797604117c06',
  'data/ladder-math.json': '80cfcce52d993d3d5e2649cc30a510fb',
  'data/fading.json': '467bee8f348ed0cfc544a2fbce5814f2',
  'data/skills.json': 'c0c77ea290e56da113f84906a9d74235',
  'data/findmistake.json': '44a7262cb7049a5de99aa77a792679c4',
  'data/multipart.json': '8cdd1a764ca8650883ad1648fb8b22d7',
  'data/transfer.json': 'c2c8b3f77838ee71680ace44c619ae6b',
  'data/recover.json': 'ce2442d6a739243ec81d035ba02793e9',
  'data/writing.json': 'cf93034f9d7fbfabc41a29c526a8727c',
  'data/booklet.json': 'e55d2a8b2f2823203d781bd02300f809',
  'data/recovery-hard.json': '348ad39925701a0f8f276fb7b2b34951',
  'data/formula-catalogue.json': 'b6f348cf401b85ad686fc9940b5a1232',
  'data/logs-lessons.json': '1d41f3e7bd1faea178d93f45a284bf3a',
  'data/logs-ex-1.json': '3d44f698620eed4629b019443fdc6bc3',
  'data/logs-ex-2.json': 'cc4ea2b0e8ce9fdacb76e61df80b9861',
  'data/logs-ex-3.json': '586562d10a16715705abbb21475f38b7',
  'data/notes.json': 'd6eeb80318b0e37e5fcc3d5327727648',
  'data/derive-math.json': 'e2991fce821071d0a75be9dbae9edd47',
  'data/derive-physics.json': 'a4b6b313d9f28adceb1fc21d05bca2ce',
  'data/mathhard-radical.json': 'c2ab97af30db542f87b17d7a25e8bc01',
  'data/mathhard-exponent.json': '36dc180d6e8fb5348dd9ed93dae3070a',
  'data/mathhard-rational.json': '6936283f0b03100a9fcac8fac9f28fac',
  'data/mathhard-param.json': 'e0843ee0f98f17779cbc0877cb762c32',
  'data/mathhard-circle.json': '7b9cff8a2dc2e6b2dd6eae120cdcadba',
  'data/math.json': '2d5038abb5499c544c0ce7d0be6910ba',
  'data/physics.json': 'c185e2816408b3d884cb2ad71513e0a9',
  'data/formulas.json': '9cb5bf27cb96a8e581d2352c626cd782',
  'data/examples.json': '0523795560da72fcd9dfd762a9ae5fac',
  'icons/icon-v3-180.png': '26c20f9269d54c4ea063007ab705d537',
  'icons/icon-v3-192.png': '8a92f0e76fbccace13b6ab7283ed601b',
  'icons/icon-v3-512.png': '26013597c079a81a45c2bd61287c0117',
  'icons/icon-v3-maskable-512.png': '21f06573dac77ae1e3f7e0b2f680f613',
};
// END PRECACHE_HASHES

// Fetches one shell file, retrying once. Resolves true when it is stored in `cache`.
async function precacheEntry(cache, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (res && res.ok) { await cache.put(url, res); return true; }
    } catch (err) { /* retried once below */ }
  }
  return false;
}

// Copies a file from the newest previous omri-study-* cache that has it (last resort when the network fails).
async function copyFromOldCaches(cache, url, oldNames) {
  for (const name of oldNames) {
    try {
      const old = await caches.open(name);
      const hit = await old.match(url);
      if (hit) { await cache.put(url, hit); return true; }
    } catch (err) { /* try the next old cache */ }
  }
  return false;
}

// Delta install. Every cache stores the hash manifest it was installed with under MANIFEST_KEY. A file whose hash is
// unchanged since the newest previous cache that recorded one is copied from there, but only after its stored bytes
// hash to the manifest value (a corrupted or truncated old entry is downloaded again). No manifest -> full download.
const MANIFEST_KEY = '__precache-manifest__';
const hashKey = (u) => (u === './' ? 'index.html' : u);
const TEXT_FILE = /\.(js|json|css|html|webmanifest)$/;

async function sha256Of(res, url) {
  let buf = await res.arrayBuffer();
  if (TEXT_FILE.test(url)) buf = new TextEncoder().encode(new TextDecoder().decode(buf).replace(/\r\n/g, '\n'));
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function previousManifest(oldNames) {
  for (const name of oldNames) {
    try {
      const hit = await (await caches.open(name)).match(MANIFEST_KEY);
      if (hit) return { name, manifest: JSON.parse(await hit.text()) };
    } catch (err) { /* damaged or missing: try the next old cache */ }
  }
  return null;
}

async function copyUnchanged(cache, url, prev) {
  const want = PRECACHE_HASHES[hashKey(url)];
  if (!prev || !want || prev.manifest[hashKey(url)] !== want) return false;
  try {
    const hit = await (await caches.open(prev.name)).match(url);
    if (!hit || !hit.ok || (await sha256Of(hit.clone(), hashKey(url))) !== want) return false;
    await cache.put(url, hit);
    return true;
  } catch (err) { return false; }
}

// Atomic install: either every shell file is in the new cache (fetched, or carried over from the previous
// version) or install rejects, so the old worker and its cache keep serving. Old caches are only deleted in
// activate, which never runs after a rejected install.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const versionOf = (k) => Number(k.slice('omri-study-'.length).replace(/\D/g, '')) || 0;
    const oldNames = (await caches.keys())
      .filter((k) => k.startsWith('omri-study-') && k !== CACHE_NAME)
      .sort((a, b) => versionOf(b) - versionOf(a));
    let prev = null;
    try { prev = await previousManifest(oldNames); } catch (err) { /* full download */ }
    const results = await Promise.allSettled(PRECACHE.map(async (u) =>
      (await copyUnchanged(cache, u, prev)) || (await precacheEntry(cache, u)) || (await copyFromOldCaches(cache, u, oldNames))));
    const missing = PRECACHE.filter((u, i) => !(results[i].status === 'fulfilled' && results[i].value));
    if (missing.length) {
      try { await caches.delete(CACHE_NAME); } catch (err) { /* partial cache is harmless */ }
      throw new Error('precache incomplete: ' + missing.join(', '));
    }
    // Recorded last: a cache without it is never used as a delta source.
    try { await cache.put(MANIFEST_KEY, new Response(JSON.stringify(PRECACHE_HASHES))); } catch (err) { /* next update downloads everything */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('omri-study-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Online visits get the newest files; a slow or dead network falls back to the cache after this long.
// Shell assets (js, css, fonts, icons, html) are precached, so they give up quickly; data JSON waits longer.
const STATIC_TIMEOUT_MS = 1500;
const NETWORK_TIMEOUT_MS = 4000;
const timeoutFor = (url) => (/\.json$/.test(url.pathname) ? NETWORK_TIMEOUT_MS : STATIC_TIMEOUT_MS);

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  const net = fetch(request, { cache: 'no-cache' }).then((res) => {
    if (res && res.status === 200) { // only a plain 200 may replace the cached copy (never 404/5xx/opaque)
      const saving = Promise.resolve(cache.put(request, res.clone())).catch(() => {});
      if (event && typeof event.waitUntil === 'function') event.waitUntil(saving);
    }
    return res;
  });
  if (!cached) {
    try { return await net; } catch (err) {
      if (request.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  }
  net.catch(() => {});
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(cached), timeoutFor(new URL(request.url))); });
  try {
    const res = await Promise.race([net, timeout]);
    return res && res.ok ? res : cached; // a failed response never hides a good cached copy
  } catch (err) {
    return cached;
  } finally { clearTimeout(timer); }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // html, css, js, json, manifest, icons: fresh when online, cached only when offline
  event.respondWith(networkFirst(req, event));
});
