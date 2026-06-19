const sidebars = {
  wikiSidebar: [
    {
      type: 'doc',
      id: 'index',
      label: 'トップ'
    },
    {
      type: 'category',
      label: 'サバイバル情報',
      items: [
        'biomes/index',
        'resources/index',
        'items/index',
        'crafting/index',
        'building/index'
      ]
    },
    {
      type: 'category',
      label: '探索・戦闘',
      items: [
        'enemies/index',
        'vehicles/index'
      ]
    },
    {
      type: 'category',
      label: '開発状況',
      items: [
        'trader-system/index',
        'updates/index',
        'unconfirmed/index'
      ]
    },
    {
      type: 'category',
      label: '運用',
      items: [
        'glossary/index'
      ]
    }
  ]
};

module.exports = sidebars;
