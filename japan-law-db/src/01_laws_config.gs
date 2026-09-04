/**
 * @file 01_laws_config.gs
 * 同期対象の法令カタログ（データのみ）。
 *
 * 法令を追加・削除する場合、**このファイルだけ**を編集すればよい。
 * 他のソースコードを変更する必要はない。
 *
 * 各エントリの項目
 * ----------------
 * category        : CONFIG.CATEGORIES のキー（'tax' | 'social_insurance' |
 *                   'labor_insurance' | 'related'）
 * name            : 検索に使う法令名。e-Gov上の正式名称と異なる場合は、
 *                   同期時にe-Gov側の正式名称が採用され officialName に記録される。
 * expectedLawType : 期待する法令種別（CONFIG.LAW_TYPE_DEFS のキー）。
 *                   検索結果の絞り込みと誤取得防止に使う。
 * enabled         : false にすると同期対象から外れる（削除はされない）。
 * lawId           : 法令IDを直接指定したい場合に設定（最優先）。
 *                   検索が曖昧なとき、ここに正式な法令IDを書けば確実に特定できる。
 * lawNum          : 法令番号を指定して候補を絞り込みたい場合に設定。
 * aliases         : 別名・旧称。検索候補の照合に使う。
 * notes           : 人間向けの備考。処理には影響しない。
 *
 * 注意
 * ----
 * 存在しない法令名を推測で追加しないこと。
 * 検索で0件だった場合、システムは「推測で近い法令を保存」せず、
 * WARN として記録し、その法令をスキップする（誤ったデータを保存しないため）。
 */

/**
 * 同期対象法令の定義。
 * @return {!Array<!Object>} 法令設定の配列
 */
function getLawsConfig() {
  return [
  // ------- 国税 -------
  {
    category: 'tax',
    name: '国税通則法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '国税通則法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '国税通則法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '所得税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '所得税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '所得税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '法人税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '法人税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '法人税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '消費税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '消費税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '消費税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '相続税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '相続税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '相続税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },
  {
    category: 'tax',
    name: '租税特別措置法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／法律'
  },
  {
    category: 'tax',
    name: '租税特別措置法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／政令'
  },
  {
    category: 'tax',
    name: '租税特別措置法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '国税／省令'
  },

  // ------- 地方税 -------
  {
    category: 'tax',
    name: '地方税法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '地方税／法律'
  },
  {
    category: 'tax',
    name: '地方税法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '地方税／政令'
  },
  {
    category: 'tax',
    name: '地方税法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '地方税／省令'
  },

  // ------- 社会保険 -------
  {
    category: 'social_insurance',
    name: '健康保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '健康保険法施行令',
    // e-Gov上の正式な法令種別は「勅令」（大正十五年勅令第二百四十三号）。
    // 戦前に制定され、現在も効力を有する。名称は「施行令」だが政令ではない。
    // e-Gov側の事実に合わせているため、保存先は 04_その他 になる。
    expectedLawType: 'imperial_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／勅令（大正十五年勅令第二百四十三号）。名称は施行令だが政令ではない'
  },
  {
    category: 'social_insurance',
    name: '健康保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },
  {
    category: 'social_insurance',
    name: '厚生年金保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '厚生年金保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／政令'
  },
  {
    category: 'social_insurance',
    name: '厚生年金保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },
  {
    category: 'social_insurance',
    name: '国民年金法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '国民年金法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／政令'
  },
  {
    category: 'social_insurance',
    name: '国民年金法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },
  {
    category: 'social_insurance',
    name: '国民健康保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '国民健康保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／政令'
  },
  {
    category: 'social_insurance',
    name: '国民健康保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },
  {
    category: 'social_insurance',
    name: '介護保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／法律'
  },
  {
    category: 'social_insurance',
    name: '介護保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／政令'
  },
  {
    category: 'social_insurance',
    name: '介護保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '社会保険／省令'
  },

  // ------- 労働保険 -------
  {
    category: 'labor_insurance',
    name: '雇用保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／法律'
  },
  {
    category: 'labor_insurance',
    name: '雇用保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／政令'
  },
  {
    category: 'labor_insurance',
    name: '雇用保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／省令'
  },
  {
    category: 'labor_insurance',
    name: '労働者災害補償保険法',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／法律'
  },
  {
    category: 'labor_insurance',
    name: '労働者災害補償保険法施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／政令'
  },
  {
    category: 'labor_insurance',
    name: '労働者災害補償保険法施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／省令'
  },
  {
    category: 'labor_insurance',
    name: '労働保険の保険料の徴収等に関する法律',
    expectedLawType: 'act',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／法律'
  },
  {
    category: 'labor_insurance',
    name: '労働保険の保険料の徴収等に関する法律施行令',
    expectedLawType: 'cabinet_order',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／政令'
  },
  {
    category: 'labor_insurance',
    name: '労働保険の保険料の徴収等に関する法律施行規則',
    expectedLawType: 'ministerial_ordinance',
    enabled: true,
    lawId: null,
    lawNum: null,
    aliases: [],
    notes: '労働保険／省令'
  }

    // ------- 関連法令（必要に応じてここへ追加する） -------
    // 税制・社会保険・労働保険の各法令から直接参照される重要な法令を
    // 追加する場合は、以下の形式で追記する。
    //
    // {
    //   category: 'related',
    //   name: '（e-Gov上の正式名称）',
    //   expectedLawType: 'act',
    //   enabled: true,
    //   lawId: null,
    //   lawNum: null,
    //   aliases: [],
    //   notes: '追加理由をここに書く'
    // }
  ];
}

/**
 * 設定を検証し、不正なエントリを検出する。
 * setup() / syncLaws() の冒頭で必ず呼ぶ。
 *
 * @param {!Array<!Object>=} laws 検証対象（省略時は getLawsConfig()）
 * @return {{valid: !Array<!Object>, errors: !Array<string>}}
 *     valid  : 検証を通ったエントリ
 *     errors : 問題の説明（law単位）
 */
function validateLawsConfig(laws) {
  var entries = laws || getLawsConfig();
  var valid = [];
  var errors = [];
  var seen = {};

  entries.forEach(function (law, index) {
    var where = '[' + index + '] ' + (law && law.name ? law.name : '(名称なし)');

    if (!law || typeof law !== 'object') {
      errors.push(where + ': エントリがオブジェクトではありません');
      return;
    }
    if (!law.name || typeof law.name !== 'string') {
      errors.push(where + ': name が未設定です');
      return;
    }
    if (!law.category || !CONFIG.CATEGORIES[law.category]) {
      errors.push(where + ': category "' + law.category + '" は未定義です');
      return;
    }
    if (law.expectedLawType && !CONFIG.LAW_TYPE_DEFS[law.expectedLawType]) {
      errors.push(where + ': expectedLawType "' + law.expectedLawType + '" は未定義です');
      return;
    }

    // 同一カテゴリ内での法令名重複を検出する
    var dupKey = law.category + ' ' + law.name;
    if (seen[dupKey]) {
      errors.push(where + ': 同一カテゴリ内で法令名が重複しています');
      return;
    }
    seen[dupKey] = true;

    valid.push(law);
  });

  return { valid: valid, errors: errors };
}

/**
 * 有効（enabled）な対象法令のみを返す。
 *
 * @param {string=} categoryKey 指定するとそのカテゴリのみ
 * @return {!Array<!Object>} 対象法令の配列
 */
function getEnabledLaws(categoryKey) {
  var result = validateLawsConfig();
  return result.valid.filter(function (law) {
    if (law.enabled === false) {
      return false;
    }
    return !categoryKey || law.category === categoryKey;
  });
}

/**
 * 法令名（または別名）から設定エントリを1件検索する。
 * syncSingleLaw() で使う。
 *
 * @param {string} name 法令名
 * @return {?Object} 見つかった設定エントリ。なければ null
 */
function findLawConfigByName(name) {
  if (!name) {
    return null;
  }
  var needle = normalizeLawName(name);
  var result = validateLawsConfig();
  var found = null;

  result.valid.forEach(function (law) {
    if (found) {
      return;
    }
    if (normalizeLawName(law.name) === needle) {
      found = law;
      return;
    }
    (law.aliases || []).forEach(function (alias) {
      if (!found && normalizeLawName(alias) === needle) {
        found = law;
      }
    });
  });

  return found;
}
