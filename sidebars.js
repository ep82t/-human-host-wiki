const sidebars = {
  wikiSidebar: [
    {
      type: 'doc',
      id: 'index',
      label: 'トップ'
    },
    {
      type: 'category',
      label: '初心者ガイド',
      items: [
        'getting-started/index',
        'getting-started/early-game',
        'getting-started/screen-guide',
        'getting-started/food-water-medicine',
        'getting-started/first-resources',
        'settings/hotkeys'
      ]
    },
    {
      type: 'category',
      label: 'ゲーム設定',
      items: [
        'settings/index',
        'settings/hotkeys'
      ]
    },
    {
      type: 'category',
      label: 'データ',
      items: [
        {
          type: 'category',
          label: 'バイオーム',
          items: [
            'biomes/index',
            'biomes/mountain',
            'biomes/forest',
            'biomes/warzone-ruins',
            'biomes/wasteland-ruins',
            'biomes/desert',
            'biomes/canyon',
            'biomes/rainforest',
            'biomes/swamp',
            'biomes/snowland',
            'biomes/snowy-mountain'
          ]
        },
        {
          type: 'category',
          label: '資源',
          items: [
            'resources/index',
            'resources/clay',
            'resources/sand',
            'resources/copper-ore',
            'resources/marble',
            'resources/iron-ore',
            'resources/epidote',
            'resources/sulfur',
            'resources/nitrate-ore',
            'resources/yellow-wax-stone',
            'resources/graphite-ore',
            'resources/lapis-lazuli',
            'resources/titanium-ore',
            'resources/chromium-ore',
            'resources/tungsten-ore',
            'resources/obsidian',
            'resources/lime',
            'resources/pinecone',
            'resources/mushroom',
            'resources/rebar',
            'resources/scrap-iron',
            'resources/cement',
            'resources/log',
            'resources/charcoal',
            'resources/cactus',
            'resources/plant-fiber'
          ]
        },
        'items/index',
        {
          type: 'category',
          label: 'クラフト',
          items: [
            'crafting/index',
            'crafting/material-processing',
            'crafting/building-crafting',
            'crafting/vehicle-assembly',
            'crafting/trap-crafting'
          ]
        },
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
